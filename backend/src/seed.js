import { sequelize, Organization, User } from './db.js';
import bcrypt from 'bcryptjs';
import { runAsOrganization } from './services/requestContext.js';

(async () => {
  await sequelize.sync({ force: true });
  const [organization] = await Organization.findOrCreate({
    where: { slug: 'default' },
    defaults: {
      name: 'Default Organization',
      legal_name: 'Default Organization Pty Ltd',
      contact_email: 'operations@example.com',
      abn: '12 345 678 901',
      address: '123 Example Street\nSydney NSW 2000',
      timezone: 'Australia/Sydney',
      default_payment_terms: 'Due within 14 days',
      invoice_notes: 'Please remit payment to Default Organization within the agreed terms.',
      invoice_prefix: 'INV-',
      currency: 'AUD',
      invoicing_enabled: true
    }
  });

  await runAsOrganization(organization.id, async () => {
    const hash = await bcrypt.hash('admin123', 10);
    await User.create({
      full_name: 'Admin',
      email: 'admin@example.com',
      password_hash: hash,
      role: 'admin',
      must_change_password: true,
      ui_variant: 'pro'
    });
  });
  console.log('Seed complete');
  process.exit(0);
})();
