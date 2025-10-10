import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import userRoutes from './routes/users.js';
import createStockRoutes from './routes/stock.js';
import createWorkOrderRoutes from './routes/workorders.js';
import { config } from './config.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, legacyHeaders: false }));
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  return app;
}

export function registerRoutes(app, io) {
  app.use('/auth', authRoutes);
  app.use('/users', userRoutes);
  app.use('/products', productRoutes);
  app.use('/stock', createStockRoutes(io));
  app.use('/work-orders', createWorkOrderRoutes(io));

  app.use(notFoundHandler);
  app.use(errorHandler);
}
