import { HttpError } from '../utils/httpError.js';
import { config } from '../config.js';

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, 'Not Found'));
}

export function errorHandler(err, _req, res, _next) {
  const status = err instanceof HttpError && err.status ? err.status : 500;
  const payload = {
    error: err.message || 'Internal Server Error'
  };
  if (config.env !== 'production' && err.stack) {
    payload.stack = err.stack.split('\n').map(line => line.trim());
  }
  res.status(status).json(payload);
}
