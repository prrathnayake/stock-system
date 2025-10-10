import NodeCache from 'node-cache';
import { Setting } from '../db.js';

const cache = new NodeCache({ stdTTL: 60 });
const CACHE_KEY = 'settings-map';

function parseValue(setting) {
  if (!setting) return null;
  const { value, type } = setting;
  switch (type) {
    case 'number':
      return Number(value);
    case 'boolean':
      return value === 'true';
    case 'json':
      try {
        return JSON.parse(value);
      } catch (err) {
        return null;
      }
    default:
      return value;
  }
}

function serialiseValue(value) {
  if (typeof value === 'boolean') {
    return { value: value ? 'true' : 'false', type: 'boolean' };
  }
  if (typeof value === 'number') {
    return { value: String(value), type: 'number' };
  }
  if (typeof value === 'object' && value !== null) {
    return { value: JSON.stringify(value), type: 'json' };
  }
  return { value: String(value), type: 'string' };
}

export async function getAllSettings(force = false) {
  if (!force) {
    const cached = cache.get(CACHE_KEY);
    if (cached) return cached;
  }
  const rows = await Setting.findAll();
  const map = new Map();
  for (const row of rows) {
    map.set(row.key, parseValue(row));
  }
  cache.set(CACHE_KEY, map);
  return map;
}

export async function getSetting(key, defaultValue = null) {
  const settings = await getAllSettings();
  return settings.has(key) ? settings.get(key) : defaultValue;
}

export async function upsertSettings(entries) {
  const updates = [];
  for (const [key, rawValue] of Object.entries(entries)) {
    const { value, type } = serialiseValue(rawValue);
    updates.push(Setting.upsert({ key, value, type }));
  }
  await Promise.all(updates);
  cache.del(CACHE_KEY);
}

export function clearSettingsCache() {
  cache.del(CACHE_KEY);
}
