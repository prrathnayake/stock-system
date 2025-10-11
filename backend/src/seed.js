import { sequelize, Organization, User } from './db.js';
import bcrypt from 'bcryptjs';
import { runAsOrganization } from './services/requestContext.js';

(async () => {
  await sequelize.sync({ force: true });
  const [organization] = await Organization.findOrCreate({
    where: { slug: 'default' },
    defaults: { name: 'Default Organization', contact_email: 'operations@example.com' }
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
