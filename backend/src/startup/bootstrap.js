import { sequelize, Organization, User, Product, Location, Bin, StockLevel } from '../db.js';
import { config } from '../config.js';
import { runAsOrganization } from '../services/requestContext.js';

export async function initialiseDatabase() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  const [organization] = await Organization.findOrCreate({
    where: { slug: 'default' },
    defaults: { name: 'Default Organization' }
  });

  await runAsOrganization(organization.id, async () => {
    const users = await User.count();
    if (users === 0) {
      const bcrypt = (await import('bcryptjs')).default;
      const hash = await bcrypt.hash('admin123', 10);
      await User.create({
        full_name: 'Admin',
        email: 'admin@example.com',
        password_hash: hash,
        role: 'admin',
        must_change_password: true
      });
      console.log('Seeded admin user admin@example.com / admin123');
    }

    if (config.env !== 'production') {
      const locs = await Location.count();
      if (locs === 0) {
        const loc = await Location.create({ site: 'Main', room: 'Store' });
        const binA = await Bin.create({ code: 'A-01', locationId: loc.id });
        const binB = await Bin.create({ code: 'B-01', locationId: loc.id });
        const p1 = await Product.create({ sku: 'BATT-IPHONE', name: 'iPhone Battery', reorder_point: 5 });
        const p2 = await Product.create({ sku: 'SCRN-ANDR-6', name: 'Android Screen 6"', reorder_point: 3 });
        await StockLevel.create({ productId: p1.id, binId: binA.id, on_hand: 10, reserved: 0 });
        await StockLevel.create({ productId: p2.id, binId: binB.id, on_hand: 6, reserved: 0 });
        console.log('Seeded demo data');
      }
    }
  });
}
