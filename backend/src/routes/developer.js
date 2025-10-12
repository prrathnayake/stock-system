import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  cleanupDuplicateCustomerPhoneIndexes,
  cleanupDuplicateOrganizationSlugIndexes
} from '../startup/bootstrap.js';
import { Bin, Location, Product, StockLevel, sequelize, withTransaction } from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { invalidateStockOverviewCache } from '../services/cache.js';

const router = Router();

const SeedSchema = z.object({
  products: z.array(z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    uom: z.string().max(16).optional(),
    track_serial: z.boolean().optional(),
    reorder_point: z.number().int().nonnegative().optional(),
    lead_time_days: z.number().int().nonnegative().optional(),
    unit_price: z.number().nonnegative().optional()
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
    on_hand: z.number().int().nonnegative().optional(),
    reserved: z.number().int().nonnegative().optional()
  })).default([])
});

function verifyMultiFactor(req, res, next) {
  const primarySecret = (process.env.DEVELOPER_API_KEY || '').trim();
  const secondarySecret = (process.env.DEVELOPER_SECOND_FACTOR || '').trim();

  if (!primarySecret || !secondarySecret) {
    console.warn('[developer] Multi-factor secrets are not configured.');
    return res.status(500).json({ error: 'Developer multi-factor secrets are not configured' });
  }

  const providedPrimary = (req.headers['x-developer-key'] || '').toString().trim();
  const providedSecondary = (req.headers['x-developer-otp'] || '').toString().trim();

  if (providedPrimary !== primarySecret || providedSecondary !== secondarySecret) {
    return res.status(401).json({ error: 'Developer multi-factor verification failed' });
  }

  return next();
}

router.post(
  '/maintenance/cleanup',
  requireAuth(['developer']),
  verifyMultiFactor,
  asyncHandler(async (_req, res) => {
    await cleanupDuplicateOrganizationSlugIndexes();
    await cleanupDuplicateCustomerPhoneIndexes();
    await sequelize.sync({ alter: false });

    res.json({
      ok: true,
      completed_at: new Date().toISOString(),
      message: 'Database maintenance completed successfully'
    });
  })
);

router.post(
  '/sessions/terminal',
  requireAuth(['developer']),
  verifyMultiFactor,
  asyncHandler(async (_req, res) => {
    const sessionId = crypto.randomUUID();
    const issuedAt = new Date();
    res.status(201).json({
      session_id: sessionId,
      issued_at: issuedAt.toISOString(),
      expires_in: 300,
      command: `stockctl shell --session ${sessionId}`
    });
  })
);

function normaliseKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

router.get(
  '/seed/sample',
  requireAuth(['developer']),
  verifyMultiFactor,
  asyncHandler(async (_req, res) => {
    const sample = {
      products: [
        {
          sku: 'TOOL-SET-001',
          name: 'Technician starter kit',
          reorder_point: 5,
          lead_time_days: 7,
          unit_price: 249.5
        },
        {
          sku: 'LAPTOP-15',
          name: 'Service laptop 15"',
          reorder_point: 2,
          lead_time_days: 5,
          unit_price: 1399,
          track_serial: true
        }
      ],
      locations: [
        {
          site: 'Sydney HQ',
          room: 'Service Bay',
          notes: 'Primary repair hub'
        },
        {
          site: 'Melbourne Depot',
          room: 'Logistics',
          notes: 'Forward staging area'
        }
      ],
      bins: [
        { code: 'SYD-A1', location_site: 'Sydney HQ' },
        { code: 'SYD-B2', location_site: 'Sydney HQ' },
        { code: 'MEL-A1', location_site: 'Melbourne Depot' }
      ],
      stock: [
        { sku: 'TOOL-SET-001', bin: 'SYD-A1', on_hand: 12 },
        { sku: 'TOOL-SET-001', bin: 'MEL-A1', on_hand: 4, reserved: 1 },
        { sku: 'LAPTOP-15', bin: 'SYD-B2', on_hand: 6, reserved: 2 }
      ]
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="stock-seed-sample.json"');
    res.send(JSON.stringify(sample, null, 2));
  })
);

router.post(
  '/seed',
  requireAuth(['developer']),
  verifyMultiFactor,
  asyncHandler(async (req, res) => {
    const parse = SeedSchema.safeParse(req.body);
    if (!parse.success) {
      throw new HttpError(400, 'Invalid seed payload', parse.error.flatten());
    }

    const { products, locations, bins, stock } = parse.data;
    const organizationId = req.user.organization_id;

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

      for (const entry of locations) {
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

      for (const entry of products) {
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

      for (const entry of bins) {
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

      for (const entry of stock) {
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

    await invalidateStockOverviewCache(organizationId);

    res.status(201).json({
      ok: true,
      seeded_at: new Date().toISOString(),
      summary
    });
  })
);

export default router;
