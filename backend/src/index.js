import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { sequelize, User, Product, Location, Bin, StockLevel } from './db.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import createStockRoutes from './routes/stock.js';
import createWorkOrderRoutes from './routes/workorders.js';

const app = express();
const server = createServer(app);
const io = new IOServer(server, {
  cors: { origin: config.corsOrigin, credentials: true }
});

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/stock', createStockRoutes(io));
app.use('/work-orders', createWorkOrderRoutes(io));

// Boot
(async () => {
  await sequelize.authenticate();
  await sequelize.sync();
  console.log('DB connected and synced');

  // Seed minimal data if empty
  const users = await User.count();
  if (users === 0) {
    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash('admin123', 10);
    await User.create({ full_name: 'Admin', email: 'admin@example.com', password_hash: hash, role: 'admin' });
    console.log('Seeded admin user admin@example.com / admin123');
  }
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

  server.listen(config.port, () => console.log(`API listening on :${config.port}`));
})().catch(err => {
  console.error(err);
  process.exit(1);
});

io.on('connection', socket => {
  console.log('client connected', socket.id);
  socket.on('disconnect', () => console.log('client disconnected', socket.id));
});
