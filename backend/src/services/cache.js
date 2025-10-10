import { redis } from '../redis/client.js';
import { config } from '../config.js';
import { getOrganizationId } from './requestContext.js';

const STOCK_OVERVIEW_CACHE_KEY = 'cache:stock:overview:v1';

function overviewCacheKey(organizationId) {
  return `${STOCK_OVERVIEW_CACHE_KEY}:${organizationId}`;
}

function resolveOrganizationId(organizationId) {
  return organizationId ?? getOrganizationId();
}

export async function getCachedStockOverview(organizationId) {
  const orgId = resolveOrganizationId(organizationId);
  if (!orgId) return null;
  try {
    const payload = await redis.get(overviewCacheKey(orgId));
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch (err) {
      console.warn('[cache] failed to parse stock overview cache, clearing', err);
      await redis.del(overviewCacheKey(orgId));
      return null;
    }
  } catch (err) {
    console.error('[cache] unable to read stock overview cache', err);
    return null;
  }
}

export async function cacheStockOverview(data, organizationId) {
  const orgId = resolveOrganizationId(organizationId);
  if (!orgId) return;
  try {
    const ttl = Math.max(5, config.cache.stockOverviewTtl || 0);
    await redis.set(overviewCacheKey(orgId), JSON.stringify(data), 'EX', ttl);
  } catch (err) {
    console.error('[cache] unable to store stock overview cache', err);
  }
}

export async function invalidateStockOverviewCache(organizationId) {
  const orgId = resolveOrganizationId(organizationId);
  if (!orgId) return;
  try {
    await redis.del(overviewCacheKey(orgId));
  } catch (err) {
    console.error('[cache] unable to invalidate stock overview cache', err);
  }
}

export const stockCacheKeys = {
  overview: STOCK_OVERVIEW_CACHE_KEY
};
