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
import { logoUpload } from '../middleware/uploads.js';

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
  invoice_prefix: z.string().max(16).optional(),
  default_payment_terms: z.string().max(191).optional(),
  invoice_notes: z.string().max(4000).optional(),
  currency: z.string().max(8).optional(),
  invoicing_enabled: z.boolean().optional()
});

function serializeOrganization(org) {
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
    invoice_prefix: org.invoice_prefix,
    default_payment_terms: org.default_payment_terms,
    invoice_notes: org.invoice_notes,
    currency: org.currency,
    invoicing_enabled: org.invoicing_enabled
  };
}

router.get('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const organization = await Organization.findByPk(req.user.organization_id, { skipOrganizationScope: true });
  if (!organization) {
    throw new HttpError(404, 'Organization not found');
  }
  primeOrganizationContact(organization);
  res.json(serializeOrganization(organization));
}));

router.put('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
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
  ['contact_email', 'legal_name', 'abn', 'tax_id', 'address', 'phone', 'website', 'logo_url', 'invoice_prefix', 'default_payment_terms', 'invoice_notes', 'currency', 'timezone'].forEach(normaliseEmpty);
  await organization.update(updates);
  primeOrganizationContact(organization);
  res.json(serializeOrganization(organization));
  notifyOrganizationProfileUpdated({ organization, actor: req.user }).catch((error) => {
    console.error('[notify] failed to send organization update email', error);
  });
}));

router.post('/logo', requireAuth(['admin']), uploadLogoMiddleware, asyncHandler(async (req, res) => {
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
  res.status(201).json({ logo_url: newLogoUrl });
}));

export default router;
