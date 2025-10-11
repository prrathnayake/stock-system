import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { User, UserActivity } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import {
  notifyUserAccountCreated,
  notifyUserAccountDeleted,
  notifyUserAccountUpdated
} from '../services/notificationService.js';
import { presentActivity } from '../services/activityLog.js';

const router = Router();

const RolesEnum = z.enum(['admin', 'user']);
const UiVariantEnum = z.enum(['pro', 'analytics', 'tabular', 'minimal', 'visual']);

const CreateUserSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  role: RolesEnum.default('user'),
  must_change_password: z.boolean().optional(),
  ui_variant: UiVariantEnum.optional()
});

const UpdateUserSchema = z.object({
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: RolesEnum.optional(),
  must_change_password: z.boolean().optional(),
  ui_variant: UiVariantEnum.optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided'
});

const PreferenceSchema = z.object({
  ui_variant: UiVariantEnum
});

function presentUser(user) {
  return {
    id: user.id,
    name: user.full_name,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password,
    organization_id: user.organizationId,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    ui_variant: user.ui_variant
  };
}

router.get('/', requireAuth(['admin']), asyncHandler(async (_req, res) => {
  const users = await User.findAll({ order: [['id', 'ASC']] });
  res.json(users.map(presentUser));
}));

router.post('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }
  const { full_name, email, password, role, must_change_password, ui_variant } = parsed.data;
  const normalizedEmail = normalizeEmail(email);
  const existing = await User.findOne({ where: { email: normalizedEmail } });
  if (existing) {
    throw new HttpError(409, 'A user with that email already exists');
  }
  const password_hash = await bcrypt.hash(password, 12);
  const created = await User.create({
    full_name,
    email: normalizedEmail,
    password_hash,
    role,
    must_change_password: must_change_password ?? false,
    ui_variant: ui_variant ?? 'pro'
  });
  const payload = presentUser(created);
  res.status(201).json(payload);
  notifyUserAccountCreated({
    organizationId: req.user.organization_id,
    actor: req.user,
    user: payload
  }).catch((error) => {
    console.error('[notify] failed to send user creation email', error);
  });
}));

router.put('/:id', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }
  const user = await User.findByPk(req.params.id);
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const updates = parsed.data;
  if (updates.email) {
    const normalizedEmail = normalizeEmail(updates.email);
    const existing = await User.findOne({ where: { email: normalizedEmail } });
    if (existing && existing.id !== user.id) {
      throw new HttpError(409, 'A user with that email already exists');
    }
    updates.email = normalizedEmail;
  }
  if (updates.password) {
    updates.password_hash = await bcrypt.hash(updates.password, 12);
    delete updates.password;
  }

  await user.update(updates);
  const payload = presentUser(user);
  res.json(payload);
  notifyUserAccountUpdated({
    organizationId: req.user.organization_id,
    actor: req.user,
    user: payload
  }).catch((error) => {
    console.error('[notify] failed to send user update email', error);
  });
}));

router.delete('/:id', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const snapshot = presentUser(user);
  await user.destroy();
  res.status(204).send();
  notifyUserAccountDeleted({
    organizationId: req.user.organization_id,
    actor: req.user,
    user: snapshot
  }).catch((error) => {
    console.error('[notify] failed to send user deletion email', error);
  });
}));

router.get('/activities', requireAuth(['admin']), asyncHandler(async (_req, res) => {
  const entries = await UserActivity.findAll({
    order: [['createdAt', 'DESC']],
    limit: 200,
    include: [{ model: User, attributes: ['id', 'full_name', 'email'] }]
  });
  res.json(entries.map(presentActivity));
}));

router.put('/me/preferences', requireAuth(), asyncHandler(async (req, res) => {
  const parsed = PreferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }
  const user = await User.findByPk(req.user.id);
  if (!user) {
    throw new HttpError(404, 'User not found');
  }
  await user.update({ ui_variant: parsed.data.ui_variant });
  res.json(presentUser(user));
}));

export default router;
