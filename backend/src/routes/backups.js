import { Router } from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { listBackups, runBackup, ensureBackupDir } from '../services/backup.js';
import { recordActivity } from '../services/activityLog.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

router.use(requireAuth(['admin']));

router.get('/', asyncHandler(async (_req, res) => {
  const backups = await listBackups();
  res.json({ backups });
}));

router.post('/run', asyncHandler(async (_req, res) => {
  const file = await runBackup();
  res.status(201).json({ file: path.basename(file) });
  recordActivity({
    action: 'backup.run',
    entityType: 'backup',
    entityId: file,
    description: 'Triggered manual database backup'
  }).catch(() => {});
}));

router.get('/:file', asyncHandler(async (req, res) => {
  const { file } = req.params;
  if (!file.endsWith('.sql')) {
    throw new HttpError(400, 'Invalid backup file');
  }
  const dir = await ensureBackupDir();
  const fullPath = path.join(dir, file);
  try {
    await fs.access(fullPath);
  } catch {
    throw new HttpError(404, 'Backup not found');
  }
  recordActivity({
    action: 'backup.download',
    entityType: 'backup',
    entityId: file,
    description: `Downloaded database backup ${file}`
  }).catch(() => {});
  res.download(fullPath, file);
}));

export default router;
