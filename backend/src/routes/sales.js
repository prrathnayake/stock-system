import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import {
  attemptReserveSale,
  completeSale,
  createSale,
  cancelSale,
  getSaleById,
  listSales
} from '../services/sales.js';
import { invalidateStockOverviewCache } from '../services/cache.js';

const CreateSaleSchema = z.object({
  customer_id: z.number().int().positive(),
  reference: z.string().max(64).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().int().positive(),
    unit_price: z.number().nonnegative().optional()
  })).min(1)
});

const StatusQuery = z.enum(['reserved', 'backorder', 'complete', 'canceled']).optional();

export default function createSalesRoutes(io) {
  const router = Router();

  router.get('/', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? StatusQuery.parse(req.query.status) : undefined;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const sales = await listSales({ status, search });
    res.json(sales);
  }));

  router.get('/:id', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await getSaleById(id);
    res.json(sale);
  }));

  router.post('/', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const parsed = CreateSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const sale = await createSale(parsed.data, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-created', sale_id: sale.id, organization_id: req.user.organization_id });
    res.status(201).json(sale);
  }));

  router.post('/:id/reserve', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await attemptReserveSale(id, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-reserve', sale_id: sale.id, organization_id: req.user.organization_id });
    res.json(sale);
  }));

  router.post('/:id/complete', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await completeSale(id, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-complete', sale_id: sale.id, organization_id: req.user.organization_id });
    res.json(sale);
  }));

  router.post('/:id/cancel', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await cancelSale(id, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-cancel', sale_id: sale.id, organization_id: req.user.organization_id });
    res.json(sale);
  }));

  return router;
}
