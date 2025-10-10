import { promises as fs } from 'fs';
import path from 'path';
import cron from 'node-cron';
import mysqldump from 'mysqldump';
import { config } from '../config.js';

const RESOLVED_DIR = path.resolve(process.cwd(), config.backup.directory);

let runtimeOptions = {
  enabled: config.backup.enabled,
  schedule: config.backup.schedule,
  retainDays: config.backup.retainDays
};

let scheduledTask = null;

function normaliseOptions(options = {}) {
  const next = { ...runtimeOptions };
  if (options.enabled !== undefined) next.enabled = options.enabled;
  if (options.schedule) next.schedule = options.schedule;
  if (options.retainDays !== undefined) next.retainDays = options.retainDays;
  return next;
}

export function getBackupOptions() {
  return { ...runtimeOptions };
}

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
  if (!runtimeOptions.retainDays || runtimeOptions.retainDays <= 0) return;
  await ensureBackupDir();
  const cutoff = Date.now() - runtimeOptions.retainDays * 24 * 60 * 60 * 1000;
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

export function scheduleBackups(options = {}) {
  runtimeOptions = normaliseOptions(options);

  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }

  if (!runtimeOptions.enabled) {
    console.log('Automated backups disabled');
    return null;
  }

  if (!cron.validate(runtimeOptions.schedule)) {
    throw new Error('Invalid backup schedule expression');
  }

  scheduledTask = cron.schedule(runtimeOptions.schedule, async () => {
    try {
      await runBackup();
      console.log('Database backup completed');
    } catch (err) {
      console.error('Database backup failed', err);
    }
  });
  console.log(`Automated backups enabled using schedule "${runtimeOptions.schedule}" -> ${RESOLVED_DIR}`);
  return scheduledTask;
}
