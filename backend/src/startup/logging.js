import { recordErrorLog } from '../services/errorLogBuffer.js';

const originalConsoleError = console.error.bind(console);

console.error = (...args) => {
  recordErrorLog(args);
  originalConsoleError(...args);
};

