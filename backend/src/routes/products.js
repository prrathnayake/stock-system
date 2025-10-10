import { Router } from 'express';
import { z } from 'zod';
import { Product } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

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

router.get('/', requireAuth(), async (req, res) => {
  const products = await Product.findAll({ order: [['id','ASC']] });
  res.json(products);
});

router.post('/', requireAuth(['inventory','admin']), async (req, res) => {
  const parse = ProductSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const created = await Product.create(parse.data);
  res.status(201).json(created);
});

export default router;
