import { Router } from 'express';
import { z } from 'zod';
import { Product, StockLevel, StockMove, sequelize, Bin } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import {
  notifyProductArchived,
  notifyProductCreated,
  notifyProductUpdated
} from '../services/notificationService.js';

const router = Router();

const ProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  uom: z.string().default('ea'),
  track_serial: z.boolean().default(false),
  reorder_point: z.number().int().nonnegative().default(0),
  lead_time_days: z.number().int().nonnegative().default(0),
  unit_price: z.number().nonnegative().default(0),
  active: z.boolean().default(true)
});

const UpdateSchema = ProductSchema.partial().refine((payload) => Object.keys(payload).length > 0, {
  message: 'At least one field must be provided for an update.'
});

router.get('/', requireAuth(), asyncHandler(async (_req, res) => {
  const products = await Product.findAll({ order: [['id','ASC']] });
  res.json(products);
}));

router.post('/', requireAuth(['admin','user','developer']), asyncHandler(async (req, res) => {
  const parse = ProductSchema.safeParse(req.body);
  if (!parse.success) {
    throw new HttpError(400, 'Invalid request payload', parse.error.flatten());
  }
  const existing = await Product.findOne({ where: { sku: parse.data.sku } });
  if (existing) {
    throw new HttpError(409, 'A product with that SKU already exists');
  }
  const created = await Product.create(parse.data);
  await invalidateStockOverviewCache(created.organizationId);
  const payload = created.get({ plain: true });
  res.status(201).json(created);
  notifyProductCreated({
    organizationId: req.user.organization_id,
    actor: req.user,
    product: payload
  }).catch((error) => {
    console.error('[notify] failed to send product creation email', error);
  });
}));

router.patch('/:id', requireAuth(['admin','user','developer']), asyncHandler(async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Invalid product id');
  }

  const product = await Product.findByPk(id);
  if (!product) {
    throw new HttpError(404, 'Product not found');
  }

  if (parsed.data.sku && parsed.data.sku !== product.sku) {
    const exists = await Product.findOne({ where: { sku: parsed.data.sku } });
    if (exists) {
      throw new HttpError(409, 'A product with that SKU already exists');
    }
  }

  Object.entries(parsed.data).forEach(([key, value]) => {
    if (typeof value !== 'undefined') {
      product[key] = value;
    }
  });

  await product.save();
  await invalidateStockOverviewCache(product.organizationId);
  res.json(product);
  const after = product.get({ plain: true });
  notifyProductUpdated({
    organizationId: req.user.organization_id,
    actor: req.user,
    product: after,
    changes: Object.keys(parsed.data)
  }).catch((error) => {
    console.error('[notify] failed to send product update email', error);
  });
}));

router.delete('/:id', requireAuth(['admin','user','developer']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, 'Invalid product id');
  }

  const product = await Product.findByPk(id);
  if (!product) {
    throw new HttpError(404, 'Product not found');
  }

  const snapshot = product.get({ plain: true });

  await sequelize.transaction(async (t) => {
    const levels = await StockLevel.findAll({
      where: { productId: id },
      transaction: t,
      lock: t.LOCK.UPDATE,
      include: [{ model: Bin }]
    });

    for (const level of levels) {
      if (level.on_hand > 0) {
        await StockMove.create({
          productId: id,
          qty: level.on_hand,
          from_bin_id: level.binId,
          to_bin_id: null,
          reason: 'adjust',
          performed_by: req.user?.id ?? null
        }, { transaction: t });
      }

      await level.destroy({ transaction: t });
    }

    product.active = false;
    await product.save({ transaction: t });
  });

  await invalidateStockOverviewCache(product.organizationId);
  res.status(204).send();
  notifyProductArchived({
    organizationId: req.user.organization_id,
    actor: req.user,
    product: snapshot
  }).catch((error) => {
    console.error('[notify] failed to send product archive email', error);
  });
}));

export default router;
