import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'path';
import { existsSync } from 'fs';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import userRoutes from './routes/users.js';
import createStockRoutes from './routes/stock.js';
import createWorkOrderRoutes from './routes/workorders.js';
import createSerialRoutes from './routes/serials.js';
import createPurchasingRoutes from './routes/purchasing.js';
import createRmaRoutes from './routes/rma.js';
import settingsRoutes from './routes/settings.js';
import backupsRoutes from './routes/backups.js';
import organizationRoutes from './routes/organization.js';
import createInvoiceRoutes from './routes/invoices.js';
import { config } from './config.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.cors.allowAll || config.cors.origins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, legacyHeaders: false }));
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
  app.use(config.uploads.publicPath, express.static(config.uploads.directory, {
    fallthrough: false,
    maxAge: '7d'
  }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  return app;
}

export function registerRoutes(app, io) {
  app.use('/auth', authRoutes);
  app.use('/users', userRoutes);
  app.use('/products', productRoutes);
  app.use('/stock', createStockRoutes(io));
  app.use('/work-orders', createWorkOrderRoutes(io));
  app.use('/serials', createSerialRoutes(io));
  app.use('/purchasing', createPurchasingRoutes(io));
  app.use('/rma', createRmaRoutes(io));
  app.use('/invoices', createInvoiceRoutes(io));
  app.use('/settings', settingsRoutes);
  app.use('/backups', backupsRoutes);
  app.use('/organization', organizationRoutes);

  if (config.frontend.serve) {
    const distPath = config.frontend.distPath;
    if (distPath && existsSync(distPath)) {
      app.use(express.static(distPath, { index: false }));
      app.get('*', (req, res, next) => {
        if (req.method !== 'GET') return next();
        const acceptHeader = req.headers.accept || '';
        const acceptsHtml = acceptHeader.includes('text/html') || acceptHeader === '*/*';
        if (!acceptsHtml) return next();
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.warn(`Frontend dist path "${distPath}" not found; SPA assets will not be served.`);
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
}
