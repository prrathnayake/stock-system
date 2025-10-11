import { Router } from 'express';
import { z } from 'zod';
import { Op } from 'sequelize';
import { Product, Bin, Location, StockLevel, StockMove, User } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { getCachedStockOverview, cacheStockOverview, invalidateStockOverviewCache } from '../services/cache.js';
import { enqueueLowStockScan } from '../queues/lowStock.js';
import { notifyInventoryAdjustment } from '../services/notificationService.js';

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
      distinct: true,
      include: [{
        model: Bin,
        required: false,
        through: { model: StockLevel },
        include: [Location]
      }]
    });
    const data = products.map(p => {
      let on_hand = 0, reserved = 0;
      const bins = [];
      const relatedBins = Array.isArray(p.bins) ? p.bins : [];
      relatedBins.forEach(b => {
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
      include: [
        Product,
        { model: Bin, as: 'fromBin', attributes: ['id', 'code'] },
        { model: Bin, as: 'toBin', attributes: ['id', 'code'] },
        { model: User, as: 'performedBy', attributes: ['id', 'full_name', 'email'] }
      ]
    });

    const payload = {
      productCount: products.length,
      lowStockCount,
      reservedCount,
      recentActivity: latestMoves.map(move => ({
        id: move.id,
        sku: move.product?.sku,
        productName: move.product?.name || null,
        qty: move.qty,
        reason: move.reason,
        occurredAt: move.createdAt,
        fromBin: move.fromBin?.code || null,
        toBin: move.toBin?.code || null,
        performedBy: move.performedBy?.full_name || move.performedBy?.email || null
      }))
    };

    await cacheStockOverview(payload, organizationId);
    res.json(payload);
  }));

  router.get('/:productId/history', requireAuth(), asyncHandler(async (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new HttpError(400, 'Invalid product id');
    }

    const product = await Product.findByPk(productId);
    if (!product) {
      throw new HttpError(404, 'Product not found');
    }

    const moves = await StockMove.findAll({
      where: { productId },
      order: [['createdAt', 'ASC']],
      include: [
        { model: Bin, as: 'fromBin', attributes: ['id', 'code'] },
        { model: Bin, as: 'toBin', attributes: ['id', 'code'] },
        { model: User, as: 'performedBy', attributes: ['id', 'full_name'] }
      ]
    });

    let level = 0;
    const datapoints = moves.map((move) => {
      const decrease = move.from_bin_id ? move.qty : 0;
      const increase = move.to_bin_id ? move.qty : 0;
      const delta = increase - decrease;
      level += delta;
      return {
        id: move.id,
        occurredAt: move.createdAt,
        qty: move.qty,
        delta,
        level,
        reason: move.reason,
        fromBin: move.fromBin ? move.fromBin.code : null,
        toBin: move.toBin ? move.toBin.code : null,
        performedBy: move.performedBy ? move.performedBy.full_name : null
      };
    });

    const lastMove = moves.length ? moves[moves.length - 1] : null;

    res.json({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku
      },
      datapoints,
      summary: {
        lastUpdated: lastMove ? lastMove.createdAt : product.updatedAt,
        totalMoves: moves.length,
        currentLevel: level
      }
    });
  }));

  const MoveSchema = z.object({
    product_id: z.number().int().positive(),
    qty: z.number().int().positive(),
    from_bin_id: z.number().int().positive().nullable(),
    to_bin_id: z.number().int().positive().nullable(),
    reason: z.enum(['receive','adjust','pick','return','transfer'])
  });

  const LevelUpdateSchema = z.object({
    on_hand: z.number().int().nonnegative().optional(),
    reserved: z.number().int().nonnegative().optional()
  }).refine((payload) => typeof payload.on_hand !== 'undefined' || typeof payload.reserved !== 'undefined', {
    message: 'Provide at least one field to update.'
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
    notifyInventoryAdjustment({
      organizationId: req.user.organization_id,
      actor: req.user,
      product: { name: product.name, sku: product.sku },
      qty,
      reason,
      fromBin: fromBin ? { code: fromBin.code } : null,
      toBin: toBin ? { code: toBin.code } : null
    }).catch((error) => {
      console.error('[notify] failed to send inventory adjustment email', error);
    });
  }));

  router.patch('/:productId/levels', requireAuth(['admin','user']), asyncHandler(async (req, res) => {
    const parsed = LevelUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new HttpError(400, 'Invalid product id');
    }

    const product = await Product.findByPk(productId);
    if (!product) {
      throw new HttpError(404, 'Product not found');
    }

    const result = await StockLevel.sequelize.transaction(async (t) => {
      const levels = await StockLevel.findAll({
        where: { productId },
        order: [['binId', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (levels.length === 0) {
        throw new HttpError(400, 'Assign this product to a bin before adjusting stock levels.');
      }

      const current = levels.reduce((acc, level) => {
        acc.on_hand += level.on_hand;
        acc.reserved += level.reserved;
        return acc;
      }, { on_hand: 0, reserved: 0 });

      const targetOnHand = typeof parsed.data.on_hand === 'number' ? parsed.data.on_hand : current.on_hand;
      const targetReserved = typeof parsed.data.reserved === 'number' ? parsed.data.reserved : current.reserved;

      if (targetReserved > targetOnHand) {
        throw new HttpError(400, 'Reserved quantity cannot exceed on-hand quantity.');
      }

      const onHandDelta = targetOnHand - current.on_hand;
      const reservedDelta = targetReserved - current.reserved;

      if (onHandDelta > 0) {
        const primary = levels[0];
        primary.on_hand += onHandDelta;
        await primary.save({ transaction: t });
        await StockMove.create({
          productId,
          qty: onHandDelta,
          from_bin_id: null,
          to_bin_id: primary.binId,
          reason: 'adjust',
          performed_by: req.user?.id ?? null
        }, { transaction: t });
      } else if (onHandDelta < 0) {
        let remaining = -onHandDelta;
        const ordered = [...levels].sort((a, b) => b.on_hand - a.on_hand);
        for (const level of ordered) {
          if (remaining <= 0) break;
          const take = Math.min(level.on_hand, remaining);
          if (take <= 0) continue;
          level.on_hand -= take;
          if (level.on_hand < 0) {
            throw new HttpError(400, 'Cannot reduce on-hand below zero.');
          }
          await level.save({ transaction: t });
          await StockMove.create({
            productId,
            qty: take,
            from_bin_id: level.binId,
            to_bin_id: null,
            reason: 'adjust',
            performed_by: req.user?.id ?? null
          }, { transaction: t });
          remaining -= take;
        }
        if (remaining > 0) {
          throw new HttpError(400, 'Not enough stock available to remove that quantity.');
        }
      }

      if (reservedDelta !== 0) {
        if (reservedDelta > 0) {
          let remaining = reservedDelta;
          const ordered = [...levels].sort((a, b) => (b.on_hand - b.reserved) - (a.on_hand - a.reserved));
          for (const level of ordered) {
            if (remaining <= 0) break;
            const available = level.on_hand - level.reserved;
            if (available <= 0) continue;
            const take = Math.min(available, remaining);
            level.reserved += take;
            await level.save({ transaction: t });
            remaining -= take;
          }
          if (remaining > 0) {
            throw new HttpError(400, 'Not enough available stock to reserve that quantity.');
          }
        } else {
          let remaining = -reservedDelta;
          const ordered = [...levels].sort((a, b) => b.reserved - a.reserved);
          for (const level of ordered) {
            if (remaining <= 0) break;
            const release = Math.min(level.reserved, remaining);
            if (release <= 0) continue;
            level.reserved -= release;
            await level.save({ transaction: t });
            remaining -= release;
          }
          if (remaining > 0) {
            throw new HttpError(400, 'Reserved quantity cannot go below zero.');
          }
        }
      }

      return {
        on_hand: targetOnHand,
        reserved: targetReserved,
        available: targetOnHand - targetReserved
      };
    });

    io.emit('stock:update', { product_id: productId, hint: 'levels', organization_id: req.user.organization_id });
    await invalidateStockOverviewCache(req.user.organization_id);
    enqueueLowStockScan({ delay: 500, organizationId: req.user.organization_id }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });

    res.json({ ok: true, levels: result });
  }));

  return router;
}
