import { Router } from 'express';
import { z } from 'zod';
import { Op } from 'sequelize';
import { Product, Bin, Location, StockLevel, StockMove } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { getCachedStockOverview, cacheStockOverview, invalidateStockOverviewCache } from '../services/cache.js';
import { enqueueLowStockScan } from '../queues/lowStock.js';

export default function createStockRoutes(io) {
  const router = Router();

  // Summaries per product (joins bins)
  router.get('/', requireAuth(), asyncHandler(async (req, res) => {
    const sku = req.query.sku;
    const where = { active: true };
    if (sku) {
      where[Op.or] = [
        { sku },
        { name: { [Op.like]: `%${sku}%` } }
      ];
    }
    const products = await Product.findAll({
      where,
      include: [{
        model: Bin,
        through: { model: StockLevel },
        include: [Location]
      }]
    });
    const data = products.map(p => {
      let on_hand = 0, reserved = 0;
      const bins = [];
      p.bins.forEach(b => {
        const lvl = b.stock_level;
        on_hand += lvl.on_hand;
        reserved += lvl.reserved;
        bins.push({
          bin_id: b.id,
          bin_code: b.code,
          location: b.location?.site || null,
          on_hand: lvl.on_hand,
          reserved: lvl.reserved
        });
      });
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        reorder_point: p.reorder_point,
        lead_time_days: p.lead_time_days,
        on_hand,
        reserved,
        available: on_hand - reserved,
        bins
      };
    });
    res.json(data);
  }));

  router.get('/overview', requireAuth(), asyncHandler(async (req, res) => {
    const organizationId = req.user.organization_id;
    const cached = await getCachedStockOverview(organizationId);
    if (cached) {
      return res.json(cached);
    }

    const products = await Product.findAll({
      where: { active: true },
      include: [{
        model: Bin,
        through: { model: StockLevel }
      }]
    });

    let reservedCount = 0;
    let lowStockCount = 0;

    products.forEach((product) => {
      let onHand = 0;
      let reserved = 0;
      product.bins.forEach((bin) => {
        onHand += bin.stock_level.on_hand;
        reserved += bin.stock_level.reserved;
      });
      reservedCount += reserved;
      if (onHand - reserved <= product.reorder_point) {
        lowStockCount += 1;
      }
    });

    const latestMoves = await StockMove.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      include: [Product]
    });

    const payload = {
      productCount: products.length,
      lowStockCount,
      reservedCount,
      recentActivity: latestMoves.map(move => ({
        id: move.id,
        sku: move.product?.sku,
        qty: move.qty,
        reason: move.reason,
        occurredAt: move.createdAt
      }))
    };

    await cacheStockOverview(payload, organizationId);
    res.json(payload);
  }));

  const MoveSchema = z.object({
    product_id: z.number().int().positive(),
    qty: z.number().int().positive(),
    from_bin_id: z.number().int().positive().nullable(),
    to_bin_id: z.number().int().positive().nullable(),
    reason: z.enum(['receive','adjust','pick','return','transfer'])
  });

  router.post('/move', requireAuth(['admin','user']), asyncHandler(async (req, res) => {
    const parsed = MoveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const { product_id, qty, from_bin_id, to_bin_id, reason } = parsed.data;

    // Load current levels
    const product = await Product.findByPk(product_id);
    if (!product) {
      throw new HttpError(404, 'Product not found');
    }

    const fromBin = from_bin_id ? await Bin.findByPk(from_bin_id) : null;
    const toBin = to_bin_id ? await Bin.findByPk(to_bin_id) : null;
    if (from_bin_id && !fromBin) {
      throw new HttpError(404, 'Source bin not found');
    }
    if (to_bin_id && !toBin) {
      throw new HttpError(404, 'Destination bin not found');
    }
    if (!fromBin && !toBin) {
      throw new HttpError(400, 'A move requires at least one bin');
    }
    if (fromBin && toBin && fromBin.id === toBin.id) {
      throw new HttpError(400, 'Source and destination bins cannot match');
    }

    // Helper to get or create stock_level row
    const ensureLevel = async (prodId, binId, t) => {
      let level = await StockLevel.findOne({ where: { productId: prodId, binId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!level) level = await StockLevel.create({ productId: prodId, binId, on_hand: 0, reserved: 0 }, { transaction: t });
      return level;
    };

    // Transactional move
    const result = await StockLevel.sequelize.transaction(async (t) => {
      if (fromBin) {
        const fromLevel = await ensureLevel(product_id, fromBin.id, t);
        if (fromLevel.on_hand < qty) throw new HttpError(400, 'Insufficient stock in source bin');
        fromLevel.on_hand -= qty;
        await fromLevel.save({ transaction: t });
      }
      if (toBin) {
        const toLevel = await ensureLevel(product_id, toBin.id, t);
        toLevel.on_hand += qty;
        await toLevel.save({ transaction: t });
      }

      const move = await StockMove.create({
        productId: product_id,
        qty,
        from_bin_id,
        to_bin_id,
        reason,
        performed_by: req.user?.id ?? null
      }, { transaction: t });

      return move;
    });

    // Broadcast update
    io.emit('stock:update', { product_id, hint: 'move', organization_id: req.user.organization_id });
    await invalidateStockOverviewCache(req.user.organization_id);
    enqueueLowStockScan({ delay: 500, organizationId: req.user.organization_id }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });
    res.status(201).json({ ok: true, move: result });
  }));

  return router;
}
