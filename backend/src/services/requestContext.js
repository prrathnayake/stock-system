import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

export function runWithRequestContext(context, callback) {
  const parent = storage.getStore() || {};
  const nextContext = { ...parent, ...context };
  return storage.run(nextContext, callback);
}

export function getRequestContext() {
  return storage.getStore() || {};
}

export function getOrganizationId() {
  const { organizationId } = getRequestContext();
  return organizationId ?? null;
}

export function getUserId() {
  const { userId } = getRequestContext();
  return userId ?? null;
}

export function runAsOrganization(organizationId, callback) {
  return runWithRequestContext({ organizationId }, callback);
}
