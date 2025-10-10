import { Router } from 'express';
import { z } from 'zod';
import { SerialNumber, Product, Bin, WorkOrder, SerialAssignment } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

export default function createSerialRoutes(io) {
  const router = Router();

  router.get('/', requireAuth(), asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.product_id) where.productId = Number(req.query.product_id);
    if (req.query.status) where.status = req.query.status;

    const serials = await SerialNumber.findAll({
      where,
      include: [Product, Bin, WorkOrder],
      order: [['createdAt', 'DESC']]
    });
    res.json(serials);
  }));

  const CreateSchema = z.object({
    product_id: z.number().int().positive(),
    serial: z.string().min(1),
    bin_id: z.number().int().positive().optional(),
    metadata: z.record(z.any()).optional()
  });

  router.post('/', requireAuth(['admin','user']), asyncHandler(async (req, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const product = await Product.findByPk(parsed.data.product_id);
    if (!product) {
      throw new HttpError(404, 'Product not found');
    }
    if (!product.track_serial) {
      throw new HttpError(400, 'Product does not require serial tracking');
    }

    if (parsed.data.bin_id) {
      const bin = await Bin.findByPk(parsed.data.bin_id);
      if (!bin) throw new HttpError(404, 'Bin not found');
    }

    const [serial, created] = await SerialNumber.findOrCreate({
      where: { serial: parsed.data.serial },
      defaults: {
        productId: parsed.data.product_id,
        binId: parsed.data.bin_id || null,
        metadata: parsed.data.metadata || null
      }
    });
    if (!created) {
      throw new HttpError(409, 'Serial number already exists');
    }

    io.emit('serials:update', { serial_id: serial.id, action: 'created' });
    res.status(201).json(serial);
  }));

  const UpdateSchema = z.object({
    status: z.enum(['available','reserved','assigned','returned','faulty']).optional(),
    bin_id: z.number().int().positive().nullable().optional(),
    metadata: z.record(z.any()).optional(),
    note: z.string().optional()
  });

  router.patch('/:id', requireAuth(['admin','user']), asyncHandler(async (req, res) => {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const serial = await SerialNumber.findByPk(req.params.id, { include: [SerialAssignment] });
    if (!serial) {
      throw new HttpError(404, 'Serial not found');
    }

    if (parsed.data.status) {
      serial.status = parsed.data.status;
      if (parsed.data.status === 'available') {
        serial.workOrderId = null;
      }
    }
    if (parsed.data.bin_id !== undefined) {
      serial.binId = parsed.data.bin_id || null;
    }
    if (parsed.data.metadata !== undefined) {
      serial.metadata = parsed.data.metadata;
    }
    serial.last_seen_at = new Date();
    await serial.save();

    if (parsed.data.note) {
      await SerialAssignment.create({
        serialNumberId: serial.id,
        workOrderId: serial.workOrderId || null,
        status: serial.status === 'faulty' ? 'faulty' : 'released',
        notes: parsed.data.note,
        performed_by: req.user?.id ?? null
      });
    }

    io.emit('serials:update', { serial_id: serial.id, action: 'updated' });
    res.json(serial);
  }));

  return router;
}
