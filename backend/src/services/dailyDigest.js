import cron from 'node-cron';
import { Op } from 'sequelize';
import { Organization, UserActivity } from '../db.js';
import { getAllSettings, upsertSettings } from './settings.js';
import { notifyDailyActivitySummary } from './notificationService.js';
import { presentActivity } from './activityLog.js';

let digestTask = null;

function parseTime(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

async function processOrganizationDigest(organization, options = {}) {
  const settings = await getAllSettings(false, organization.id);
  const enabled = settings.get('daily_digest_enabled') === true;
  if (!enabled) {
    return;
  }

  const timeSetting = settings.get('daily_digest_time') || '18:00';
  const parsedTime = parseTime(timeSetting);
  if (!parsedTime) {
    console.warn(`[digest] Invalid time configuration "${timeSetting}" for organization ${organization.id}.`);
    return;
  }

  const now = options.now ?? new Date();
  const target = new Date(now);
  target.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);

  const lastSentRaw = settings.get('daily_digest_last_sent');
  const lastSent = lastSentRaw ? new Date(lastSentRaw) : null;
  if (lastSent && !Number.isNaN(lastSent.getTime()) && lastSent >= target) {
    return;
  }
  if (now < target) {
    return;
  }

  const windowStart = lastSent && !Number.isNaN(lastSent.getTime())
    ? new Date(lastSent)
    : new Date(target.getTime() - 24 * 60 * 60 * 1000);

  const activities = await UserActivity.findAll({
    where: {
      organizationId: organization.id,
      createdAt: { [Op.gt]: windowStart }
    },
    order: [['createdAt', 'ASC']],
    include: [{ association: 'user', attributes: ['id', 'full_name', 'email'] }]
  });

  const presented = activities.map(presentActivity);
  await notifyDailyActivitySummary({
    organizationId: organization.id,
    activities: presented,
    generatedAt: now
  });

  await upsertSettings({ daily_digest_last_sent: now.toISOString() }, organization.id);
}

async function runDigest(options = {}) {
  try {
    const organizations = await Organization.findAll({ attributes: ['id'], skipOrganizationScope: true });
    for (const organization of organizations) {
      try {
        await processOrganizationDigest(organization, options);
      } catch (error) {
        console.error(`[digest] Failed to process organization ${organization.id}:`, error);
      }
    }
  } catch (error) {
    console.error('[digest] Unable to fetch organizations for daily digest', error);
  }
}

export function scheduleDailyDigest() {
  if (digestTask) {
    digestTask.stop();
    digestTask = null;
  }
  digestTask = cron.schedule('*/5 * * * *', () => {
    runDigest().catch((error) => {
      console.error('[digest] Execution error', error);
    });
  });
  digestTask.start();
}

export async function runDailyDigestOnce(options = {}) {
  await runDigest(options);
}

