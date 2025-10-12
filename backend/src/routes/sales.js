import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { getSetting } from '../services/settings.js';
import {
  attemptReserveSale,
  completeSale,
  createSale,
  cancelSale,
  getSaleById,
  listSales,
  updateSaleDetails
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

const UpdateSaleSchema = z.object({
  reference: z.string().max(64).optional(),
  notes: z.string().max(2000).optional(),
  customer_id: z.number().int().positive().optional()
}).refine((payload) => Object.keys(payload).length > 0, {
  message: 'Provide at least one field to update.'
});

export default function createSalesRoutes(io) {
  const router = Router();

  const ensureSalesEnabled = asyncHandler(async (req, res, next) => {
    const enabled = await getSetting('sales_module_enabled', true, req.user.organization_id);
    if (enabled === false) {
      throw new HttpError(404, 'Sales are disabled for this organization');
    }
    next();
  });

  router.get('/', requireAuth(['admin', 'user', 'developer']), ensureSalesEnabled, asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? StatusQuery.parse(req.query.status) : undefined;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const sales = await listSales({ status, search });
    res.json(sales);
  }));

  router.get('/:id', requireAuth(['admin', 'user', 'developer']), ensureSalesEnabled, asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await getSaleById(id);
    res.json(sale);
  }));

  router.post('/', requireAuth(['admin', 'user', 'developer']), ensureSalesEnabled, asyncHandler(async (req, res) => {
    const parsed = CreateSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const sale = await createSale(parsed.data, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-created', sale_id: sale.id, organization_id: req.user.organization_id });
    res.status(201).json(sale);
  }));

  router.post('/:id/reserve', requireAuth(['admin', 'user', 'developer']), ensureSalesEnabled, asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await attemptReserveSale(id, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-reserve', sale_id: sale.id, organization_id: req.user.organization_id });
    res.json(sale);
  }));

  router.post('/:id/complete', requireAuth(['admin', 'user', 'developer']), ensureSalesEnabled, asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await completeSale(id, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-complete', sale_id: sale.id, organization_id: req.user.organization_id });
    res.json(sale);
  }));

  router.post('/:id/cancel', requireAuth(['admin', 'user', 'developer']), ensureSalesEnabled, asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const sale = await cancelSale(id, req.user);
    await invalidateStockOverviewCache(req.user.organization_id);
    io?.emit('stock:update', { hint: 'sale-cancel', sale_id: sale.id, organization_id: req.user.organization_id });
    res.json(sale);
  }));

  router.patch('/:id', requireAuth(['admin', 'user', 'developer']), ensureSalesEnabled, asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid sale id');
    }
    const parsed = UpdateSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const sale = await updateSaleDetails(id, parsed.data, req.user);
    res.json(sale);
  }));

  return router;
}
