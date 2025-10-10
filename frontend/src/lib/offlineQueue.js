import { openDB } from 'idb';

const DB_NAME = 'rc-offline';
const STORE_NAME = 'requests';

let apiClient = null;

export function setQueueClient(client) {
  apiClient = client;
}

function serialiseHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.toJSON === 'function') {
    return headers.toJSON();
  }
  return { ...headers };
}

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    }
  });
}

export async function enqueueRequest(config) {
  const db = await getDb();
  const entry = {
    method: config.method,
    url: config.url,
    data: config.data,
    headers: serialiseHeaders(config.headers),
    createdAt: Date.now()
  };
  await db.add(STORE_NAME, entry);
  return entry;
}

export async function flushQueue() {
  if (!apiClient) return [];
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.store;
  let cursor = await store.openCursor();
  const results = [];
  while (cursor) {
    const entry = cursor.value;
    try {
      await apiClient({
        method: entry.method,
        url: entry.url,
        data: entry.data,
        headers: entry.headers
      });
      await cursor.delete();
      results.push({ id: cursor.key, ok: true });
    } catch (err) {
      if (!navigator.onLine) {
        // stop processing when offline again
        break;
      }
      results.push({ id: cursor.key, ok: false, error: err });
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return results;
}

export async function getQueuedCount() {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const count = await tx.store.count();
  await tx.done;
  return count;
}
