import { Router } from 'express';
import { z } from 'zod';
import { WorkOrder, WorkOrderPart, Product, Bin, StockLevel } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export default function createWorkOrderRoutes(io) {
  const router = Router();

  router.get('/', requireAuth(), async (req, res) => {
    const rows = await WorkOrder.findAll({ include: [WorkOrderPart] });
    res.json(rows);
  });

  const CreateSchema = z.object({
    customer_name: z.string().min(1),
    device_info: z.string().min(1),
    parts: z.array(z.object({
      product_id: z.number().int().positive(),
      qty: z.number().int().positive()
    })).default([])
  });

  router.post('/', requireAuth(['desk','admin','inventory']), async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const wo = await WorkOrder.create({
      customer_name: parsed.data.customer_name,
      device_info: parsed.data.device_info
    });

    for (const p of parsed.data.parts) {
      await WorkOrderPart.create({ workOrderId: wo.id, productId: p.product_id, qty_needed: p.qty });
    }
    res.status(201).json(wo);
  });

  // Reserve parts
  const ReserveSchema = z.object({
    items: z.array(z.object({
      part_id: z.number().int().positive(),
      qty: z.number().int().positive()
    }))
  });

  router.post('/:id/reserve', requireAuth(['inventory','admin']), async (req, res) => {
    const { id } = req.params;
    const parsed = ReserveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const wo = await WorkOrder.findByPk(id);
    if (!wo) return res.status(404).json({ error: 'Work order not found' });

    await StockLevel.sequelize.transaction(async (t) => {
      for (const item of parsed.data.items) {
        const part = await WorkOrderPart.findByPk(item.part_id);
        if (!part) throw new Error('Part not found');
        const levels = await StockLevel.findAll({ where: { productId: part.productId }, transaction: t, lock: t.LOCK.UPDATE });
        const totalAvail = levels.reduce((s, l) => s + (l.on_hand - l.reserved), 0);
        if (totalAvail < item.qty) throw new Error('Insufficient available stock to reserve');

        let remaining = item.qty;
        for (const lvl of levels) {
          const avail = lvl.on_hand - lvl.reserved;
          if (avail <= 0) continue;
          const take = Math.min(avail, remaining);
          lvl.reserved += take;
          await lvl.save({ transaction: t });
          remaining -= take;
          if (remaining === 0) break;
        }
        part.qty_reserved += item.qty;
        await part.save({ transaction: t });
      }
    });

    io.emit('stock:update', { work_order_id: Number(id), hint: 'reserve' });
    res.json({ ok: true });
  });

  // Pick parts from a specific bin (scan workflow)
  const PickSchema = z.object({
    part_id: z.number().int().positive(),
    bin_id: z.number().int().positive(),
    qty: z.number().int().positive()
  });

  router.post('/:id/pick', requireAuth(['tech','inventory','admin']), async (req, res) => {
    const { id } = req.params;
    const parsed = PickSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const wo = await WorkOrder.findByPk(id);
    if (!wo) return res.status(404).json({ error: 'Work order not found' });

    await StockLevel.sequelize.transaction(async (t) => {
      const part = await WorkOrderPart.findByPk(parsed.data.part_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!part) throw new Error('Part not found');
      if (part.qty_reserved < parsed.data.qty) throw new Error('Not enough reserved quantity');

      const lvl = await StockLevel.findOne({ where: { productId: part.productId, binId: parsed.data.bin_id }, transaction: t, lock: t.LOCK.UPDATE });
      if (!lvl || lvl.on_hand < parsed.data.qty) throw new Error('Insufficient on-hand in bin');
      if (lvl.reserved < parsed.data.qty) throw new Error('Reserved in this bin is insufficient');

      lvl.on_hand -= parsed.data.qty;
      lvl.reserved -= parsed.data.qty;
      await lvl.save({ transaction: t });

      part.qty_picked += parsed.data.qty;
      part.qty_reserved -= parsed.data.qty;
      await part.save({ transaction: t });
    });

    io.emit('stock:update', { work_order_id: Number(id), hint: 'pick' });
    res.json({ ok: true });
  });

  return router;
}
