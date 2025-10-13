import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  cleanupDuplicateCustomerPhoneIndexes,
  cleanupDuplicateOrganizationSlugIndexes,
  initialiseDatabase
} from '../startup/bootstrap.js';
import { sequelize, Product, Location, Bin, StockLevel } from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import { SeedSchema, seedOrganizationData } from '../services/seedImporter.js';
import { createTerminalSession, consumeTerminalSession, terminateSession } from '../services/terminalSessions.js';
import { getDeveloperTelemetry } from '../services/developerTelemetry.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { recordTerminalEvent } from '../services/terminalAuditLog.js';
import { config } from '../config.js';
import { sendEmail } from '../services/email.js';
import { issueDeveloperOtp, verifyDeveloperOtp } from '../services/developerOtp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleSeedPath = path.resolve(__dirname, '../../../docs/sample-seed.json');

function checkPrimarySecret(req, res) {
  const primarySecret = (process.env.DEVELOPER_API_KEY || '').trim();
  if (!primarySecret) {
    console.warn('[developer] Developer API key is not configured.');
    res.status(500).json({ error: 'Developer multi-factor secrets are not configured' });
    return false;
  }
  const providedPrimary = (req.headers['x-developer-key'] || '').toString().trim();
  if (providedPrimary !== primarySecret) {
    res.status(401).json({ error: 'Developer primary credential verification failed' });
    return false;
  }
  return true;
}

function mapOtpFailure(reason) {
  switch (reason) {
    case 'expired':
      return 'The verification code has expired. Request a new code and try again.';
    case 'mismatch':
      return 'The verification code is incorrect.';
    case 'not-found':
      return 'Request a new verification code before attempting this action.';
    case 'missing-code':
      return 'Provide the verification code that was sent to your email address.';
    case 'missing-user':
      return 'Developer identity unavailable for verification.';
    default:
      return 'Developer multi-factor verification failed.';
  }
}

function verifyPrimaryFactor(req, res, next) {
  if (!checkPrimarySecret(req, res)) {
    return;
  }
  next();
}

function verifyMultiFactor({ purpose = 'general', requireFreshOtp = false } = {}) {
  return (req, res, next) => {
    if (!checkPrimarySecret(req, res)) {
      return;
    }

    const providedSecondary = (req.headers['x-developer-otp'] || '').toString().trim();
    if (!providedSecondary) {
      res.status(401).json({ error: 'Provide the developer verification code.' });
      return;
    }

    const secondarySecret = (process.env.DEVELOPER_SECOND_FACTOR || '').trim();
    if (!requireFreshOtp && secondarySecret && providedSecondary === secondarySecret) {
      next();
      return;
    }

    if (!req.user?.id) {
      res.status(500).json({ error: 'Developer identity unavailable for verification.' });
      return;
    }

    const outcome = verifyDeveloperOtp({
      userId: req.user.id,
      purpose,
      code: providedSecondary,
      consume: requireFreshOtp
    });

    if (!outcome.ok) {
      res.status(401).json({ error: mapOtpFailure(outcome.reason) });
      return;
    }

    next();
  };
}

function describeOtpPurpose(purpose) {
  if (purpose === 'database-rebuild') {
    return 'database rebuild request';
  }
  return 'developer operations';
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
    '/otp',
    requireAuth(['developer']),
    verifyPrimaryFactor,
    asyncHandler(async (req, res) => {
      if (!req.user?.email) {
        throw new HttpError(400, 'Developer account is missing an email address');
      }

      const requestedPurpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim().toLowerCase() : 'general';
      const purpose = requestedPurpose || 'general';
      const { code, expiresAt } = issueDeveloperOtp({ userId: req.user.id, purpose });

      const organizationName = config.bootstrap.organization.name || 'Stock System';
      const subject = `${organizationName} developer verification code`;
      const friendlyPurpose = describeOtpPurpose(purpose);
      const text = `Use the one-time code ${code} to continue with the ${friendlyPurpose}. This code expires in 5 minutes.`;
      const html = `
        <p>Use the verification code below to continue with the ${friendlyPurpose}.</p>
        <p style="font-size:26px; font-weight:700; letter-spacing:6px;">${code}</p>
        <p>This code expires in 5 minutes.</p>
      `;

      const delivery = await sendEmail({ to: req.user.email, subject, text, html });
      if (!delivery.delivered) {
        console.error('[developer] Failed to deliver verification code email:', delivery.error || delivery);
        throw new HttpError(503, 'Unable to send verification code email. Check mail configuration.');
      }

      res.json({
        ok: true,
        purpose,
        expires_at: new Date(expiresAt).toISOString()
      });
    })
  );

  router.post(
    '/maintenance/cleanup',
    requireAuth(['developer']),
    verifyMultiFactor(),
    asyncHandler(async (_req, res) => {
      await cleanupDuplicateOrganizationSlugIndexes();
      await cleanupDuplicateCustomerPhoneIndexes();
      await sequelize.sync({ alter: false });

      res.json({
        ok: true,
        completed_at: new Date().toISOString(),
        message: 'Database maintenance completed successfully.'
      });
    })
  );

  router.post(
    '/database/rebuild',
    requireAuth(['developer']),
    verifyMultiFactor({ purpose: 'database-rebuild', requireFreshOtp: true }),
    asyncHandler(async (_req, res) => {
      await sequelize.drop();
      await initialiseDatabase();

      res.json({
        ok: true,
        rebuilt_at: new Date().toISOString(),
        message: 'Database rebuilt successfully. All users will need to sign in again.'
      });
    })
  );

  router.post(
    '/sessions/terminal',
    requireAuth(['developer']),
    verifyMultiFactor(),
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
    verifyMultiFactor(),
    asyncHandler(async (req, res) => {
      const telemetry = await getDeveloperTelemetry({ organizationId: req.user.organization_id });
      res.json(telemetry);
    })
  );


  router.get(
    '/export',
    requireAuth(['developer']),
    verifyMultiFactor(),
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
    verifyMultiFactor(),
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
    verifyMultiFactor(),
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
