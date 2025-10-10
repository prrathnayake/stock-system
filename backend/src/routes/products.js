import { Router } from 'express';
import { z } from 'zod';
import { Product } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

const ProductSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  uom: z.string().default('ea'),
  track_serial: z.boolean().default(false),
  reorder_point: z.number().int().nonnegative().default(0),
  lead_time_days: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true)
});

router.get('/', requireAuth(), asyncHandler(async (_req, res) => {
  const products = await Product.findAll({ order: [['id','ASC']] });
  res.json(products);
}));

router.post('/', requireAuth(['inventory','admin']), asyncHandler(async (req, res) => {
  const parse = ProductSchema.safeParse(req.body);
  if (!parse.success) {
    throw new HttpError(400, 'Invalid request payload', parse.error.flatten());
  }
  const existing = await Product.findOne({ where: { sku: parse.data.sku } });
  if (existing) {
    throw new HttpError(409, 'A product with that SKU already exists');
  }
  const created = await Product.create(parse.data);
  res.status(201).json(created);
}));

export default router;
