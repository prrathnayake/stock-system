import { Router } from 'express';
import { z } from 'zod';
import { Supplier, PurchaseOrder, PurchaseOrderLine, Product, StockLevel, Bin, StockMove, SerialNumber } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { withTransaction } from '../db.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import { enqueueLowStockScan } from '../queues/lowStock.js';

export default function createPurchasingRoutes(io) {
  const router = Router();

  router.get('/suppliers', requireAuth(['admin','user']), asyncHandler(async (_req, res) => {
    const suppliers = await Supplier.findAll({ order: [['name', 'ASC']] });
    res.json(suppliers);
  }));

  const SupplierSchema = z.object({
    name: z.string().min(1),
    contact_name: z.string().optional(),
    contact_email: z.string().email().optional(),
    phone: z.string().optional(),
    lead_time_days: z.number().int().nonnegative().optional()
  });

  router.post('/suppliers', requireAuth(['admin','user']), asyncHandler(async (req, res) => {
    const parsed = SupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const supplier = await Supplier.create(parsed.data);
    res.status(201).json(supplier);
  }));

  router.get('/purchase-orders', requireAuth(['admin','user']), asyncHandler(async (_req, res) => {
    const orders = await PurchaseOrder.findAll({
      include: [{ model: Supplier }, { model: PurchaseOrderLine, as: 'lines', include: [Product] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(orders);
  }));

  const CreatePoSchema = z.object({
    reference: z.string().min(1),
    supplier_id: z.number().int().positive(),
    expected_at: z.string().optional(),
    lines: z.array(z.object({
      product_id: z.number().int().positive(),
      qty_ordered: z.number().int().positive(),
      unit_cost: z.number().nonnegative().default(0)
    })).min(1)
  });

  router.post('/purchase-orders', requireAuth(['admin','user']), asyncHandler(async (req, res) => {
    const parsed = CreatePoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const supplier = await Supplier.findByPk(parsed.data.supplier_id);
    if (!supplier) throw new HttpError(404, 'Supplier not found');

    const po = await PurchaseOrder.create({
      reference: parsed.data.reference,
      supplierId: supplier.id,
      expected_at: parsed.data.expected_at ? new Date(parsed.data.expected_at) : null,
      status: 'ordered'
    });

    let totalCost = 0;
    for (const line of parsed.data.lines) {
      const product = await Product.findByPk(line.product_id);
      if (!product) throw new HttpError(404, `Product ${line.product_id} not found`);
      await PurchaseOrderLine.create({
        purchaseOrderId: po.id,
        productId: product.id,
        qty_ordered: line.qty_ordered,
        unit_cost: line.unit_cost
      });
      totalCost += line.qty_ordered * line.unit_cost;
    }
    po.total_cost = totalCost;
    await po.save();

    res.status(201).json(po);
  }));

  const ReceiveSchema = z.object({
    receipts: z.array(z.object({
      line_id: z.number().int().positive(),
      qty: z.number().int().nonnegative(),
      bin_id: z.number().int().positive(),
      serials: z.array(z.string().min(1)).optional()
    })).min(1)
  });

  router.post('/purchase-orders/:id/receive', requireAuth(['admin','user']), asyncHandler(async (req, res) => {
    const parsed = ReceiveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }

    const po = await PurchaseOrder.findByPk(req.params.id, { include: [{ model: PurchaseOrderLine, as: 'lines' }, Supplier] });
    if (!po) throw new HttpError(404, 'Purchase order not found');

    await withTransaction(async (t) => {
      for (const receipt of parsed.data.receipts) {
        const line = await PurchaseOrderLine.findByPk(receipt.line_id, { transaction: t, lock: t.LOCK.UPDATE, include: [Product] });
        if (!line) throw new HttpError(404, 'Purchase order line not found');
        if (line.purchaseOrderId !== po.id) {
          throw new HttpError(400, 'Line does not belong to this purchase order');
        }
        const bin = await Bin.findByPk(receipt.bin_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!bin) throw new HttpError(404, 'Bin not found');

        const remaining = line.qty_ordered - line.qty_received;
        if (receipt.qty > remaining) {
          throw new HttpError(400, 'Cannot receive more than ordered');
        }

        const product = line.product || await Product.findByPk(line.productId, { transaction: t, lock: t.LOCK.UPDATE });
        if (product.track_serial) {
          const serials = receipt.serials || [];
          if (serials.length !== receipt.qty) {
            throw new HttpError(400, 'Serial numbers required for tracked products');
          }
          for (const serialValue of serials) {
            const [serial, created] = await SerialNumber.findOrCreate({
              where: { serial: serialValue },
              defaults: { productId: product.id, binId: bin.id },
              transaction: t,
              lock: t.LOCK.UPDATE
            });
            if (!created) {
              if (serial.productId !== product.id) {
                throw new HttpError(400, `Serial ${serialValue} belongs to another product`);
              }
              serial.binId = bin.id;
              serial.status = 'available';
              serial.workOrderId = null;
              serial.last_seen_at = new Date();
              await serial.save({ transaction: t });
            }
          }
        }

        const level = await StockLevel.findOne({ where: { productId: product.id, binId: bin.id }, transaction: t, lock: t.LOCK.UPDATE });
        if (level) {
          level.on_hand += receipt.qty;
          await level.save({ transaction: t });
        } else {
          await StockLevel.create({ productId: product.id, binId: bin.id, on_hand: receipt.qty, reserved: 0 }, { transaction: t });
        }

        line.qty_received += receipt.qty;
        await line.save({ transaction: t });

        await StockMove.create({
          productId: product.id,
          qty: receipt.qty,
          to_bin_id: bin.id,
          reason: 'receive_po',
          workOrderId: null,
          performed_by: req.user?.id ?? null
        }, { transaction: t });
      }

      const refreshedLines = await PurchaseOrderLine.findAll({ where: { purchaseOrderId: po.id }, transaction: t, lock: t.LOCK.UPDATE });
      const fullyReceived = refreshedLines.every((line) => line.qty_received >= line.qty_ordered);
      if (fullyReceived) {
        po.status = 'received';
      } else {
        po.status = 'partially_received';
      }
      await po.save({ transaction: t });
    });

    io.emit('stock:update', { hint: 'purchase-order-receive', purchase_order_id: po.id, organization_id: req.user.organization_id });
    await invalidateStockOverviewCache(req.user.organization_id);
    enqueueLowStockScan({ delay: 250, organizationId: req.user.organization_id }).catch(() => {});

    res.json({ ok: true });
  }));

  return router;
}
