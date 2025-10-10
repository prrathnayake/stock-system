import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getAllSettings, upsertSettings } from '../services/settings.js';
import { HttpError } from '../utils/httpError.js';

const UpdateSchema = z.object({
  low_stock_alerts_enabled: z.boolean().optional(),
  default_sla_hours: z.number().int().nonnegative().optional(),
  notification_emails: z.array(z.string().email()).optional()
});

const router = Router();

router.get('/', requireAuth(['admin']), asyncHandler(async (_req, res) => {
  const entries = await getAllSettings();
  const payload = Object.fromEntries(entries.entries());
  res.json(payload);
}));

router.put('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }

  const payload = { ...parsed.data };
  if (payload.notification_emails === undefined) {
    payload.notification_emails = [];
  }
  await upsertSettings(payload);
  const entries = await getAllSettings(true);
  res.json(Object.fromEntries(entries.entries()));
}));

export default router;
