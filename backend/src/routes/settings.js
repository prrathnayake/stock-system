import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getAllSettings, upsertSettings } from '../services/settings.js';
import { scheduleBackups, getBackupOptions } from '../services/backup.js';
import { scheduleDailyDigest } from '../services/dailyDigest.js';
import { notifySettingsChanged } from '../services/notificationService.js';
import { HttpError } from '../utils/httpError.js';

const UpdateSchema = z.object({
  low_stock_alerts_enabled: z.boolean().optional(),
  default_sla_hours: z.number().int().nonnegative().optional(),
  notification_emails: z.array(z.string().email()).optional(),
  backup_enabled: z.boolean().optional(),
  backup_schedule: z.string().min(1).optional(),
  backup_retain_days: z.number().int().nonnegative().optional(),
  daily_digest_enabled: z.boolean().optional(),
  daily_digest_time: z.string().regex(/^([01]?\d|2[0-3]):([0-5]\d)$/, 'Provide a time in HH:MM format').optional()
});

const router = Router();

router.get('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const entries = await getAllSettings(false, req.user.organization_id);
  const payload = Object.fromEntries(entries.entries());
  const backup = getBackupOptions();
  res.json({ ...payload, backup_enabled: backup.enabled, backup_schedule: backup.schedule, backup_retain_days: backup.retainDays });
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
  if (typeof payload.daily_digest_time === 'string') {
    payload.daily_digest_time = payload.daily_digest_time.trim();
  }
  await upsertSettings(payload, req.user.organization_id);
  if (payload.backup_enabled !== undefined || payload.backup_schedule || payload.backup_retain_days !== undefined) {
    try {
      scheduleBackups({
        enabled: payload.backup_enabled,
        schedule: payload.backup_schedule,
        retainDays: payload.backup_retain_days
      });
    } catch (err) {
      throw new HttpError(400, err.message || 'Invalid backup configuration');
    }
  }
  if (payload.daily_digest_enabled !== undefined || payload.daily_digest_time) {
    scheduleDailyDigest();
  }
  const entries = await getAllSettings(true, req.user.organization_id);
  const merged = Object.fromEntries(entries.entries());
  const backup = getBackupOptions();
  res.json({ ...merged, backup_enabled: backup.enabled, backup_schedule: backup.schedule, backup_retain_days: backup.retainDays });
  notifySettingsChanged({
    organizationId: req.user.organization_id,
    actor: req.user,
    keys: Object.keys(payload)
  }).catch((error) => {
    console.error('[notify] failed to send settings update email', error);
  });
}));

export default router;
