import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { createApp, registerRoutes } from './app.js';
import { initialiseDatabase } from './startup/bootstrap.js';
import { initLowStockQueue } from './queues/lowStock.js';
import { scheduleBackups } from './services/backup.js';
import backupsRoutes from './routes/backups.js';

const app = createApp();
const server = config.tls.enabled
  ? createHttpsServer({
    key: fs.readFileSync(config.tls.keyPath),
    cert: fs.readFileSync(config.tls.certPath),
    ca: config.tls.caPath ? fs.readFileSync(config.tls.caPath) : undefined
  }, app)
  : createHttpServer(app);
const io = new IOServer(server, {
  cors: { origin: config.corsOrigin, credentials: true }
});

registerRoutes(app, io);
app.use('/backups', backupsRoutes);

(async () => {
  await initialiseDatabase();
  await initLowStockQueue(io);
  scheduleBackups();
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
