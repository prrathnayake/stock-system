import { Router } from 'express';
import { z } from 'zod';
import { WorkOrder, WorkOrderPart, Product, StockLevel, StockMove } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import { enqueueLowStockScan } from '../queues/lowStock.js';

export default function createWorkOrderRoutes(io) {
  const router = Router();

  router.get('/', requireAuth(), asyncHandler(async (_req, res) => {
    const rows = await WorkOrder.findAll({
      include: [{ model: WorkOrderPart, include: [Product] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(rows);
  }));

  const CreateSchema = z.object({
    customer_name: z.string().min(1),
    device_info: z.string().min(1),
    parts: z.array(z.object({
      product_id: z.number().int().positive(),
      qty: z.number().int().positive()
    })).default([])
  });

  router.post('/', requireAuth(['desk','admin','inventory']), asyncHandler(async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const wo = await WorkOrder.create({
      customer_name: parsed.data.customer_name,
      device_info: parsed.data.device_info
    });

    for (const p of parsed.data.parts) {
      await WorkOrderPart.create({ workOrderId: wo.id, productId: p.product_id, qty_needed: p.qty });
    }
    res.status(201).json(wo);
  }));

  // Reserve parts
  const ReserveSchema = z.object({
    items: z.array(z.object({
      part_id: z.number().int().positive(),
      qty: z.number().int().positive()
    }))
  });

  router.post('/:id/reserve', requireAuth(['inventory','admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const parsed = ReserveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const wo = await WorkOrder.findByPk(id);
    if (!wo) {
      throw new HttpError(404, 'Work order not found');
    }

    await StockLevel.sequelize.transaction(async (t) => {
      for (const item of parsed.data.items) {
        const part = await WorkOrderPart.findByPk(item.part_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!part) throw new HttpError(404, 'Part not found');
        if (part.workOrderId !== wo.id) {
          throw new HttpError(400, 'Part does not belong to this work order');
        }
        const levels = await StockLevel.findAll({ where: { productId: part.productId }, transaction: t, lock: t.LOCK.UPDATE });
        const totalAvail = levels.reduce((s, l) => s + (l.on_hand - l.reserved), 0);
        if (totalAvail < item.qty) throw new HttpError(400, 'Insufficient available stock to reserve');

        let remaining = item.qty;
        for (const lvl of levels) {
          const avail = lvl.on_hand - lvl.reserved;
          if (avail <= 0) continue;
          const take = Math.min(avail, remaining);
          lvl.reserved += take;
          await lvl.save({ transaction: t });
          if (take > 0) {
            await StockMove.create({
              productId: part.productId,
              qty: take,
              from_bin_id: lvl.binId,
              reason: 'reserve',
              workOrderId: wo.id,
              workOrderPartId: part.id,
              performed_by: req.user?.id ?? null
            }, { transaction: t });
          }
          remaining -= take;
          if (remaining === 0) break;
        }
        part.qty_reserved += item.qty;
        await part.save({ transaction: t });
      }
    });

    io.emit('stock:update', { work_order_id: Number(id), hint: 'reserve' });
    await invalidateStockOverviewCache();
    enqueueLowStockScan({ delay: 500 }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });
    res.json({ ok: true });
  }));

  // Pick parts from a specific bin (scan workflow)
  const PickSchema = z.object({
    part_id: z.number().int().positive(),
    bin_id: z.number().int().positive(),
    qty: z.number().int().positive()
  });

  router.post('/:id/pick', requireAuth(['tech','inventory','admin']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const parsed = PickSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const wo = await WorkOrder.findByPk(id);
    if (!wo) {
      throw new HttpError(404, 'Work order not found');
    }

    await StockLevel.sequelize.transaction(async (t) => {
      const part = await WorkOrderPart.findByPk(parsed.data.part_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!part) throw new HttpError(404, 'Part not found');
      if (part.workOrderId !== wo.id) {
        throw new HttpError(400, 'Part does not belong to this work order');
      }
      if (part.qty_reserved < parsed.data.qty) throw new HttpError(400, 'Not enough reserved quantity');

      const lvl = await StockLevel.findOne({ where: { productId: part.productId, binId: parsed.data.bin_id }, transaction: t, lock: t.LOCK.UPDATE });
      if (!lvl || lvl.on_hand < parsed.data.qty) throw new HttpError(400, 'Insufficient on-hand in bin');
      if (lvl.reserved < parsed.data.qty) throw new HttpError(400, 'Reserved in this bin is insufficient');

      lvl.on_hand -= parsed.data.qty;
      lvl.reserved -= parsed.data.qty;
      await lvl.save({ transaction: t });

      part.qty_picked += parsed.data.qty;
      part.qty_reserved -= parsed.data.qty;
      await part.save({ transaction: t });

      await StockMove.create({
        productId: part.productId,
        qty: parsed.data.qty,
        from_bin_id: parsed.data.bin_id,
        reason: 'pick',
        workOrderId: wo.id,
        workOrderPartId: part.id,
        performed_by: req.user?.id ?? null
      }, { transaction: t });
    });

    io.emit('stock:update', { work_order_id: Number(id), hint: 'pick' });
    await invalidateStockOverviewCache();
    enqueueLowStockScan({ delay: 500 }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });
    res.json({ ok: true });
  }));

  const ReturnSchema = z.object({
    part_id: z.number().int().positive(),
    bin_id: z.number().int().positive(),
    qty: z.number().int().positive(),
    source: z.enum(['picked', 'reserved']).default('picked')
  });

  router.post('/:id/return', requireAuth(['inventory','admin','tech']), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const parsed = ReturnSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const wo = await WorkOrder.findByPk(id);
    if (!wo) {
      throw new HttpError(404, 'Work order not found');
    }

    await StockLevel.sequelize.transaction(async (t) => {
      const part = await WorkOrderPart.findByPk(parsed.data.part_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!part) throw new HttpError(404, 'Part not found');
      if (part.workOrderId !== wo.id) {
        throw new HttpError(400, 'Part does not belong to this work order');
      }

      const lvl = await StockLevel.findOne({ where: { productId: part.productId, binId: parsed.data.bin_id }, transaction: t, lock: t.LOCK.UPDATE });
      if (!lvl) throw new HttpError(400, 'Bin does not track this product');

      if (parsed.data.source === 'picked') {
        if (part.qty_picked < parsed.data.qty) {
          throw new HttpError(400, 'Cannot return more than picked quantity');
        }
        part.qty_picked -= parsed.data.qty;
        lvl.on_hand += parsed.data.qty;
        await StockMove.create({
          productId: part.productId,
          qty: parsed.data.qty,
          to_bin_id: parsed.data.bin_id,
          reason: 'return',
          workOrderId: wo.id,
          workOrderPartId: part.id,
          performed_by: req.user?.id ?? null
        }, { transaction: t });
      } else {
        if (part.qty_reserved < parsed.data.qty) {
          throw new HttpError(400, 'Cannot release more than reserved quantity');
        }
        if (lvl.reserved < parsed.data.qty) {
          throw new HttpError(400, 'Reserved quantity in bin too low');
        }
        part.qty_reserved -= parsed.data.qty;
        lvl.reserved -= parsed.data.qty;
        await StockMove.create({
          productId: part.productId,
          qty: parsed.data.qty,
          from_bin_id: parsed.data.bin_id,
          reason: 'release',
          workOrderId: wo.id,
          workOrderPartId: part.id,
          performed_by: req.user?.id ?? null
        }, { transaction: t });
      }

      await lvl.save({ transaction: t });
      await part.save({ transaction: t });
    });

    io.emit('stock:update', { work_order_id: Number(id), hint: 'return' });
    await invalidateStockOverviewCache();
    enqueueLowStockScan({ delay: 500 }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });
    res.json({ ok: true });
  }));

  return router;
}
