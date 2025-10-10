import { promises as fs } from 'fs';
import path from 'path';
import cron from 'node-cron';
import mysqldump from 'mysqldump';
import { config } from '../config.js';

const RESOLVED_DIR = path.resolve(process.cwd(), config.backup.directory);

export async function ensureBackupDir() {
  await fs.mkdir(RESOLVED_DIR, { recursive: true });
  return RESOLVED_DIR;
}

export async function runBackup() {
  await ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RESOLVED_DIR, `${config.db.name}-${timestamp}.sql`);
  await mysqldump({
    connection: {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.pass,
      database: config.db.name
    },
    dumpToFile: file
  });
  await purgeExpiredBackups();
  return file;
}

export async function listBackups() {
  await ensureBackupDir();
  const entries = await fs.readdir(RESOLVED_DIR);
  const backups = [];
  for (const entry of entries) {
    if (!entry.endsWith('.sql')) continue;
    const fullPath = path.join(RESOLVED_DIR, entry);
    const stats = await fs.stat(fullPath);
    backups.push({
      file: entry,
      size: stats.size,
      createdAt: stats.birthtime.toISOString()
    });
  }
  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return backups;
}

export async function purgeExpiredBackups() {
  if (!config.backup.retainDays || config.backup.retainDays <= 0) return;
  await ensureBackupDir();
  const cutoff = Date.now() - config.backup.retainDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(RESOLVED_DIR);
  await Promise.all(entries.map(async entry => {
    if (!entry.endsWith('.sql')) return;
    const fullPath = path.join(RESOLVED_DIR, entry);
    const stats = await fs.stat(fullPath);
    if (stats.birthtimeMs < cutoff) {
      await fs.unlink(fullPath);
    }
  }));
}

export function scheduleBackups() {
  if (!config.backup.enabled) {
    return null;
  }
  const task = cron.schedule(config.backup.schedule, async () => {
    try {
      await runBackup();
      console.log('Database backup completed');
    } catch (err) {
      console.error('Database backup failed', err);
    }
  });
  console.log(`Automated backups enabled using schedule "${config.backup.schedule}" -> ${RESOLVED_DIR}`);
  return task;
}
