import { sequelize, User, Product, Location, Bin, StockLevel } from './db.js';
import bcrypt from 'bcryptjs';

(async () => {
  await sequelize.sync({ force: true });
  const hash = await bcrypt.hash('admin123', 10);
  await User.create({ full_name: 'Admin', email: 'admin@example.com', password_hash: hash, role: 'admin' });
  const loc = await Location.create({ site: 'Main', room: 'Store' });
  const binA = await Bin.create({ code: 'A-01', locationId: loc.id });
  const binB = await Bin.create({ code: 'B-01', locationId: loc.id });
  const p1 = await Product.create({ sku: 'BATT-IPHONE', name: 'iPhone Battery', reorder_point: 5 });
  const p2 = await Product.create({ sku: 'SCRN-ANDR-6', name: 'Android Screen 6\"', reorder_point: 3 });
  await StockLevel.create({ productId: p1.id, binId: binA.id, on_hand: 10, reserved: 0 });
  await StockLevel.create({ productId: p2.id, binId: binB.id, on_hand: 6, reserved: 0 });
  console.log('Seed complete');
  process.exit(0);
})();
