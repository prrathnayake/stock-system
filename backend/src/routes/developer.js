import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  cleanupDuplicateCustomerPhoneIndexes,
  cleanupDuplicateOrganizationSlugIndexes
} from '../startup/bootstrap.js';
import { sequelize, Product, Location, Bin, StockLevel } from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import { SeedSchema, seedOrganizationData } from '../services/seedImporter.js';
import { createTerminalSession, consumeTerminalSession, terminateSession } from '../services/terminalSessions.js';
import { getDeveloperTelemetry } from '../services/developerTelemetry.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { recordTerminalEvent } from '../services/terminalAuditLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleSeedPath = path.resolve(__dirname, '../../../docs/sample-seed.json');

function verifyMultiFactor(req, res, next) {
  const primarySecret = (process.env.DEVELOPER_API_KEY || '').trim();
  const secondarySecret = (process.env.DEVELOPER_SECOND_FACTOR || '').trim();

  if (!primarySecret || !secondarySecret) {
    console.warn('[developer] Multi-factor secrets are not configured.');
    return res.status(500).json({ error: 'Developer multi-factor secrets are not configured' });
  }

  const providedPrimary = (req.headers['x-developer-key'] || '').toString().trim();
  const providedSecondary = (req.headers['x-developer-otp'] || '').toString().trim();

  if (providedPrimary !== primarySecret || providedSecondary !== secondarySecret) {
    return res.status(401).json({ error: 'Developer multi-factor verification failed' });
  }

  return next();
}

async function buildExportPayload(organizationId) {
  const [products, locations, bins, stockLevels] = await Promise.all([
    Product.findAll({ order: [['sku', 'ASC']], attributes: ['sku', 'name', 'uom', 'track_serial', 'reorder_point', 'lead_time_days', 'unit_price'], where: { organizationId } }),
    Location.findAll({ order: [['site', 'ASC']], attributes: ['id', 'site', 'room', 'notes'], where: { organizationId } }),
    Bin.findAll({
      order: [['code', 'ASC']],
      attributes: ['code', 'locationId'],
      include: [{ model: Location, attributes: ['site'], required: false }],
      where: { organizationId }
    }),
    StockLevel.findAll({
      attributes: ['on_hand', 'reserved'],
      include: [
        { model: Product, attributes: ['sku'], required: true },
        { model: Bin, attributes: ['code'], required: true }
      ],
      where: { organizationId }
    })
  ]);

  const stockEntries = stockLevels
    .map((level) => ({
      sku: level.product?.sku,
      bin: level.bin?.code,
      on_hand: level.on_hand,
      reserved: level.reserved
    }))
    .filter((entry) => entry.sku && entry.bin)
    .sort((a, b) => {
      const skuCompare = a.sku.localeCompare(b.sku);
      if (skuCompare !== 0) return skuCompare;
      return a.bin.localeCompare(b.bin);
    });

  return {
    products: products.map((product) => ({
      sku: product.sku,
      name: product.name,
      uom: product.uom,
      track_serial: product.track_serial,
      reorder_point: product.reorder_point,
      lead_time_days: product.lead_time_days,
      unit_price: Number(product.unit_price || 0)
    })),
    locations: locations.map((location) => ({
      site: location.site,
      room: location.room || undefined,
      notes: location.notes || undefined
    })),
    bins: bins.map((bin) => ({
      code: bin.code,
      location_site: bin.location?.site || undefined
    })),
    stock: stockEntries
  };
}

export default function createDeveloperRoutes(io) {
  const router = Router();
  const terminalNamespace = typeof io?.of === 'function' ? io.of('/developer-terminal') : null;

  if (terminalNamespace) {
    terminalNamespace.use((socket, next) => {
      try {
        const { sessionId, token, accessToken } = socket.handshake.auth || {};
        if (!sessionId || !token || !accessToken) {
          recordTerminalEvent({
            type: 'session_rejected',
            session_id: sessionId,
            ip: socket.handshake?.address,
            user_agent: socket.handshake?.headers?.['user-agent'],
            details: 'Missing terminal authentication payload.'
          });
          return next(new Error('Unauthorized'));
        }
        const payload = verifyAccessToken(accessToken);
        if (payload.role !== 'developer') {
          recordTerminalEvent({
            type: 'session_rejected',
            session_id: sessionId,
            user_id: payload?.id,
            ip: socket.handshake?.address,
            user_agent: socket.handshake?.headers?.['user-agent'],
            details: 'User lacks developer role.'
          });
          return next(new Error('Forbidden'));
        }
        const session = consumeTerminalSession({ sessionId, token, userId: payload.id });
        if (!session) {
          recordTerminalEvent({
            type: 'session_rejected',
            session_id: sessionId,
            user_id: payload.id,
            ip: socket.handshake?.address,
            user_agent: socket.handshake?.headers?.['user-agent'],
            details: 'Session unavailable or expired.'
          });
          return next(new Error('Session unavailable'));
        }
        socket.data.sessionId = session.id;
        socket.data.process = session.process;
        socket.data.shell = session.shell;
        socket.data.userId = payload.id;
        recordTerminalEvent({
          type: 'session_claimed',
          session_id: session.id,
          user_id: payload.id,
          ip: socket.handshake?.address,
          user_agent: socket.handshake?.headers?.['user-agent'],
          details: 'Terminal session successfully claimed.'
        });
        next();
      } catch (error) {
        recordTerminalEvent({
          type: 'session_rejected',
          session_id: socket.handshake?.auth?.sessionId,
          ip: socket.handshake?.address,
          user_agent: socket.handshake?.headers?.['user-agent'],
          details: 'Access token verification failed.'
        });
        next(new Error('Unauthorized'));
      }
    });

    terminalNamespace.on('connection', (socket) => {
      const child = socket.data.process;
      if (!child) {
        socket.emit('terminal:exit', -1);
        socket.disconnect(true);
        recordTerminalEvent({
          type: 'session_error',
          session_id: socket.data.sessionId,
          ip: socket.handshake?.address,
          user_agent: socket.handshake?.headers?.['user-agent'],
          details: 'Terminal child process missing during connection.'
        });
        return;
      }

      const writeChunk = (event, chunk) => {
        if (!chunk) return;
        const payload = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        socket.emit(event, payload);
      };

      const shellInfo = socket.data.shell;
      if (shellInfo) {
        const args = Array.isArray(shellInfo.args) && shellInfo.args.length > 0
          ? ` ${shellInfo.args.join(' ')}`
          : '';
        writeChunk(
          'terminal:data',
          `[session ready] Shell: ${shellInfo.shell}${args}\nWorking directory: ${shellInfo.cwd}\n` +
            'Use standard tooling (e.g. `docker compose exec <service> sh`) to access other services.\n\n'
        );
        recordTerminalEvent({
          type: 'session_connected',
          session_id: socket.data.sessionId,
          user_id: socket.data?.userId,
          ip: socket.handshake?.address,
          user_agent: socket.handshake?.headers?.['user-agent'],
          details: `Shell ${shellInfo.shell}${args}`
        });
      }

      const stdoutListener = (chunk) => writeChunk('terminal:data', chunk);
      const stderrListener = (chunk) => writeChunk('terminal:data', chunk);
      const exitListener = (code) => {
        socket.emit('terminal:exit', typeof code === 'number' ? code : null);
        terminateSession(socket.data.sessionId);
        recordTerminalEvent({
          type: 'session_closed',
          session_id: socket.data.sessionId,
          ip: socket.handshake?.address,
          user_agent: socket.handshake?.headers?.['user-agent'],
          details: typeof code === 'number' ? `Process exited with code ${code}` : 'Process terminated.'
        });
      };

      child.stdout.on('data', stdoutListener);
      child.stderr.on('data', stderrListener);
      child.on('close', exitListener);
      child.on('error', (error) => {
        socket.emit('terminal:data', `\n[terminal error] ${error.message}\n`);
        terminateSession(socket.data.sessionId);
        recordTerminalEvent({
          type: 'session_error',
          session_id: socket.data.sessionId,
          ip: socket.handshake?.address,
          user_agent: socket.handshake?.headers?.['user-agent'],
          details: error.message
        });
      });

      socket.on('terminal:input', (input) => {
        if (typeof input !== 'string') return;
        try {
          child.stdin.write(input);
        } catch (error) {
          socket.emit('terminal:data', `\n[write error] ${error.message}\n`);
          recordTerminalEvent({
            type: 'session_error',
            session_id: socket.data.sessionId,
            ip: socket.handshake?.address,
            user_agent: socket.handshake?.headers?.['user-agent'],
            details: `stdin write failure: ${error.message}`
          });
        }
      });

      socket.on('disconnect', () => {
        terminateSession(socket.data.sessionId);
        recordTerminalEvent({
          type: 'session_disconnected',
          session_id: socket.data.sessionId,
          ip: socket.handshake?.address,
          user_agent: socket.handshake?.headers?.['user-agent'],
          details: 'Client disconnected.'
        });
      });
    });
  } else {
    console.warn('[developer] Socket server unavailable; web terminal disabled.');
  }

  router.post(
    '/maintenance/cleanup',
    requireAuth(['developer']),
    verifyMultiFactor,
    asyncHandler(async (_req, res) => {
      await cleanupDuplicateOrganizationSlugIndexes();
      await cleanupDuplicateCustomerPhoneIndexes();
      await sequelize.sync({ alter: false });

      res.json({
        ok: true,
        completed_at: new Date().toISOString(),
        message: 'Database maintenance completed successfully'
      });
    })
  );

  router.post(
    '/sessions/terminal',
    requireAuth(['developer']),
    verifyMultiFactor,
    asyncHandler(async (req, res) => {
      if (!terminalNamespace) {
        throw new HttpError(503, 'Web terminal support is unavailable');
      }
      const session = createTerminalSession({ userId: req.user.id });
      recordTerminalEvent({
        type: 'session_created',
        session_id: session.session_id,
        user_id: req.user.id,
        ip: req.ip,
        user_agent: req.get('user-agent'),
        details: 'Terminal session issued via developer tools.'
      });
      res.status(201).json(session);
    })
  );

  router.get(
    '/telemetry',
    requireAuth(['developer']),
    verifyMultiFactor,
    asyncHandler(async (req, res) => {
      const telemetry = await getDeveloperTelemetry({ organizationId: req.user.organization_id });
      res.json(telemetry);
    })
  );


  router.get(
    '/export',
    requireAuth(['developer']),
    verifyMultiFactor,
    asyncHandler(async (req, res) => {
      const payload = await buildExportPayload(req.user.organization_id);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="stock-export-${timestamp}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    })
  );

  router.get(
    '/seed/sample',
    requireAuth(['developer']),
    verifyMultiFactor,
    asyncHandler(async (_req, res) => {
      let sample;
      try {
        sample = await fs.readFile(sampleSeedPath, 'utf8');
      } catch (error) {
        throw new HttpError(500, 'Sample seed file is unavailable');
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="stock-seed-sample.json"');
      res.send(sample);
    })
  );

  router.post(
    '/seed',
    requireAuth(['developer']),
    verifyMultiFactor,
    asyncHandler(async (req, res) => {
      const parse = SeedSchema.safeParse(req.body);
      if (!parse.success) {
        throw new HttpError(400, 'Invalid seed payload', parse.error.flatten());
      }

      const organizationId = req.user.organization_id;

      const summary = await seedOrganizationData({
        data: parse.data,
        organizationId
      });

      await invalidateStockOverviewCache(organizationId);

      res.status(201).json({
        ok: true,
        seeded_at: new Date().toISOString(),
        summary
      });
    })
  );

  return router;
}
