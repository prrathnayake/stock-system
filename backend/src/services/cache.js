import { redis } from '../redis/client.js';
import { config } from '../config.js';

const STOCK_OVERVIEW_CACHE_KEY = 'cache:stock:overview:v1';

export async function getCachedStockOverview() {
  try {
    const payload = await redis.get(STOCK_OVERVIEW_CACHE_KEY);
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch (err) {
      console.warn('[cache] failed to parse stock overview cache, clearing', err);
      await redis.del(STOCK_OVERVIEW_CACHE_KEY);
      return null;
    }
  } catch (err) {
    console.error('[cache] unable to read stock overview cache', err);
    return null;
  }
}

export async function cacheStockOverview(data) {
  try {
    const ttl = Math.max(5, config.cache.stockOverviewTtl || 0);
    await redis.set(STOCK_OVERVIEW_CACHE_KEY, JSON.stringify(data), 'EX', ttl);
  } catch (err) {
    console.error('[cache] unable to store stock overview cache', err);
  }
}

export async function invalidateStockOverviewCache() {
  try {
    await redis.del(STOCK_OVERVIEW_CACHE_KEY);
  } catch (err) {
    console.error('[cache] unable to invalidate stock overview cache', err);
  }
}

export const stockCacheKeys = {
  overview: STOCK_OVERVIEW_CACHE_KEY
};
