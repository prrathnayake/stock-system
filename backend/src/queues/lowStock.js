import BullMQ from 'bullmq';
import { createRedisConnection } from '../redis/client.js';
import { Organization, Product, Bin, StockLevel } from '../db.js';
import { invalidateStockOverviewCache } from '../services/cache.js';
import { getSetting } from '../services/settings.js';
import { runAsOrganization } from '../services/requestContext.js';
import { notifyLowStockAlert } from '../services/notificationService.js';

const { Queue, Worker } = BullMQ;

const QUEUE_NAME = 'low-stock';

const queueConnection = createRedisConnection();
const workerConnection = createRedisConnection();

const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

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
  await queue.waitUntilReady();

  worker = new Worker(QUEUE_NAME, async (job) => {
    const orgIds = job.data?.organizationId
      ? [job.data.organizationId]
      : (await Organization.findAll({ attributes: ['id'], skipOrganizationScope: true })).map(org => org.id);

    let totalCount = 0;
    for (const orgId of orgIds) {
      const count = await runAsOrganization(orgId, async () => {
        const snapshot = await calculateLowStockSnapshot();
        const alertsEnabled = await getSetting('low_stock_alerts_enabled', true, orgId);
        if (snapshot.length > 0 && alertsEnabled !== false) {
          if (ioRef) {
            ioRef.emit('alerts:low-stock', { organization_id: orgId, snapshot });
          }
          notifyLowStockAlert({ organizationId: orgId, snapshot }).catch((error) => {
            console.error('[notify] failed to send low stock email', error);
          });
        }
        await invalidateStockOverviewCache(orgId);
        return snapshot.length;
      });
      totalCount += count;
    }
    return { count: totalCount };
  }, { connection: workerConnection });

  worker.on('failed', (job, err) => {
    console.error('[queue] low-stock job failed', job?.id, err);
  });

  initialised = true;
  await ensureRepeatingJob();
  return { queue, worker };
}

export async function enqueueLowStockScan({ delay = 0, organizationId = null } = {}) {
  try {
    const jobId = organizationId ? `${ON_DEMAND_JOB_ID}:${organizationId}` : ON_DEMAND_JOB_ID;
    await queue.add('scan', { organizationId }, {
      jobId,
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
    worker?.close(),
    queueConnection.quit(),
    workerConnection.quit()
  ]);
}

process.on('SIGTERM', shutdownQueues);
process.on('SIGINT', shutdownQueues);
