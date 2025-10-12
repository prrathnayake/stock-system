import { Router } from 'express';
import { z } from 'zod';
import { RmaCase, RmaItem, Supplier, SerialNumber, Product, WorkOrder } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

const STATUS_FLOW = ['draft','submitted','in_review','credited','closed'];

export default function createRmaRoutes(io) {
  const router = Router();

  router.get('/', requireAuth(['admin','user','developer']), asyncHandler(async (_req, res) => {
    const cases = await RmaCase.findAll({
      include: [Supplier, WorkOrder, { model: RmaItem, as: 'items', include: [Product, SerialNumber] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(cases);
  }));

  const CreateSchema = z.object({
    reference: z.string().min(1),
    supplier_id: z.number().int().positive(),
    work_order_id: z.number().int().positive().optional(),
    reason: z.string().optional(),
    notes: z.string().optional()
  });

  router.post('/', requireAuth(['admin','user','developer']), asyncHandler(async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const supplier = await Supplier.findByPk(parsed.data.supplier_id);
    if (!supplier) throw new HttpError(404, 'Supplier not found');
    if (parsed.data.work_order_id) {
      const workOrder = await WorkOrder.findByPk(parsed.data.work_order_id);
      if (!workOrder) throw new HttpError(404, 'Related work order not found');
    }

    const existing = await RmaCase.findOne({ where: { reference: parsed.data.reference } });
    if (existing) throw new HttpError(409, 'RMA reference already exists');

    const rma = await RmaCase.create({
      reference: parsed.data.reference,
      supplierId: supplier.id,
      workOrderId: parsed.data.work_order_id || null,
      reason: parsed.data.reason || null,
      notes: parsed.data.notes || null
    });

    res.status(201).json(rma);
  }));

  const AddItemSchema = z.object({
    product_id: z.number().int().positive(),
    qty: z.number().int().positive(),
    serial_id: z.number().int().positive().optional(),
    credit_amount: z.number().nonnegative().optional()
  });

  router.post('/:id/items', requireAuth(['admin','user','developer']), asyncHandler(async (req, res) => {
    const parsed = AddItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const rma = await RmaCase.findByPk(req.params.id);
    if (!rma) throw new HttpError(404, 'RMA case not found');

    const product = await Product.findByPk(parsed.data.product_id);
    if (!product) throw new HttpError(404, 'Product not found');

    let serial = null;
    if (parsed.data.serial_id) {
      serial = await SerialNumber.findByPk(parsed.data.serial_id);
      if (!serial) throw new HttpError(404, 'Serial number not found');
      if (serial.productId !== product.id) {
        throw new HttpError(400, 'Serial does not belong to this product');
      }
      serial.status = 'faulty';
      serial.workOrderId = rma.workOrderId || serial.workOrderId;
      serial.last_seen_at = new Date();
      await serial.save();
    }

    const item = await RmaItem.create({
      rmaCaseId: rma.id,
      productId: product.id,
      qty: parsed.data.qty,
      serialNumberId: serial?.id || null,
      credit_amount: parsed.data.credit_amount || 0
    });

    io.emit('rma:update', { rma_id: rma.id, action: 'item-added', organization_id: req.user.organization_id });
    res.status(201).json(item);
  }));

  const StatusSchema = z.object({
    status: z.enum(['draft','submitted','in_review','credited','closed']),
    notes: z.string().optional(),
    credit_amount: z.number().nonnegative().optional()
  });

  router.patch('/:id/status', requireAuth(['admin','user','developer']), asyncHandler(async (req, res) => {
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const rma = await RmaCase.findByPk(req.params.id);
    if (!rma) throw new HttpError(404, 'RMA case not found');

    const currentIndex = STATUS_FLOW.indexOf(rma.status);
    const nextIndex = STATUS_FLOW.indexOf(parsed.data.status);
    if (nextIndex === -1 || nextIndex < currentIndex) {
      throw new HttpError(400, 'Invalid status transition');
    }

    rma.status = parsed.data.status;
    if (parsed.data.notes !== undefined) {
      rma.notes = parsed.data.notes;
    }
    if (parsed.data.credit_amount !== undefined) {
      rma.credit_amount = parsed.data.credit_amount;
    }
    await rma.save();

    io.emit('rma:update', { rma_id: rma.id, status: rma.status, organization_id: req.user.organization_id });
    res.json(rma);
  }));

  return router;
}
