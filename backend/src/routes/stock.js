import { Router } from 'express';
import { z } from 'zod';
import { Product, Bin, Location, StockLevel, StockMove } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export default function createStockRoutes(io) {
  const router = Router();

  // Summaries per product (joins bins)
  router.get('/', requireAuth(), async (req, res) => {
    const sku = req.query.sku;
    const where = {};
    if (sku) where.sku = sku;
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
      return { id: p.id, sku: p.sku, name: p.name, on_hand, reserved, available: on_hand - reserved, bins };
    });
    res.json(data);
  });

  const MoveSchema = z.object({
    product_id: z.number().int().positive(),
    qty: z.number().int().nonnegative(),
    from_bin_id: z.number().int().positive().nullable(),
    to_bin_id: z.number().int().positive().nullable(),
    reason: z.enum(['receive','adjust','pick','return','transfer'])
  });

  router.post('/move', requireAuth(['inventory','admin','tech']), async (req, res) => {
    const parsed = MoveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { product_id, qty, from_bin_id, to_bin_id, reason } = parsed.data;

    // Load current levels
    const product = await Product.findByPk(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const fromBin = from_bin_id ? await Bin.findByPk(from_bin_id) : null;
    const toBin = to_bin_id ? await Bin.findByPk(to_bin_id) : null;

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
        if (fromLevel.on_hand < qty) throw new Error('Insufficient stock in source bin');
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
        reason
      }, { transaction: t });

      return move;
    });

    // Broadcast update
    io.emit('stock:update', { product_id, hint: 'move' });
    res.status(201).json({ ok: true, move: result });
  });

  return router;
}
