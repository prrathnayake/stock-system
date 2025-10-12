import { config } from '../config.js';
import { Organization, User } from '../db.js';
import { getAllSettings } from './settings.js';
import { getBackupOptions, listBackups } from './backup.js';

function normaliseEmailList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isStrongSecret(secret) {
  return typeof secret === 'string' && secret.trim().length >= 16;
}

export async function getReadinessReport({ organizationId }) {
  const [settingsMap, organization, backupOptions, backups, adminCount, developerCount] = await Promise.all([
    getAllSettings(false, organizationId),
    Organization.findByPk(organizationId),
    Promise.resolve(getBackupOptions()),
    listBackups().catch(() => []),
    User.count({ where: { organizationId, role: 'admin' } }),
    User.count({ where: { organizationId, role: 'developer' } })
  ]);

  const notificationEmails = normaliseEmailList(settingsMap.get('notification_emails'));
  const backupEnabled = backupOptions.enabled === true;
  const latestBackup = backups[0] || null;
  const latestBackupTime = latestBackup ? new Date(latestBackup.createdAt).getTime() : null;
  const backupFresh = latestBackupTime ? Date.now() - latestBackupTime < 7 * 24 * 60 * 60 * 1000 : false;
  const lowStockAlerts = settingsMap.get('low_stock_alerts_enabled') !== false;
  const digestEnabled = settingsMap.get('daily_digest_enabled') === true;
  const digestTime = settingsMap.get('daily_digest_time') || null;

  const developerKeyConfigured = Boolean((process.env.DEVELOPER_API_KEY || '').trim());
  const developerOtpConfigured = Boolean((process.env.DEVELOPER_SECOND_FACTOR || '').trim());
  const tokenSecretsHardened = [
    ...(config.auth.jwtSecrets || []),
    ...(config.auth.refreshSecrets || [])
  ].every(isStrongSecret);

  const checks = [
    {
      id: 'admin-account',
      title: 'Dedicated administrator account',
      description: 'Ensure at least one admin exists to manage permissions and billing.',
      ok: adminCount > 0,
      recommendation: 'Invite an administrator from User management so someone can manage accounts.'
    },
    {
      id: 'developer-account',
      title: 'Developer maintenance account',
      description: 'Keep a developer account available for secure maintenance tasks.',
      ok: developerCount > 0,
      recommendation: 'Promote a trusted engineer to the developer role for maintenance access.'
    },
    {
      id: 'developer-mfa',
      title: 'Developer multi-factor secrets configured',
      description: 'Developer key and one-time passcode must both be set in the environment.',
      ok: developerKeyConfigured && developerOtpConfigured,
      recommendation: 'Set DEVELOPER_API_KEY and DEVELOPER_SECOND_FACTOR environment variables.'
    },
    {
      id: 'token-secrets',
      title: 'Hardened API token secrets',
      description: 'JWT and refresh token secrets should be at least 16 characters.',
      ok: tokenSecretsHardened,
      recommendation: 'Rotate JWT_SECRETS and REFRESH_SECRETS to long, random strings.'
    },
    {
      id: 'backup-schedule',
      title: 'Automated backups enabled',
      description: 'Nightly SQL backups prevent catastrophic data loss.',
      ok: backupEnabled,
      recommendation: 'Enable backups in Operations & alerts and confirm schedule is valid.'
    },
    {
      id: 'recent-backup',
      title: 'Recent backup available',
      description: 'Keep at least one backup generated within the past 7 days.',
      ok: backupFresh,
      recommendation: 'Trigger a manual backup so the latest snapshot is less than a week old.'
    },
    {
      id: 'alerting',
      title: 'Operational alerts configured',
      description: 'Configure low-stock alerts and escalation email recipients.',
      ok: lowStockAlerts && notificationEmails.length > 0,
      recommendation: 'Enable low stock alerts and add escalation emails under Operations & alerts.'
    },
    {
      id: 'org-contact',
      title: 'Organization contact details complete',
      description: 'Provide contact email and timezone to localise notifications.',
      ok: Boolean(organization?.contact_email) && Boolean(organization?.timezone),
      recommendation: 'Update contact email and timezone in the Organization profile.'
    },
    {
      id: 'digest',
      title: 'Daily digest configured',
      description: 'Send a daily digest to track work orders and inventory health.',
      ok: digestEnabled && Boolean(digestTime),
      recommendation: 'Enable the daily digest and choose a delivery time in Operations & alerts.'
    }
  ];

  return {
    generated_at: new Date().toISOString(),
    checks,
    summary: {
      backup_enabled: backupEnabled,
      latest_backup: latestBackup?.createdAt || null,
      notification_recipients: notificationEmails.length
    }
  };
}
