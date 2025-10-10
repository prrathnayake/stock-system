const STORAGE_KEY = 'rc-offline-queue';

let apiClient = null;
let inMemoryQueue = [];
let storageAvailable = null;

function supportsStorage() {
  if (storageAvailable !== null) return storageAvailable;
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      storageAvailable = false;
    } else {
      const testKey = '__rc_queue_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      storageAvailable = true;
    }
  } catch (err) {
    storageAvailable = false;
  }
  return storageAvailable;
}

function loadQueue() {
  if (!supportsStorage()) return inMemoryQueue;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    inMemoryQueue = raw ? JSON.parse(raw) : [];
  } catch (err) {
    inMemoryQueue = [];
  }
  return inMemoryQueue;
}

function saveQueue() {
  if (!supportsStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inMemoryQueue));
  } catch (err) {
    // storage might be full or unavailable, fallback to in-memory
    storageAvailable = false;
  }
}

function serialiseHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.toJSON === 'function') {
    return headers.toJSON();
  }
  return { ...headers };
}

function ensureQueueLoaded() {
  if (inMemoryQueue.length === 0 && supportsStorage()) {
    loadQueue();
  }
}

export function setQueueClient(client) {
  apiClient = client;
}

export async function enqueueRequest(config) {
  ensureQueueLoaded();
  const entry = {
    id: Date.now() + Math.random(),
    method: config.method,
    url: config.url,
    data: config.data,
    headers: serialiseHeaders(config.headers),
    createdAt: Date.now()
  };
  inMemoryQueue.push(entry);
  saveQueue();
  return entry;
}

export async function flushQueue() {
  if (!apiClient) return [];
  ensureQueueLoaded();
  const results = [];

  while (inMemoryQueue.length > 0) {
    const entry = inMemoryQueue[0];
    try {
      await apiClient({
        method: entry.method,
        url: entry.url,
        data: entry.data,
        headers: entry.headers
      });
      results.push({ id: entry.id, ok: true });
      inMemoryQueue.shift();
      saveQueue();
    } catch (err) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break;
      }
      results.push({ id: entry.id, ok: false, error: err });
      inMemoryQueue.shift();
      saveQueue();
    }
  }

  return results;
}

export async function getQueuedCount() {
  ensureQueueLoaded();
  return inMemoryQueue.length;
}
