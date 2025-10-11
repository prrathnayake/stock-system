import { Organization } from '../db.js';
import { sendEmail } from './email.js';

const organizationCache = new Map();

function cacheOrganizationContact(organizationId, details) {
  organizationCache.set(organizationId, { details, cachedAt: Date.now() });
}

export function invalidateOrganizationContact(organizationId) {
  if (!organizationId) return;
  organizationCache.delete(Number(organizationId));
}

export function primeOrganizationContact(organization) {
  if (!organization) return;
  cacheOrganizationContact(organization.id, {
    email: organization.contact_email || null,
    name: organization.legal_name || organization.name || 'Your Organization'
  });
}

async function getOrganizationContact(organizationId) {
  if (!organizationId) return null;
  const id = Number(organizationId);
  const cached = organizationCache.get(id);
  if (cached && Date.now() - cached.cachedAt < 5 * 60_000) {
    return cached.details;
  }
  const organization = await Organization.findByPk(id, { skipOrganizationScope: true });
  if (!organization) {
    cacheOrganizationContact(id, null);
    return null;
  }
  const details = {
    email: organization.contact_email || null,
    name: organization.legal_name || organization.name || 'Your Organization'
  };
  cacheOrganizationContact(id, details);
  return details;
}

function actorLabel(actor) {
  return actor?.name || actor?.full_name || actor?.email || 'System';
}

async function notifyOrganization(organizationId, subject, message) {
  const contact = await getOrganizationContact(organizationId);
  if (!contact?.email) {
    return;
  }
  await sendEmail({
    to: contact.email,
    subject,
    text: message
  });
}

export async function notifyUserAccountCreated({ organizationId, actor, user }) {
  const contact = await getOrganizationContact(organizationId);
  const orgName = contact?.name || 'Stock System';
  const performer = actorLabel(actor);
  if (user?.email) {
    await sendEmail({
      to: user.email,
      subject: `[${orgName}] Your account is ready`,
      text: `Hello ${user.full_name || user.email},\n\n${performer} just created a new account for you in ${orgName}. Sign in with the temporary password that was provided to you and change it from the security settings.\n\nIf you were not expecting this email please reach out to your administrator.\n\n— ${orgName}`
    });
  }
  await notifyOrganization(
    organizationId,
    `[${orgName}] User account created`,
    `${performer} created a new ${user?.role || 'user'} account for ${user?.full_name || user?.email}.`
  );
}

export async function notifyUserAccountUpdated({ organizationId, actor, user }) {
  const contact = await getOrganizationContact(organizationId);
  const orgName = contact?.name || 'Stock System';
  const performer = actorLabel(actor);
  await notifyOrganization(
    organizationId,
    `[${orgName}] User account updated`,
    `${performer} updated access for ${user?.full_name || user?.email}.`
  );
}

export async function notifyUserAccountDeleted({ organizationId, actor, user }) {
  const contact = await getOrganizationContact(organizationId);
  const orgName = contact?.name || 'Stock System';
  const performer = actorLabel(actor);
  await notifyOrganization(
    organizationId,
    `[${orgName}] User account removed`,
    `${performer} removed the account for ${user?.full_name || user?.email}.`
  );
}

export async function notifyInventoryAdjustment({ organizationId, actor, product, qty, reason, fromBin, toBin }) {
  const contact = await getOrganizationContact(organizationId);
  const orgName = contact?.name || 'Stock System';
  const performer = actorLabel(actor);
  const lines = [
    `${performer} recorded a ${reason} adjustment for ${product?.name || 'product'} (${product?.sku || 'SKU'}).`,
    `Quantity: ${qty}`
  ];
  if (fromBin?.code) {
    lines.push(`From bin: ${fromBin.code}`);
  }
  if (toBin?.code) {
    lines.push(`To bin: ${toBin.code}`);
  }
  await notifyOrganization(
    organizationId,
    `[${orgName}] Inventory adjustment recorded`,
    lines.join('\n')
  );
}

export async function notifySettingsChanged({ organizationId, actor, keys }) {
  const contact = await getOrganizationContact(organizationId);
  const orgName = contact?.name || 'Stock System';
  const performer = actorLabel(actor);
  const changed = Array.isArray(keys) && keys.length ? keys.join(', ') : 'organization settings';
  await notifyOrganization(
    organizationId,
    `[${orgName}] Configuration updated`,
    `${performer} updated ${changed}.`
  );
}

export async function notifyOrganizationProfileUpdated({ organization, actor }) {
  primeOrganizationContact(organization);
  const performer = actorLabel(actor);
  const name = organization?.legal_name || organization?.name || 'Your organization';
  if (organization?.contact_email) {
    await sendEmail({
      to: organization.contact_email,
      subject: `[${name}] Profile updated`,
      text: `${performer} updated your organization profile. Name: ${name}. Timezone: ${organization.timezone || 'not set'}.`
    });
  }
}
