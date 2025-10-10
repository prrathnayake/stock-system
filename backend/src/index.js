import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import { config } from './config.js';
import { createApp, registerRoutes } from './app.js';
import { initialiseDatabase } from './startup/bootstrap.js';
import { initLowStockQueue } from './queues/lowStock.js';

const app = createApp();
const server = createServer(app);
const io = new IOServer(server, {
  cors: { origin: config.corsOrigin, credentials: true }
});

registerRoutes(app, io);

(async () => {
  await initialiseDatabase();
  await initLowStockQueue(io);
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
