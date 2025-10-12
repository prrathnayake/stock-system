import NodeCache from 'node-cache';
import { Setting } from '../db.js';
import { getOrganizationId } from './requestContext.js';

const cache = new NodeCache({ stdTTL: 60 });

function cacheKeyForOrg(organizationId) {
  return `settings-map:${organizationId}`;
}

function ensureOrganizationId(organizationId) {
  const orgId = organizationId ?? getOrganizationId();
  if (!orgId) {
    throw new Error('Organization context is required to access settings');
  }
  return orgId;
}

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

export async function getAllSettings(force = false, organizationId) {
  const orgId = ensureOrganizationId(organizationId);
  const cacheKey = cacheKeyForOrg(orgId);
  if (!force) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }
  const rows = await Setting.findAll({ skipOrganizationScope: false, where: { organizationId: orgId } });
  const map = new Map();
  for (const row of rows) {
    map.set(row.key, parseValue(row));
  }
  cache.set(cacheKey, map);
  return map;
}

export async function getSetting(key, defaultValue = null, organizationId) {
  const settings = await getAllSettings(false, organizationId);
  return settings.has(key) ? settings.get(key) : defaultValue;
}

export async function getFeatureFlags(organizationId) {
  const [
    barcodeScanning,
    workOrders,
    salesModule,
    operationsModule
  ] = await Promise.all([
    getSetting('barcode_scanning_enabled', true, organizationId),
    getSetting('work_orders_enabled', true, organizationId),
    getSetting('sales_module_enabled', true, organizationId),
    getSetting('operations_module_enabled', true, organizationId)
  ]);

  return {
    barcode_scanning_enabled: barcodeScanning !== false,
    work_orders_enabled: workOrders !== false,
    sales_module_enabled: salesModule !== false,
    operations_module_enabled: operationsModule !== false
  };
}

export async function upsertSettings(entries, organizationId) {
  const orgId = ensureOrganizationId(organizationId);
  const updates = [];
  for (const [key, rawValue] of Object.entries(entries)) {
    const { value, type } = serialiseValue(rawValue);
    updates.push(Setting.upsert({ organizationId: orgId, key, value, type }));
  }
  await Promise.all(updates);
  cache.del(cacheKeyForOrg(orgId));
}

export function clearSettingsCache(organizationId) {
  const orgId = ensureOrganizationId(organizationId);
  cache.del(cacheKeyForOrg(orgId));
}
