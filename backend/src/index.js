import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { createApp, registerRoutes } from './app.js';
import { initialiseDatabase } from './startup/bootstrap.js';
import { initLowStockQueue } from './queues/lowStock.js';
import { scheduleBackups } from './services/backup.js';
import { scheduleDailyDigest } from './services/dailyDigest.js';

const app = createApp();
const server = config.tls.enabled
  ? createHttpsServer({
    key: fs.readFileSync(config.tls.keyPath),
    cert: fs.readFileSync(config.tls.certPath),
    ca: config.tls.caPath ? fs.readFileSync(config.tls.caPath) : undefined
  }, app)
  : createHttpServer(app);
const io = new IOServer(server, {
  cors: {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.cors.allowAll || config.cors.origins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }
});

registerRoutes(app, io);

(async () => {
  await initialiseDatabase();
  await initLowStockQueue(io);
  scheduleBackups();
  scheduleDailyDigest();
  server.listen(config.port, () => console.log(`API listening on :${config.port}`));
})().catch(err => {
  console.error(err);
  process.exit(1);
});

io.on('connection', socket => {
  console.log('client connected', socket.id);
  socket.on('disconnect', () => console.log('client disconnected', socket.id));
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection', reason);
});
