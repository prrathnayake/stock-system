import IORedis from 'ioredis';
import { config } from '../config.js';

const baseOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};

export function createRedisConnection() {
  const client = new IORedis(config.redis.url, baseOptions);
  client.on('error', (err) => {
    console.error('[redis] connection error', err);
  });
  return client;
}

export const redis = createRedisConnection();

process.on('beforeExit', async () => {
  try {
    if (redis.status !== 'end') {
      await redis.quit();
    }
  } catch (err) {
    console.error('[redis] error during shutdown', err);
  }
});
