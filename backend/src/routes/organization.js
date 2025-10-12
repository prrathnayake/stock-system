import { Router } from 'express';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import multer from 'multer';
import { Organization } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { notifyOrganizationProfileUpdated, primeOrganizationContact } from '../services/notificationService.js';
import { config } from '../config.js';
import { bannerUpload, logoUpload } from '../middleware/uploads.js';
import { getSetting, upsertSettings, getFeatureFlags } from '../services/settings.js';

const router = Router();

const urlSchema = z.string().url('Must be a valid URL');
const uploadsPublicRoot = config.uploads.publicPath.replace(/\/+$/, '');
const escapeRegex = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const uploadsPathPattern = new RegExp(`^${escapeRegex(uploadsPublicRoot)}\/[A-Za-z0-9_.-]+$`);
const logoUrlSchema = z.union([
  urlSchema,
  z.literal(''),
  z.string().regex(uploadsPathPattern, 'Logo must be a valid URL or uploaded file path')
]);

function resolveStoredLogoPath(value) {
  if (!value) return null;
  const prefix = `${uploadsPublicRoot}/`;
  if (!value.startsWith(prefix)) {
    return null;
  }
  const relative = value.slice(prefix.length).replace(/^\/+/, '');
  if (!relative || relative.includes('..') || relative.includes('\\')) {
    return null;
  }
  return path.join(config.uploads.directory, relative);
}

const uploadLogoMiddleware = (req, res, next) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new HttpError(400, err.message));
    }
    return next(err);
  });
};

const uploadBannerMiddleware = (req, res, next) => {
  bannerUpload.single('banner')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new HttpError(400, err.message));
    }
    return next(err);
  });
};

const bannerUrlSchema = z.union([
  urlSchema,
  z.string().regex(uploadsPathPattern, 'Banner image must be a valid URL or uploaded file path')
]);

const bannerSchema = z.array(bannerUrlSchema).max(10, 'Provide up to 10 banner images');

const ORGANIZATION_TYPES = ['retail', 'service', 'manufacturing', 'distribution', 'education', 'healthcare', 'nonprofit', 'technology', 'other'];

const UpdateSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  legal_name: z.string().max(191).optional(),
  contact_email: z.union([z.string().email('Valid email required'), z.literal('')]).optional(),
  timezone: z.string().max(128).optional(),
  abn: z.string().max(32).optional(),
  tax_id: z.string().max(64).optional(),
  address: z.string().max(2000).optional(),
  phone: z.string().max(32).optional(),
  website: z.union([urlSchema, z.literal('')]).optional(),
  logo_url: logoUrlSchema.optional(),
  type: z.union([z.enum(ORGANIZATION_TYPES), z.literal('')]).optional(),
  invoice_prefix: z.string().max(16).optional(),
  default_payment_terms: z.string().max(191).optional(),
  invoice_notes: z.string().max(4000).optional(),
  currency: z.string().max(8).optional(),
  invoicing_enabled: z.boolean().optional(),
  banner_images: bannerSchema.optional()
});

function normaliseBannerImages(value) {
  if (!value) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && bannerUrlSchema.safeParse(item).success);
}

function serializeOrganization(org, extras = {}) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    legal_name: org.legal_name,
    contact_email: org.contact_email,
    timezone: org.timezone,
    abn: org.abn,
    tax_id: org.tax_id,
    address: org.address,
    phone: org.phone,
    website: org.website,
    logo_url: org.logo_url,
    type: org.type,
    invoice_prefix: org.invoice_prefix,
    default_payment_terms: org.default_payment_terms,
    invoice_notes: org.invoice_notes,
    currency: org.currency,
    invoicing_enabled: org.invoicing_enabled,
    banner_images: normaliseBannerImages(extras.bannerImages ?? extras.banner_images ?? org.banner_images),
    logo_updated_at: org.updatedAt ? org.updatedAt.toISOString?.() || new Date(org.updatedAt).toISOString() : null
  };
}

router.get('/', requireAuth(['admin', 'developer']), asyncHandler(async (req, res) => {
  const organization = await Organization.findByPk(req.user.organization_id, { skipOrganizationScope: true });
  if (!organization) {
    throw new HttpError(404, 'Organization not found');
  }
  primeOrganizationContact(organization);
  const bannerImages = await getSetting('organization_banner_images', [], organization.id);
  const features = await getFeatureFlags(organization.id);
  res.json({ ...serializeOrganization(organization, { bannerImages }), features });
}));

router.put('/', requireAuth(['admin', 'developer']), asyncHandler(async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
  }
  const organization = await Organization.findByPk(req.user.organization_id, { skipOrganizationScope: true });
  if (!organization) {
    throw new HttpError(404, 'Organization not found');
  }
  const updates = { ...parsed.data };
  const normaliseEmpty = (key) => {
    if (Object.prototype.hasOwnProperty.call(updates, key) && updates[key] === '') {
      updates[key] = null;
    }
  };
  ['contact_email', 'legal_name', 'abn', 'tax_id', 'address', 'phone', 'website', 'logo_url', 'invoice_prefix', 'default_payment_terms', 'invoice_notes', 'currency', 'timezone', 'type'].forEach(normaliseEmpty);
  const bannerImagesUpdate = parsed.data.banner_images !== undefined
    ? normaliseBannerImages(parsed.data.banner_images)
    : undefined;

  await organization.update(updates);
  await organization.reload();
  if (bannerImagesUpdate !== undefined) {
    await upsertSettings({ organization_banner_images: bannerImagesUpdate }, organization.id);
  }
  primeOrganizationContact(organization);
  const bannerImages = bannerImagesUpdate !== undefined
    ? bannerImagesUpdate
    : await getSetting('organization_banner_images', [], organization.id);
  const features = await getFeatureFlags(organization.id);
  res.json({ ...serializeOrganization(organization, { bannerImages }), features });
  notifyOrganizationProfileUpdated({ organization, actor: req.user }).catch((error) => {
    console.error('[notify] failed to send organization update email', error);
  });
}));

router.post('/banner', requireAuth(['admin', 'developer']), uploadBannerMiddleware, asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'Banner file is required');
  }

  const organization = await Organization.findByPk(req.user.organization_id, { skipOrganizationScope: true });
  if (!organization) {
    await fs.unlink(req.file.path).catch(() => {});
    throw new HttpError(404, 'Organization not found');
  }

  const existing = await getSetting('organization_banner_images', [], organization.id);
  const currentBanners = Array.isArray(existing) ? normaliseBannerImages(existing) : [];
  if (currentBanners.length >= 10) {
    await fs.unlink(req.file.path).catch(() => {});
    throw new HttpError(400, 'Maximum of 10 banner images allowed. Remove an existing banner to upload a new one.');
  }

  const bannerUrl = `${uploadsPublicRoot}/${req.file.filename}`;
  const nextBanners = normaliseBannerImages([...currentBanners, bannerUrl]);

  try {
    await upsertSettings({ organization_banner_images: nextBanners }, organization.id);
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    throw error;
  }

  res.status(201).json({ banner_url: bannerUrl, banner_images: nextBanners });
}));

router.post('/logo', requireAuth(['admin', 'developer']), uploadLogoMiddleware, asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'Logo file is required');
  }
  const organization = await Organization.findByPk(req.user.organization_id, { skipOrganizationScope: true });
  if (!organization) {
    throw new HttpError(404, 'Organization not found');
  }

  const newLogoUrl = `${uploadsPublicRoot}/${req.file.filename}`;
  const previousLogoPath = resolveStoredLogoPath(organization.logo_url);
  if (previousLogoPath) {
    fs.unlink(previousLogoPath).catch((error) => {
      if (error?.code !== 'ENOENT') {
        console.warn('[uploads] Failed to remove old logo:', error.message);
      }
    });
  }

  await organization.update({ logo_url: newLogoUrl });
  await organization.reload();
  res.status(201).json({ logo_url: newLogoUrl, logo_updated_at: organization.updatedAt?.toISOString?.() || new Date(organization.updatedAt).toISOString() });
}));

export default router;
