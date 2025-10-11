import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { Organization, User } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../services/tokenService.js';
import { recordActivity } from '../services/activityLog.js';

const router = Router();

const LoginSchema = z.object({
  organization: z.string().min(1, 'Organization is required'),
  email: z.string().email(),
  password: z.string().min(6)
});

const loginLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) {
    throw new HttpError(400, 'Invalid request payload', parse.error.flatten());
  }
  const { organization: orgSlug, email, password } = parse.data;
  const slug = orgSlug.trim().toLowerCase();
  const organization = await Organization.findOne({
    where: { slug },
    skipOrganizationScope: true
  });
  if (!organization) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({
    where: { email: normalizedEmail, organizationId: organization.id },
    skipOrganizationScope: true
  });
  if (!user) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const access = signAccessToken(user);
  const refresh = signRefreshToken(user.id);
  await recordActivity({
    organizationId: organization.id,
    userId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    description: `User ${user.full_name} signed in`
  }).catch(() => {});
  res.json({
    access,
    refresh,
    user: {
      id: user.id,
      name: user.full_name,
      full_name: user.full_name,
      role: user.role,
      email: user.email,
      must_change_password: user.must_change_password,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug
      },
      ui_variant: user.ui_variant
    }
  });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh } = req.body || {};
  if (!refresh) {
    throw new HttpError(400, 'Missing refresh token');
  }
  try {
    const payload = verifyRefreshToken(refresh);
    const user = await User.findByPk(payload.id, { skipOrganizationScope: true });
    if (!user) {
      throw new HttpError(401, 'Invalid refresh token');
    }
    const access = signAccessToken(user);
    res.json({ access });
  } catch (e) {
    throw new HttpError(401, 'Invalid refresh token');
  }
}));

const CredentialUpdateSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  current_password: z.string().min(6, 'Current password is required')
});

router.post('/update-credentials', requireAuth([], { allowIfMustChangePassword: true }), asyncHandler(async (req, res) => {
  const parse = CredentialUpdateSchema.safeParse(req.body);
  if (!parse.success) {
    throw new HttpError(400, 'Invalid request payload', parse.error.flatten());
  }

  const { full_name, email, password, current_password } = parse.data;
  const user = await User.findByPk(req.user.id);
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const ok = await bcrypt.compare(current_password, user.password_hash);
  if (!ok) {
    throw new HttpError(400, 'Current password is incorrect');
  }

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail !== user.email) {
    const existing = await User.findOne({ where: { email: normalizedEmail } });
    if (existing && existing.id !== user.id) {
      throw new HttpError(409, 'A user with that email already exists');
    }
  }

  const password_hash = await bcrypt.hash(password, 12);
  await user.update({
    full_name,
    email: normalizedEmail,
    password_hash,
    must_change_password: false
  });

  const organization = await Organization.findByPk(user.organizationId, { skipOrganizationScope: true });

  const access = signAccessToken(user);
  const refresh = signRefreshToken(user.id);

  res.json({
    access,
    refresh,
    user: {
      id: user.id,
      name: user.full_name,
      full_name: user.full_name,
      role: user.role,
      email: user.email,
      must_change_password: user.must_change_password,
      organization: organization ? {
        id: organization.id,
        name: organization.name,
        slug: organization.slug
      } : null,
      ui_variant: user.ui_variant
    }
  });
}));

export default router;
