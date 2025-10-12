import { promises as fs } from 'fs';
import path from 'path';
import cron from 'node-cron';
import mysql from 'mysql2/promise';
import { escape as mysqlEscape } from 'mysql2';
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
  const dialect = (config.db.dialect || 'mysql').toLowerCase();
  if (dialect !== 'mysql') {
    throw new Error(`Database backups are only supported for MySQL connections (received ${dialect}).`);
  }
  const file = path.join(RESOLVED_DIR, `${config.db.name}-${timestamp}.sql`);
  await generateMysqlDump(file);
  await purgeExpiredBackups();
  return file;
}

async function generateMysqlDump(targetPath) {
  const header = [
    '-- Stock Management System SQL backup',
    `-- Generated at ${new Date().toISOString()}`,
    'SET FOREIGN_KEY_CHECKS=0;'
  ];
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.pass,
    database: config.db.name
  });
  try {
    const [tables] = await connection.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
    const lines = [...header];
    for (const row of tables) {
      const values = Object.values(row);
      if (!values.length) continue;
      const tableName = String(values[0]);
      const [createRows] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
      const createStatement = createRows?.[0]?.['Create Table'];
      if (!createStatement) continue;
      lines.push(`\n-- Table structure for \`${tableName}\``);
      lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
      lines.push(`${createStatement};`);

      const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const columnList = columns.map((col) => `\`${col}\``).join(', ');
      const batchSize = 250;
      for (let i = 0; i < rows.length; i += batchSize) {
        const slice = rows.slice(i, i + batchSize);
        const valuesList = slice.map((record) => {
          const valueParts = columns.map((col) => mysqlEscape(record[col]));
          return `(${valueParts.join(', ')})`;
        });
        lines.push(`INSERT INTO \`${tableName}\` (${columnList}) VALUES`);
        lines.push(`${valuesList.join(',\n')};`);
      }
    }
    lines.push('\nSET FOREIGN_KEY_CHECKS=1;');
    await fs.writeFile(targetPath, lines.join('\n'), 'utf8');
  } finally {
    await connection.end();
  }
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
