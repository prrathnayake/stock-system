import { Router } from 'express';
import { z } from 'zod';
import { Op } from 'sequelize';
import {
  WorkOrder,
  WorkOrderPart,
  Product,
  StockLevel,
  StockMove,
  WorkOrderStatusHistory,
  SerialNumber,
  SerialAssignment
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import { enqueueLowStockScan } from '../queues/lowStock.js';
import { getSetting } from '../services/settings.js';

export default function createWorkOrderRoutes(io) {
  const router = Router();

  router.get('/', requireAuth(['admin']), asyncHandler(async (_req, res) => {
    const rows = await WorkOrder.findAll({
      include: [
        {
          model: WorkOrderPart,
          include: [
            Product,
            { model: SerialAssignment, include: [SerialNumber] }
          ]
        },
        { model: WorkOrderStatusHistory, include: [{ association: 'performedBy' }] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json(rows);
  }));

  const CreateSchema = z.object({
    customer_name: z.string().min(1),
    device_info: z.string().min(1),
    device_serial: z.string().optional(),
    priority: z.enum(['low','normal','high','urgent']).optional(),
    intake_notes: z.string().optional(),
    warranty_provider: z.string().optional(),
    warranty_expires_at: z.string().optional(),
    parts: z.array(z.object({
      product_id: z.number().int().positive(),
      qty: z.number().int().positive()
    })).default([])
  });

  router.post('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const wo = await WorkOrder.create({
      customer_name: parsed.data.customer_name,
      device_info: parsed.data.device_info,
      device_serial: parsed.data.device_serial || null,
      priority: parsed.data.priority || 'normal',
      intake_notes: parsed.data.intake_notes || null,
      warranty_provider: parsed.data.warranty_provider || null,
      warranty_expires_at: parsed.data.warranty_expires_at ? new Date(parsed.data.warranty_expires_at) : null,
      sla_due_at: await (async () => {
        const defaultHours = await getSetting('default_sla_hours', 24, req.user.organization_id);
        const due = new Date();
        due.setHours(due.getHours() + Number(defaultHours || 0));
        return due;
      })()
    });

    await WorkOrderStatusHistory.create({
      workOrderId: wo.id,
      from_status: null,
      to_status: wo.status,
      note: 'Work order created',
      performed_by: req.user?.id ?? null
    });

    for (const p of parsed.data.parts) {
      await WorkOrderPart.create({ workOrderId: wo.id, productId: p.product_id, qty_needed: p.qty });
    }
    io.emit('workorders:update', { work_order_id: wo.id, action: 'created', organization_id: req.user.organization_id });
    res.status(201).json(wo);
  }));

  const UpdateSchema = z.object({
    customer_name: z.string().min(1).optional(),
    device_info: z.string().min(1).optional(),
    device_serial: z.string().optional(),
    priority: z.enum(['low','normal','high','urgent']).optional(),
    intake_notes: z.string().optional(),
    diagnostic_findings: z.string().optional(),
    sla_due_at: z.string().optional(),
    warranty_expires_at: z.string().optional(),
    warranty_provider: z.string().optional(),
    status: z.enum(['intake','diagnostics','awaiting_approval','approved','in_progress','awaiting_parts','completed','canceled']).optional(),
    status_note: z.string().optional()
  });

  router.patch('/:id', requireAuth(['admin']), asyncHandler(async (req, res) => {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const wo = await WorkOrder.findByPk(req.params.id);
    if (!wo) {
      throw new HttpError(404, 'Work order not found');
    }

    const prevStatus = wo.status;
    if (parsed.data.customer_name !== undefined) wo.customer_name = parsed.data.customer_name;
    if (parsed.data.device_info !== undefined) wo.device_info = parsed.data.device_info;
    if (parsed.data.device_serial !== undefined) wo.device_serial = parsed.data.device_serial;
    if (parsed.data.priority !== undefined) wo.priority = parsed.data.priority;
    if (parsed.data.intake_notes !== undefined) wo.intake_notes = parsed.data.intake_notes;
    if (parsed.data.diagnostic_findings !== undefined) wo.diagnostic_findings = parsed.data.diagnostic_findings;
    if (parsed.data.sla_due_at !== undefined) wo.sla_due_at = parsed.data.sla_due_at ? new Date(parsed.data.sla_due_at) : null;
    if (parsed.data.warranty_expires_at !== undefined) wo.warranty_expires_at = parsed.data.warranty_expires_at ? new Date(parsed.data.warranty_expires_at) : null;
    if (parsed.data.warranty_provider !== undefined) wo.warranty_provider = parsed.data.warranty_provider || null;
    if (parsed.data.status !== undefined) wo.status = parsed.data.status;

    await wo.save();

    if (parsed.data.status !== undefined && parsed.data.status !== prevStatus) {
      await WorkOrderStatusHistory.create({
        workOrderId: wo.id,
        from_status: prevStatus,
        to_status: parsed.data.status,
        note: parsed.data.status_note || null,
        performed_by: req.user?.id ?? null
      });
    }

    io.emit('workorders:update', { work_order_id: wo.id, status: wo.status, action: 'updated', organization_id: req.user.organization_id });
    res.json(wo);
  }));

  // Reserve parts
  const ReserveSchema = z.object({
    items: z.array(z.object({
      part_id: z.number().int().positive(),
      qty: z.number().int().positive(),
      serials: z.array(z.number().int().positive()).optional()
    }))
  });

  router.post('/:id/reserve', requireAuth(['admin']), asyncHandler(async (req, res) => {
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
        const part = await WorkOrderPart.findByPk(item.part_id, { transaction: t, lock: t.LOCK.UPDATE, include: [Product] });
        if (!part) throw new HttpError(404, 'Part not found');
        if (part.workOrderId !== wo.id) {
          throw new HttpError(400, 'Part does not belong to this work order');
        }
        const product = part.product || await Product.findByPk(part.productId, { transaction: t, lock: t.LOCK.UPDATE });
        if (product.track_serial) {
          const serialIds = item.serials || [];
          if (serialIds.length !== item.qty) {
            throw new HttpError(400, 'Serial numbers must match reserved quantity');
          }
          const serials = await SerialNumber.findAll({
            where: { id: { [Op.in]: serialIds }, productId: product.id },
            transaction: t,
            lock: t.LOCK.UPDATE
          });
          if (serials.length !== serialIds.length) {
            throw new HttpError(404, 'One or more serial numbers were not found');
          }
          for (const serial of serials) {
            if (serial.status !== 'available') {
              throw new HttpError(400, `Serial ${serial.serial} is not available`);
            }
            if (!serial.binId) {
              throw new HttpError(400, `Serial ${serial.serial} is not stored in a bin`);
            }
            const lvl = await StockLevel.findOne({ where: { productId: product.id, binId: serial.binId }, transaction: t, lock: t.LOCK.UPDATE });
            if (!lvl || (lvl.on_hand - lvl.reserved) <= 0) {
              throw new HttpError(400, `Insufficient stock for serial ${serial.serial}`);
            }
            lvl.reserved += 1;
            await lvl.save({ transaction: t });

            await SerialAssignment.create({
              serialNumberId: serial.id,
              workOrderId: wo.id,
              workOrderPartId: part.id,
              status: 'reserved',
              reserved_at: new Date(),
              performed_by: req.user?.id ?? null
            }, { transaction: t });

            serial.status = 'reserved';
            serial.workOrderId = wo.id;
            serial.last_seen_at = new Date();
            await serial.save({ transaction: t });

            await StockMove.create({
              productId: product.id,
              qty: 1,
              from_bin_id: serial.binId,
              reason: 'reserve',
              workOrderId: wo.id,
              workOrderPartId: part.id,
              serialNumberId: serial.id,
              performed_by: req.user?.id ?? null
            }, { transaction: t });
          }
          part.qty_reserved += item.qty;
          await part.save({ transaction: t });
          continue;
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

    io.emit('stock:update', { work_order_id: Number(id), hint: 'reserve', organization_id: req.user.organization_id });
    await invalidateStockOverviewCache(req.user.organization_id);
    enqueueLowStockScan({ delay: 500, organizationId: req.user.organization_id }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });
    res.json({ ok: true });
  }));

  // Pick parts from a specific bin (scan workflow)
  const PickSchema = z.object({
    part_id: z.number().int().positive(),
    bin_id: z.number().int().positive(),
    qty: z.number().int().positive(),
    serials: z.array(z.number().int().positive()).optional()
  });

  router.post('/:id/pick', requireAuth(['admin']), asyncHandler(async (req, res) => {
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
      const part = await WorkOrderPart.findByPk(parsed.data.part_id, { transaction: t, lock: t.LOCK.UPDATE, include: [Product] });
      if (!part) throw new HttpError(404, 'Part not found');
      if (part.workOrderId !== wo.id) {
        throw new HttpError(400, 'Part does not belong to this work order');
      }
      if (part.qty_reserved < parsed.data.qty) throw new HttpError(400, 'Not enough reserved quantity');

      const product = part.product || await Product.findByPk(part.productId, { transaction: t, lock: t.LOCK.UPDATE });

      if (product.track_serial) {
        const serialIds = parsed.data.serials || [];
        if (serialIds.length !== parsed.data.qty) {
          throw new HttpError(400, 'Serial numbers must match picked quantity');
        }
        const serials = await SerialNumber.findAll({
          where: { id: { [Op.in]: serialIds }, productId: product.id },
          transaction: t,
          lock: t.LOCK.UPDATE
        });
        if (serials.length !== serialIds.length) {
          throw new HttpError(404, 'One or more serial numbers were not found');
        }
        for (const serial of serials) {
          if (serial.status !== 'reserved' || serial.workOrderId !== wo.id) {
            throw new HttpError(400, `Serial ${serial.serial} is not reserved for this work order`);
          }
          if (serial.binId !== parsed.data.bin_id) {
            throw new HttpError(400, `Serial ${serial.serial} is reserved in a different bin`);
          }
          const assignment = await SerialAssignment.findOne({
            where: { serialNumberId: serial.id, workOrderPartId: part.id, status: 'reserved' },
            transaction: t,
            lock: t.LOCK.UPDATE
          });
          if (!assignment) {
            throw new HttpError(400, `Serial ${serial.serial} is not reserved for this part`);
          }
          const lvl = await StockLevel.findOne({ where: { productId: product.id, binId: serial.binId }, transaction: t, lock: t.LOCK.UPDATE });
          if (!lvl || lvl.on_hand < 1 || lvl.reserved < 1) {
            throw new HttpError(400, `Insufficient stock for serial ${serial.serial}`);
          }
          lvl.on_hand -= 1;
          lvl.reserved -= 1;
          await lvl.save({ transaction: t });

          assignment.status = 'picked';
          assignment.picked_at = new Date();
          await assignment.save({ transaction: t });

          serial.status = 'assigned';
          serial.binId = null;
          serial.last_seen_at = new Date();
          await serial.save({ transaction: t });

          await StockMove.create({
            productId: product.id,
            qty: 1,
            from_bin_id: parsed.data.bin_id,
            reason: 'pick',
            workOrderId: wo.id,
            workOrderPartId: part.id,
            serialNumberId: serial.id,
            performed_by: req.user?.id ?? null
          }, { transaction: t });
        }
      } else {
        const lvl = await StockLevel.findOne({ where: { productId: part.productId, binId: parsed.data.bin_id }, transaction: t, lock: t.LOCK.UPDATE });
        if (!lvl || lvl.on_hand < parsed.data.qty) throw new HttpError(400, 'Insufficient on-hand in bin');
        if (lvl.reserved < parsed.data.qty) throw new HttpError(400, 'Reserved in this bin is insufficient');

        lvl.on_hand -= parsed.data.qty;
        lvl.reserved -= parsed.data.qty;
        await lvl.save({ transaction: t });

        await StockMove.create({
          productId: part.productId,
          qty: parsed.data.qty,
          from_bin_id: parsed.data.bin_id,
          reason: 'pick',
          workOrderId: wo.id,
          workOrderPartId: part.id,
          performed_by: req.user?.id ?? null
        }, { transaction: t });
      }

      part.qty_picked += parsed.data.qty;
      part.qty_reserved -= parsed.data.qty;
      await part.save({ transaction: t });
    });

    io.emit('stock:update', { work_order_id: Number(id), hint: 'pick', organization_id: req.user.organization_id });
    await invalidateStockOverviewCache(req.user.organization_id);
    enqueueLowStockScan({ delay: 500, organizationId: req.user.organization_id }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });
    res.json({ ok: true });
  }));

  const ReturnSchema = z.object({
    part_id: z.number().int().positive(),
    bin_id: z.number().int().positive(),
    qty: z.number().int().positive(),
    source: z.enum(['picked', 'reserved']).default('picked'),
    serials: z.array(z.number().int().positive()).optional(),
    mark_faulty: z.boolean().optional()
  });

  router.post('/:id/return', requireAuth(['admin']), asyncHandler(async (req, res) => {
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
      const part = await WorkOrderPart.findByPk(parsed.data.part_id, { transaction: t, lock: t.LOCK.UPDATE, include: [Product] });
      if (!part) throw new HttpError(404, 'Part not found');
      if (part.workOrderId !== wo.id) {
        throw new HttpError(400, 'Part does not belong to this work order');
      }

      const product = part.product || await Product.findByPk(part.productId, { transaction: t, lock: t.LOCK.UPDATE });
      const markFaulty = parsed.data.mark_faulty === true;

      const lvl = await StockLevel.findOne({ where: { productId: part.productId, binId: parsed.data.bin_id }, transaction: t, lock: t.LOCK.UPDATE });
      if (!lvl) throw new HttpError(400, 'Bin does not track this product');

      if (product.track_serial) {
        const serialIds = parsed.data.serials || [];
        if (serialIds.length !== parsed.data.qty) {
          throw new HttpError(400, 'Serial numbers must match quantity');
        }
        const serials = await SerialNumber.findAll({
          where: { id: { [Op.in]: serialIds }, productId: product.id },
          transaction: t,
          lock: t.LOCK.UPDATE
        });
        if (serials.length !== serialIds.length) {
          throw new HttpError(404, 'One or more serial numbers were not found');
        }
        for (const serial of serials) {
          const assignment = await SerialAssignment.findOne({
            where: { serialNumberId: serial.id, workOrderPartId: part.id },
            order: [['createdAt', 'DESC']],
            transaction: t,
            lock: t.LOCK.UPDATE
          });
          if (!assignment) {
            throw new HttpError(400, `Serial ${serial.serial} is not associated with this part`);
          }
          if (parsed.data.source === 'reserved' && serial.binId !== parsed.data.bin_id) {
            throw new HttpError(400, `Serial ${serial.serial} is tracked in a different bin`);
          }
          if (parsed.data.source === 'picked') {
            if (assignment.status !== 'picked') {
              throw new HttpError(400, `Serial ${serial.serial} is not picked`);
            }
            assignment.status = markFaulty ? 'faulty' : 'returned';
            assignment.returned_at = new Date();
            await assignment.save({ transaction: t });

            if (part.qty_picked < 1) {
              throw new HttpError(400, 'Cannot return more than picked quantity');
            }
            part.qty_picked -= 1;
            if (!markFaulty) {
              lvl.on_hand += 1;
            }
            if (!markFaulty) {
              serial.status = 'available';
              serial.binId = parsed.data.bin_id;
            } else {
              serial.status = 'faulty';
            }
          } else {
            if (assignment.status !== 'reserved') {
              throw new HttpError(400, `Serial ${serial.serial} is not reserved`);
            }
            if (part.qty_reserved < 1 || lvl.reserved < 1) {
              throw new HttpError(400, 'Reserved quantity too low');
            }
            part.qty_reserved -= 1;
            lvl.reserved -= 1;
            if (markFaulty) {
              lvl.on_hand = Math.max(0, lvl.on_hand - 1);
            }
            assignment.status = 'released';
            await assignment.save({ transaction: t });
            serial.status = markFaulty ? 'faulty' : 'available';
            serial.binId = markFaulty ? null : parsed.data.bin_id;
          }

          serial.workOrderId = markFaulty ? wo.id : null;
          serial.last_seen_at = new Date();
          await serial.save({ transaction: t });

          if (!markFaulty) {
            await StockMove.create({
              productId: product.id,
              qty: 1,
              reason: parsed.data.source === 'picked' ? 'return' : 'release',
              from_bin_id: parsed.data.source === 'reserved' ? parsed.data.bin_id : null,
              to_bin_id: parsed.data.source === 'picked' ? parsed.data.bin_id : null,
              workOrderId: wo.id,
              workOrderPartId: part.id,
              serialNumberId: serial.id,
              performed_by: req.user?.id ?? null
            }, { transaction: t });
          } else {
            await StockMove.create({
              productId: product.id,
              qty: 1,
              reason: 'rma_out',
              from_bin_id: parsed.data.bin_id,
              workOrderId: wo.id,
              workOrderPartId: part.id,
              serialNumberId: serial.id,
              performed_by: req.user?.id ?? null
            }, { transaction: t });
          }
        }
      } else {
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
      }

      await lvl.save({ transaction: t });
      await part.save({ transaction: t });
    });

    io.emit('stock:update', { work_order_id: Number(id), hint: 'return', organization_id: req.user.organization_id });
    await invalidateStockOverviewCache(req.user.organization_id);
    enqueueLowStockScan({ delay: 500, organizationId: req.user.organization_id }).catch(err => {
      console.error('[queue] failed to enqueue low stock scan', err);
    });
    res.json({ ok: true });
  }));

  return router;
}
