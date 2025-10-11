import { api } from './api';

export function resolveAssetUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const baseURL = api.defaults.baseURL ? api.defaults.baseURL.replace(/\/+$/, '') : '';
  if (!baseURL) {
    return url;
  }
  const normalized = url.startsWith('/') ? url : `/${url}`;
  return `${baseURL}${normalized}`;
}
