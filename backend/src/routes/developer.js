import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  cleanupDuplicateCustomerPhoneIndexes,
  cleanupDuplicateOrganizationSlugIndexes
} from '../startup/bootstrap.js';
import { sequelize } from '../db.js';

const router = Router();

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

export default router;
