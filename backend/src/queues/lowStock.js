import { Queue, QueueScheduler, Worker } from 'bullmq';
import { createRedisConnection } from '../redis/client.js';
import { Product, Bin, StockLevel } from '../db.js';
import { invalidateStockOverviewCache } from '../services/cache.js';

const QUEUE_NAME = 'low-stock';

const queueConnection = createRedisConnection();
const workerConnection = createRedisConnection();
const schedulerConnection = createRedisConnection();

const queue = new Queue(QUEUE_NAME, { connection: queueConnection });
const scheduler = new QueueScheduler(QUEUE_NAME, { connection: schedulerConnection });

let worker;
let ioRef = null;
let initialised = false;
const ON_DEMAND_JOB_ID = 'low-stock-manual';

async function calculateLowStockSnapshot() {
  const products = await Product.findAll({
    where: { active: true },
    include: [{
      model: Bin,
      through: { model: StockLevel }
    }]
  });

  const lowStock = [];
  products.forEach((product) => {
    let onHand = 0;
    let reserved = 0;
    product.bins.forEach((bin) => {
      onHand += bin.stock_level.on_hand;
      reserved += bin.stock_level.reserved;
    });
    const available = onHand - reserved;
    if (available <= product.reorder_point) {
      lowStock.push({
        id: product.id,
        sku: product.sku,
        name: product.name,
        available,
        reorder_point: product.reorder_point
      });
    }
  });

  return lowStock;
}

async function ensureRepeatingJob() {
  const jobs = await queue.getRepeatableJobs();
  const exists = jobs.some((job) => job.id === 'low-stock-scan');
  if (!exists) {
    await queue.add('scan', {}, {
      jobId: 'low-stock-scan',
      repeat: { every: 15 * 60 * 1000 },
      removeOnComplete: true,
      removeOnFail: true
    });
  }
}

export async function initLowStockQueue(io) {
  if (initialised) {
    ioRef = io;
    return { queue, worker };
  }

  ioRef = io;
  await scheduler.waitUntilReady();

  worker = new Worker(QUEUE_NAME, async () => {
    const snapshot = await calculateLowStockSnapshot();
    if (snapshot.length > 0 && ioRef) {
      ioRef.emit('alerts:low-stock', snapshot);
    }
    await invalidateStockOverviewCache();
    return { count: snapshot.length };
  }, { connection: workerConnection });

  worker.on('failed', (job, err) => {
    console.error('[queue] low-stock job failed', job?.id, err);
  });

  initialised = true;
  await ensureRepeatingJob();
  return { queue, worker };
}

export async function enqueueLowStockScan({ delay = 0 } = {}) {
  try {
    await queue.add('scan', {}, {
      jobId: ON_DEMAND_JOB_ID,
      removeOnComplete: true,
      removeOnFail: true,
      delay
    });
  } catch (err) {
    if (err?.message?.includes('jobId') && err?.message?.includes('already exists')) {
      return;
    }
    throw err;
  }
}

async function shutdownQueues() {
  await Promise.allSettled([
    queue.close(),
    scheduler.close(),
    worker?.close(),
    queueConnection.quit(),
    workerConnection.quit(),
    schedulerConnection.quit()
  ]);
}

process.on('SIGTERM', shutdownQueues);
process.on('SIGINT', shutdownQueues);
