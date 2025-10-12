import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  cleanupDuplicateCustomerPhoneIndexes,
  cleanupDuplicateOrganizationSlugIndexes
} from '../startup/bootstrap.js';
import { sequelize } from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import { SeedSchema, seedOrganizationData } from '../services/seedImporter.js';

const router = Router();

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
  asyncHandler(async (_req, res) => {
    const sessionId = crypto.randomUUID();
    const issuedAt = new Date();
    res.status(201).json({
      session_id: sessionId,
      issued_at: issuedAt.toISOString(),
      expires_in: 300,
      command: `stockctl shell --session ${sessionId}`
    });
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

export default router;
