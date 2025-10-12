import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getReadinessReport } from '../services/readiness.js';

const router = Router();

router.get('/', requireAuth(['admin', 'developer']), asyncHandler(async (req, res) => {
  const report = await getReadinessReport({ organizationId: req.user.organization_id });
  res.json(report);
}));

export default router;
