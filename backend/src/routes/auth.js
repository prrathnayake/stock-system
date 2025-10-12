import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { Organization, User } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { createPasswordSchema } from '../utils/passwordPolicy.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../services/tokenService.js';
import { recordActivity } from '../services/activityLog.js';
import { touchUserPresence } from '../services/userPresence.js';
import { getSetting } from '../services/settings.js';

const router = Router();

const LoginSchema = z.object({
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
  const { email, password } = parse.data;
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({
    where: { email: normalizedEmail },
    include: [{ model: Organization, attributes: [
      'id', 'name', 'slug', 'legal_name', 'contact_email', 'timezone', 'abn', 'tax_id', 'address', 'phone', 'website', 'logo_url',
      'invoice_prefix', 'default_payment_terms', 'invoice_notes', 'currency', 'invoicing_enabled'
    ] }],
    skipOrganizationScope: true
  });
  if (!user) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const organization = user.organization;
  if (!organization) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const access = signAccessToken(user);
  const refresh = signRefreshToken(user.id);
  await touchUserPresence(user.id, { force: true, organizationId: organization.id });
  await recordActivity({
    organizationId: organization.id,
    userId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    description: `User ${user.full_name} signed in`
  }).catch(() => {});
  const bannerImages = await getSetting('organization_banner_images', [], organization.id);
  const barcodeScanningEnabled = await getSetting('barcode_scanning_enabled', true, organization.id);

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
      transition_loading_enabled: user.transition_loading_enabled,
      organization: organization ? {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        legal_name: organization.legal_name,
        contact_email: organization.contact_email,
        timezone: organization.timezone,
        abn: organization.abn,
        tax_id: organization.tax_id,
        address: organization.address,
        phone: organization.phone,
        website: organization.website,
        logo_url: organization.logo_url,
        type: organization.type,
        invoice_prefix: organization.invoice_prefix,
        default_payment_terms: organization.default_payment_terms,
        invoice_notes: organization.invoice_notes,
        currency: organization.currency,
        invoicing_enabled: organization.invoicing_enabled,
        logo_updated_at: organization.updatedAt ? organization.updatedAt.toISOString?.() || new Date(organization.updatedAt).toISOString() : null,
        banner_images: Array.isArray(bannerImages) ? bannerImages : [],
        features: {
          barcode_scanning_enabled: barcodeScanningEnabled !== false
        }
      } : null,
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

const StrongPasswordSchema = createPasswordSchema(z);

const CredentialUpdateSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: StrongPasswordSchema,
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
  const bannerImages = organization
    ? await getSetting('organization_banner_images', [], organization.id)
    : [];
  const barcodeScanningEnabled = organization
    ? await getSetting('barcode_scanning_enabled', true, organization.id)
    : true;

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
        slug: organization.slug,
        legal_name: organization.legal_name,
        contact_email: organization.contact_email,
        timezone: organization.timezone,
        abn: organization.abn,
        tax_id: organization.tax_id,
        address: organization.address,
        phone: organization.phone,
        website: organization.website,
        logo_url: organization.logo_url,
        type: organization.type,
        invoice_prefix: organization.invoice_prefix,
        default_payment_terms: organization.default_payment_terms,
        invoice_notes: organization.invoice_notes,
        currency: organization.currency,
        invoicing_enabled: organization.invoicing_enabled,
        logo_updated_at: organization.updatedAt ? organization.updatedAt.toISOString?.() || new Date(organization.updatedAt).toISOString() : null,
        banner_images: Array.isArray(bannerImages) ? bannerImages : [],
        features: {
          barcode_scanning_enabled: barcodeScanningEnabled !== false
        }
      } : null,
      ui_variant: user.ui_variant
    }
  });
}));

export default router;
