import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { User } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';

const router = Router();

const RolesEnum = z.enum(['admin', 'user']);

const CreateUserSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  role: RolesEnum.default('user'),
  must_change_password: z.boolean().optional()
});

const UpdateUserSchema = z.object({
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: RolesEnum.optional(),
  must_change_password: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided'
});

function presentUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password,
    organization_id: user.organizationId,
    created_at: user.createdAt,
    updated_at: user.updatedAt
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
  const { full_name, email, password, role, must_change_password } = parsed.data;
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
    must_change_password: must_change_password ?? false
  });
  res.status(201).json(presentUser(created));
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
  res.json(presentUser(user));
}));

router.delete('/:id', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  await user.destroy();
  res.status(204).send();
}));

export default router;
