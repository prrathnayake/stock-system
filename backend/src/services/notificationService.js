import { Organization } from '../db.js';
import { sendEmail } from './email.js';
import { getSetting } from './settings.js';

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

async function getNotificationContext(organizationId) {
  const contact = await getOrganizationContact(organizationId);
  const extra = await getSetting('notification_emails', [], organizationId);
  const recipients = new Set();
  if (contact?.email) {
    recipients.add(contact.email);
  }
  if (Array.isArray(extra)) {
    extra.forEach((entry) => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed) {
          recipients.add(trimmed);
        }
      }
    });
  }
  return {
    contact,
    orgName: contact?.name || 'Stock System',
    recipients: Array.from(recipients)
  };
}

async function deliverNotification(context, subject, message) {
  if (!context?.recipients?.length) {
    return;
  }
  await sendEmail({
    to: context.recipients.join(', '),
    subject,
    text: message
  });
}

export async function notifyUserAccountCreated({ organizationId, actor, user, credentials }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const performer = actorLabel(actor);
  if (user?.email) {
    const loginLines = [];
    if (credentials?.organizationSlug) {
      loginLines.push(`Organization: ${credentials.organizationSlug}`);
    }
    if (credentials?.email) {
      loginLines.push(`Email: ${credentials.email}`);
    }
    if (credentials?.temporaryPassword) {
      loginLines.push(`Temporary password: ${credentials.temporaryPassword}`);
    }
    const loginDetails = loginLines.length
      ? `You can sign in with the following temporary credentials:\n\n${loginLines.join('\n')}\n\nYou will be asked to set a new password when you first sign in.`
      : 'Sign in with the temporary password that was provided to you and change it from the security settings.';
    await sendEmail({
      to: user.email,
      subject: `[${orgName}] Your account is ready`,
      text: `Hello ${user.full_name || user.email},\n\n${performer} just created a new account for you in ${orgName}. ${loginDetails}\n\nIf you were not expecting this email please reach out to your administrator.\n\n— ${orgName}`
    });
  }
  await deliverNotification(
    context,
    `[${orgName}] User account created`,
    `${performer} created a new ${user?.role || 'user'} account for ${user?.full_name || user?.email}.`
  );
}

export async function notifyUserAccountUpdated({ organizationId, actor, user }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const performer = actorLabel(actor);
  await deliverNotification(
    context,
    `[${orgName}] User account updated`,
    `${performer} updated access for ${user?.full_name || user?.email}.`
  );
}

export async function notifyUserAccountDeleted({ organizationId, actor, user }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const performer = actorLabel(actor);
  await deliverNotification(
    context,
    `[${orgName}] User account removed`,
    `${performer} removed the account for ${user?.full_name || user?.email}.`
  );
}

export async function notifyInventoryAdjustment({ organizationId, actor, product, qty, reason, fromBin, toBin }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
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
  await deliverNotification(
    context,
    `[${orgName}] Inventory adjustment recorded`,
    lines.join('\n')
  );
}

export async function notifyProductCreated({ organizationId, actor, product }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const performer = actorLabel(actor);
  const lines = [
    `${performer} added a new product to the catalogue.`,
    `Name: ${product?.name || '—'} (${product?.sku || 'SKU'})`
  ];
  if (typeof product?.reorder_point === 'number') {
    lines.push(`Reorder point: ${product.reorder_point}`);
  }
  if (typeof product?.lead_time_days === 'number') {
    lines.push(`Lead time: ${product.lead_time_days} day(s)`);
  }
  await deliverNotification(
    context,
    `[${orgName}] Product created`,
    lines.join('\n')
  );
}

export async function notifyProductUpdated({ organizationId, actor, product, changes }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const performer = actorLabel(actor);
  const changed = Array.isArray(changes) && changes.length ? changes.join(', ') : 'product details';
  const lines = [
    `${performer} updated ${changed} for ${product?.name || 'product'} (${product?.sku || 'SKU'}).`
  ];
  if (typeof product?.reorder_point === 'number') {
    lines.push(`Reorder point is now ${product.reorder_point}.`);
  }
  if (typeof product?.unit_price === 'number') {
    lines.push(`Unit price is now ${product.unit_price}.`);
  }
  await deliverNotification(
    context,
    `[${orgName}] Product updated`,
    lines.join('\n')
  );
}

export async function notifyProductArchived({ organizationId, actor, product }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const performer = actorLabel(actor);
  await deliverNotification(
    context,
    `[${orgName}] Product archived`,
    `${performer} archived ${product?.name || 'a product'} (${product?.sku || 'SKU'}). Remaining stock was written off.`
  );
}

export async function notifyLowStockAlert({ organizationId, snapshot }) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return;
  }
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const lines = [
    'The following items are at or below their reorder point:'
  ];
  snapshot.slice(0, 10).forEach((item) => {
    const name = item?.name || item?.sku || 'Unknown item';
    const sku = item?.sku ? ` (${item.sku})` : '';
    const available = typeof item?.available === 'number' ? item.available : 'n/a';
    const reorder = typeof item?.reorder_point === 'number' ? item.reorder_point : 'n/a';
    lines.push(`• ${name}${sku}: ${available} available (reorder point ${reorder})`);
  });
  if (snapshot.length > 10) {
    lines.push(`…and ${snapshot.length - 10} more item(s).`);
  }
  lines.push('', 'Review stock levels to plan replenishment.');
  await deliverNotification(
    context,
    `[${orgName}] Low stock alert`,
    lines.join('\n')
  );
}

export async function notifySettingsChanged({ organizationId, actor, keys }) {
  const context = await getNotificationContext(organizationId);
  const orgName = context.orgName;
  const performer = actorLabel(actor);
  const changed = Array.isArray(keys) && keys.length ? keys.join(', ') : 'organization settings';
  await deliverNotification(
    context,
    `[${orgName}] Configuration updated`,
    `${performer} updated ${changed}.`
  );
}

export async function notifyOrganizationProfileUpdated({ organization, actor }) {
  primeOrganizationContact(organization);
  const context = await getNotificationContext(organization.id);
  const performer = actorLabel(actor);
  const name = organization?.legal_name || organization?.name || 'Your organization';
  await deliverNotification(
    context,
    `[${name}] Profile updated`,
    `${performer} updated your organization profile. Name: ${name}. Timezone: ${organization.timezone || 'not set'}.`
  );
}
