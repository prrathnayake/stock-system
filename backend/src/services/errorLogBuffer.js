const MAX_LOG_ENTRIES = 200;
const logBuffer = [];
let sequence = 0;

function serialiseValue(value) {
  if (value instanceof Error) {
    return value.stack || value.message || value.toString();
  }

  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return `[unserializable: ${error.message}]`;
    }
  }

  if (typeof value === 'undefined') return 'undefined';
  if (value === null) return 'null';
  return String(value);
}

export function recordErrorLog(args = []) {
  try {
    const message = args.map(serialiseValue).join(' ');
    const entry = {
      id: `${Date.now()}-${sequence += 1}`,
      timestamp: new Date().toISOString(),
      level: 'error',
      message: message.slice(0, 2000),
      context: args.map(serialiseValue)
    };

    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
      logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
    }
  } catch (error) {
    // Swallow logging errors to avoid recursive failures.
  }
}

export function getRecentErrorLogs(limit = 20) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [...logBuffer].slice(-20).reverse();
  }
  return [...logBuffer]
    .slice(-Math.min(limit, logBuffer.length))
    .reverse();
}

