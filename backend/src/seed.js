import { sequelize, Organization, User } from './db.js';
import bcrypt from 'bcryptjs';
import { runAsOrganization } from './services/requestContext.js';
import { config } from './config.js';

(async () => {
  await sequelize.sync({ force: true });
  const defaults = config.bootstrap.organization;
  const [organization] = await Organization.findOrCreate({
    where: { slug: 'default' },
    defaults: {
      name: defaults.name,
      legal_name: defaults.legalName,
      contact_email: defaults.contactEmail || null,
      abn: defaults.abn || null,
      tax_id: defaults.taxId || null,
      address: defaults.address || null,
      timezone: defaults.timezone,
      phone: defaults.phone || null,
      website: defaults.website || null,
      default_payment_terms: defaults.defaultPaymentTerms,
      invoice_notes: defaults.invoiceNotes,
      invoice_prefix: defaults.invoicePrefix,
      currency: defaults.currency,
      invoicing_enabled: defaults.invoicingEnabled
    }
  });

  await runAsOrganization(organization.id, async () => {
    const adminDefaults = config.bootstrap.admin;
    const hash = await bcrypt.hash(adminDefaults.password, 10);
    await User.create({
      full_name: adminDefaults.name || 'Admin',
      email: adminDefaults.email,
      password_hash: hash,
      role: 'admin',
      must_change_password: true,
      ui_variant: 'pro'
    });
  });
  console.log(`Seed complete. Default admin user ${config.bootstrap.admin.email} created.`);
  process.exit(0);
})();
