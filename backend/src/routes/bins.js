import { Router } from 'express';
import { z } from 'zod';
import { Bin, Location, StockLevel } from '../db.js';
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

const UpdateSchema = z.object({
  code: z.string().min(1, 'Bin code is required').max(64).optional(),
  location_id: z.number().int().positive().nullable().optional(),
  location: LocationSchema.optional(),
  clear_location: z.boolean().optional()
}).refine((value) => (
  value.code !== undefined ||
  value.location !== undefined ||
  value.location_id !== undefined ||
  value.clear_location === true
), {
  message: 'Provide at least one field to update.'
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

router.patch('/:id', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new HttpError(400, 'Invalid bin identifier');
  }

  const bin = await Bin.findByPk(id, { include: [Location] });
  if (!bin) {
    throw new HttpError(404, 'Bin not found');
  }

  const parsed = UpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }

  const updates = {};
  if (parsed.data.code !== undefined) {
    const code = parsed.data.code.trim().toUpperCase();
    if (!code) {
      throw new HttpError(400, 'Bin code is required');
    }
    const existing = await Bin.findOne({ where: { code } });
    if (existing && existing.id !== bin.id) {
      throw new HttpError(409, 'Another bin already uses that code');
    }
    updates.code = code;
  }

  let locationId = parsed.data.location_id ?? bin.locationId ?? null;
  if (parsed.data.clear_location) {
    locationId = null;
  }

  if (parsed.data.location) {
    const payload = {
      site: parsed.data.location.site.trim(),
      room: parsed.data.location.room?.trim() || null,
      notes: parsed.data.location.notes?.trim() || null
    };
    const [location] = await Location.findOrCreate({
      where: { site: payload.site },
      defaults: payload
    });
    locationId = location.id;
  }

  if (locationId) {
    const target = await Location.findByPk(locationId);
    if (!target) {
      throw new HttpError(404, 'Location not found');
    }
  }

  await bin.update({
    ...(updates.code ? { code: updates.code } : {}),
    locationId: locationId || null
  });
  const fresh = await Bin.findByPk(bin.id, { include: [Location] });

  res.json({
    id: fresh.id,
    code: fresh.code,
    location_id: fresh.locationId ?? null,
    location: fresh.location
      ? {
        id: fresh.location.id,
        site: fresh.location.site,
        room: fresh.location.room,
        notes: fresh.location.notes
      }
      : null,
    created_at: fresh.createdAt,
    updated_at: fresh.updatedAt
  });
}));

router.delete('/:id', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new HttpError(400, 'Invalid bin identifier');
  }

  const bin = await Bin.findByPk(id);
  if (!bin) {
    throw new HttpError(404, 'Bin not found');
  }

  const assignments = await StockLevel.count({ where: { binId: id } });
  if (assignments > 0) {
    throw new HttpError(409, 'Bin cannot be deleted while stock is assigned. Reassign stock first.');
  }

  await bin.destroy();
  res.status(204).send();
}));

export default router;
