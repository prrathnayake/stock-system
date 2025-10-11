import { User } from '../db.js';

const presenceUpdateCache = new Map();
const TOUCH_INTERVAL_MS = 60 * 1000;
export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export function isUserOnline(lastSeenAt, now = new Date()) {
  if (!lastSeenAt) return false;
  const lastSeenDate = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  if (Number.isNaN(lastSeenDate.getTime())) {
    return false;
  }
  return now.getTime() - lastSeenDate.getTime() <= ONLINE_THRESHOLD_MS;
}

export async function touchUserPresence(userId, { force = false, organizationId = null } = {}) {
  if (!userId) return;
  const now = Date.now();
  const lastUpdate = presenceUpdateCache.get(userId);
  if (!force && lastUpdate && now - lastUpdate < TOUCH_INTERVAL_MS) {
    return;
  }

  presenceUpdateCache.set(userId, now);

  const updateOptions = {
    where: { id: userId },
    silent: true,
    individualHooks: false
  };

  if (organizationId) {
    updateOptions.where.organizationId = organizationId;
  } else {
    updateOptions.skipOrganizationScope = true;
  }

  try {
    await User.update({ last_seen_at: new Date(now) }, updateOptions);
  } catch (error) {
    presenceUpdateCache.delete(userId);
    console.warn(`[presence] failed to update last seen for user ${userId}: ${error.message}`);
  }
}
