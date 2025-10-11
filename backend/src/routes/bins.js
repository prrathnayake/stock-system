import { Router } from 'express';
import { z } from 'zod';
import { Bin, Location } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

const LocationSchema = z.object({
  site: z.string().min(1, 'Location name is required'),
  room: z.string().max(191).optional(),
  notes: z.string().max(2000).optional()
});

const CreateSchema = z.object({
  code: z.string().min(1, 'Bin code is required').max(64),
  location_id: z.number().int().positive().optional(),
  location: LocationSchema.optional()
});

router.get('/', requireAuth(['admin', 'user']), asyncHandler(async (_req, res) => {
  const bins = await Bin.findAll({
    include: [{ model: Location }],
    order: [['code', 'ASC']]
  });

  const payload = bins.map((bin) => ({
    id: bin.id,
    code: bin.code,
    location_id: bin.locationId ?? null,
    location: bin.location
      ? {
        id: bin.location.id,
        site: bin.location.site,
        room: bin.location.room,
        notes: bin.location.notes
      }
      : null,
    created_at: bin.createdAt,
    updated_at: bin.updatedAt
  }));

  res.json(payload);
}));

router.post('/', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }

  const code = parsed.data.code.trim().toUpperCase();
  const existing = await Bin.findOne({ where: { code } });
  if (existing) {
    throw new HttpError(409, 'A bin with that code already exists');
  }

  let locationId = parsed.data.location_id ?? null;
  if (!locationId && parsed.data.location) {
    const locationPayload = {
      site: parsed.data.location.site.trim(),
      room: parsed.data.location.room?.trim() || null,
      notes: parsed.data.location.notes?.trim() || null
    };
    const [location] = await Location.findOrCreate({
      where: { site: locationPayload.site },
      defaults: locationPayload
    });
    locationId = location.id;
  }

  if (locationId) {
    const location = await Location.findByPk(locationId);
    if (!location) {
      throw new HttpError(404, 'Location not found');
    }
  }

  const bin = await Bin.create({ code, locationId: locationId || null });
  const full = await Bin.findByPk(bin.id, { include: [Location] });
  res.status(201).json({
    id: full.id,
    code: full.code,
    location_id: full.locationId ?? null,
    location: full.location
      ? {
        id: full.location.id,
        site: full.location.site,
        room: full.location.room,
        notes: full.location.notes
      }
      : null,
    created_at: full.createdAt,
    updated_at: full.updatedAt
  });
}));

export default router;
