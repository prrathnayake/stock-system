import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Organization, User, UserActivity } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { createPasswordSchema } from '../utils/passwordPolicy.js';
import {
  notifyUserAccountCreated,
  notifyUserAccountDeleted,
  notifyUserAccountUpdated
} from '../services/notificationService.js';
import { presentActivity } from '../services/activityLog.js';
import { isUserOnline } from '../services/userPresence.js';

const router = Router();

const RolesEnum = z.enum(['admin', 'user', 'developer']);
const UiVariantEnum = z.enum(['pro', 'analytics', 'tabular', 'minimal', 'visual']);

const StrongPasswordSchema = createPasswordSchema(z);

const CreateUserSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: StrongPasswordSchema,
  role: RolesEnum.default('user'),
  ui_variant: UiVariantEnum.optional()
});

const UpdateUserSchema = z.object({
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: StrongPasswordSchema.optional(),
  role: RolesEnum.optional(),
  must_change_password: z.boolean().optional(),
  ui_variant: UiVariantEnum.optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided'
});

const PreferenceSchema = z.object({
  ui_variant: UiVariantEnum,
  transition_loading_enabled: z.boolean().optional()
});

function presentUser(user) {
  const lastSeen = typeof user?.get === 'function'
    ? user.get('last_seen_at')
    : user?.last_seen_at ?? user?.lastSeenAt ?? null;
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
    ui_variant: user.ui_variant,
    transition_loading_enabled: user.transition_loading_enabled,
    last_seen_at: lastSeen,
    online: isUserOnline(lastSeen)
  };
}

router.get('/', requireAuth(['admin', 'developer']), asyncHandler(async (_req, res) => {
  const users = await User.findAll({ order: [['id', 'ASC']] });
  res.json(users.map(presentUser));
}));

router.post('/', requireAuth(['admin', 'developer']), asyncHandler(async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }
  const { full_name, email, password, role, ui_variant } = parsed.data;
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
    must_change_password: true,
    ui_variant: ui_variant ?? 'pro'
  });
  const payload = presentUser(created);
  res.status(201).json(payload);
  const organization = await Organization.findByPk(req.user.organization_id, { skipOrganizationScope: true });
  notifyUserAccountCreated({
    organizationId: req.user.organization_id,
    actor: req.user,
    user: payload,
    credentials: {
      organizationSlug: organization?.slug ?? null,
      email: payload.email,
      temporaryPassword: password
    }
  }).catch((error) => {
    console.error('[notify] failed to send user creation email', error);
  });
}));

router.put('/:id', requireAuth(['admin', 'developer']), asyncHandler(async (req, res) => {
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

router.delete('/:id', requireAuth(['admin', 'developer']), asyncHandler(async (req, res) => {
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

router.get('/activities', requireAuth(['admin', 'developer']), asyncHandler(async (_req, res) => {
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
  const updates = { ui_variant: parsed.data.ui_variant };
  if (parsed.data.transition_loading_enabled !== undefined) {
    updates.transition_loading_enabled = parsed.data.transition_loading_enabled;
  }
  await user.update(updates);
  res.json(presentUser(user));
}));

export default router;
