import { Router } from 'express';
import { z } from 'zod';
import { Organization } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { notifyOrganizationProfileUpdated, primeOrganizationContact } from '../services/notificationService.js';

const router = Router();

const UpdateSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  contact_email: z.union([z.string().email('Valid email required'), z.literal('')]).optional(),
  timezone: z.string().max(128).optional()
});

function serializeOrganization(org) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    contact_email: org.contact_email,
    timezone: org.timezone
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
  if (updates.contact_email === '') {
    updates.contact_email = null;
  }
  await organization.update(updates);
  primeOrganizationContact(organization);
  res.json(serializeOrganization(organization));
  notifyOrganizationProfileUpdated({ organization, actor: req.user }).catch((error) => {
    console.error('[notify] failed to send organization update email', error);
  });
}));

export default router;
