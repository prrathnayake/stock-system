import { z } from 'zod';
import { Bin, Location, Product, StockLevel, withTransaction } from '../db.js';
import { HttpError } from '../utils/httpError.js';

const nonNegativeInt = z.number().int().nonnegative();
const nonNegativeNumber = z.number().nonnegative();

export const SeedSchema = z.object({
  products: z.array(z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    uom: z.string().max(16).optional(),
    track_serial: z.boolean().optional(),
    reorder_point: nonNegativeInt.optional(),
    lead_time_days: nonNegativeInt.optional(),
    unit_price: nonNegativeNumber.optional()
  })).default([]),
  locations: z.array(z.object({
    site: z.string().min(1),
    room: z.string().optional(),
    notes: z.string().optional()
  })).default([]),
  bins: z.array(z.object({
    code: z.string().min(1),
    location_site: z.string().min(1).optional(),
    location: z.string().min(1).optional()
  })).default([]),
  stock: z.array(z.object({
    sku: z.string().min(1),
    bin: z.string().min(1),
    on_hand: nonNegativeInt.optional(),
    reserved: nonNegativeInt.optional()
  })).default([])
});

function normaliseKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

export async function seedOrganizationData({ data, organizationId }) {
  const summary = {
    products: { created: 0, updated: 0 },
    locations: { created: 0, updated: 0 },
    bins: { created: 0, updated: 0 },
    stock: { created: 0, updated: 0 }
  };

  await withTransaction(async (transaction) => {
    const existingProducts = await Product.findAll({ transaction });
    const existingLocations = await Location.findAll({ transaction });
    const existingBins = await Bin.findAll({ transaction });

    const productMap = new Map(existingProducts.map((item) => [normaliseKey(item.sku), item]));
    const locationMap = new Map(existingLocations.map((item) => [normaliseKey(item.site), item]));
    const binMap = new Map(existingBins.map((item) => [normaliseKey(item.code), item]));

    for (const entry of data.locations) {
      const site = entry.site.trim();
      const key = normaliseKey(site);
      const room = entry.room ? entry.room.trim() : null;
      const notes = entry.notes ? entry.notes.trim() : null;
      const existing = locationMap.get(key);
      if (existing) {
        const updates = {};
        if (existing.room !== room) updates.room = room;
        if (existing.notes !== notes) updates.notes = notes;
        if (Object.keys(updates).length > 0) {
          await existing.update(updates, { transaction });
          summary.locations.updated += 1;
        }
      } else {
        const created = await Location.create({ site, room, notes }, { transaction });
        locationMap.set(key, created);
        summary.locations.created += 1;
      }
    }

    for (const entry of data.products) {
      const sku = entry.sku.trim();
      const key = normaliseKey(sku);
      const payload = {
        name: entry.name.trim(),
        uom: entry.uom ? entry.uom.trim() : 'ea',
        track_serial: entry.track_serial ?? false,
        reorder_point: entry.reorder_point ?? 0,
        lead_time_days: entry.lead_time_days ?? 0,
        unit_price: entry.unit_price ?? 0
      };
      const existing = productMap.get(key);
      if (existing) {
        await existing.update(payload, { transaction });
        summary.products.updated += 1;
      } else {
        const created = await Product.create({ sku, ...payload }, { transaction });
        productMap.set(key, created);
        summary.products.created += 1;
      }
    }

    for (const entry of data.bins) {
      const code = entry.code.trim();
      const key = normaliseKey(code);
      const locationSite = normaliseKey(entry.location_site || entry.location);
      if (!locationSite) {
        throw new HttpError(400, `Bin ${code} is missing a location reference`);
      }
      let location = locationMap.get(locationSite);
      if (!location) {
        const siteName = (entry.location_site || entry.location || '').trim();
        const createdLocation = await Location.create({ site: siteName }, { transaction });
        locationMap.set(locationSite, createdLocation);
        location = createdLocation;
        summary.locations.created += 1;
      }
      const existing = binMap.get(key);
      if (existing) {
        if (existing.locationId !== location.id) {
          await existing.update({ locationId: location.id }, { transaction });
          summary.bins.updated += 1;
        }
      } else {
        const created = await Bin.create({ code, locationId: location.id }, { transaction });
        binMap.set(key, created);
        summary.bins.created += 1;
      }
    }

    for (const entry of data.stock) {
      const product = productMap.get(normaliseKey(entry.sku));
      if (!product) {
        throw new HttpError(400, `Unknown product SKU ${entry.sku} in stock seed data`);
      }
      const bin = binMap.get(normaliseKey(entry.bin));
      if (!bin) {
        throw new HttpError(400, `Unknown bin code ${entry.bin} in stock seed data`);
      }
      const onHand = entry.on_hand ?? 0;
      const reserved = entry.reserved ?? 0;
      const existingLevel = await StockLevel.findOne({
        where: { productId: product.id, binId: bin.id },
        transaction
      });
      if (existingLevel) {
        await existingLevel.update({ on_hand: onHand, reserved }, { transaction });
        summary.stock.updated += 1;
      } else {
        await StockLevel.create({
          organizationId,
          productId: product.id,
          binId: bin.id,
          on_hand: onHand,
          reserved
        }, { transaction });
        summary.stock.created += 1;
      }
    }
  });

  return summary;
}
