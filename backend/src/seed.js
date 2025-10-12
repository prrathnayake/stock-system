import { sequelize, Organization, User } from './db.js';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import path from 'path';
import { runAsOrganization } from './services/requestContext.js';
import { config } from './config.js';
import { SeedSchema, seedOrganizationData } from './services/seedImporter.js';
import { invalidateStockOverviewCache } from './services/cache.js';

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

    const developerDefaults = config.bootstrap.developer;
    if (developerDefaults?.email && developerDefaults?.password) {
      const existingDeveloper = await User.findOne({ where: { email: developerDefaults.email } });
      if (!existingDeveloper) {
        const developerHash = await bcrypt.hash(developerDefaults.password, 10);
        await User.create({
          full_name: developerDefaults.name || 'Developer',
          email: developerDefaults.email,
          password_hash: developerHash,
          role: 'developer',
          must_change_password: true,
          ui_variant: 'pro'
        });
      }
    }

    const seedPath = process.argv[2] || process.env.SEED_DATA_PATH;
    if (seedPath) {
      const resolvedSeedPath = path.resolve(seedPath);
      try {
        const raw = await fs.readFile(resolvedSeedPath, 'utf8');
        const parsed = JSON.parse(raw);
        const validation = SeedSchema.safeParse(parsed);
        if (!validation.success) {
          console.error('[seed] Seed file validation failed.');
          console.error(JSON.stringify(validation.error.flatten(), null, 2));
          process.exitCode = 1;
          return;
        }
        const summary = await seedOrganizationData({
          data: validation.data,
          organizationId: organization.id
        });
        await invalidateStockOverviewCache(organization.id).catch(() => {});
        console.log(`[seed] Imported seed data from ${resolvedSeedPath}`);
        console.log(JSON.stringify(summary, null, 2));
      } catch (error) {
        console.error(`[seed] Unable to import seed data from ${resolvedSeedPath}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  });
  console.log(
    `Seed complete. Default admin user ${config.bootstrap.admin.email} and developer user ${config.bootstrap.developer.email} created.`
  );
  const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
  process.exit(exitCode);
})();
