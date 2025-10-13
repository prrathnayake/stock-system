import os from 'os';
import { monitorEventLoopDelay } from 'perf_hooks';
import { TelemetrySnapshot } from '../db.js';
import { getReadinessReport } from './readiness.js';
import { getRecentErrorLogs } from './errorLogBuffer.js';
import { getTerminalEvents } from './terminalAuditLog.js';

const HISTORY_LIMIT = 60;

const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
eventLoopMonitor.enable();

function toMegabytes(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round((value / (1024 * 1024)) * 100) / 100;
}

function capturePerformanceSnapshot() {
  const memory = process.memoryUsage();
  const loadAverage = os.loadavg();
  const cpuCount = os.cpus()?.length || 1;
  const uptimeSeconds = Math.round(process.uptime());
  const loopStats = {
    mean: eventLoopMonitor?.mean ?? 0,
    max: eventLoopMonitor?.max ?? 0
  };

  const snapshot = {
    captured_at: new Date().toISOString(),
    uptime_seconds: uptimeSeconds,
    load_average: {
      one: Math.round(loadAverage[0] * 100) / 100,
      five: Math.round(loadAverage[1] * 100) / 100,
      fifteen: Math.round(loadAverage[2] * 100) / 100,
      per_core_one: Math.round((loadAverage[0] / cpuCount) * 100) / 100
    },
    memory: {
      rss_mb: toMegabytes(memory.rss),
      heap_total_mb: toMegabytes(memory.heapTotal),
      heap_used_mb: toMegabytes(memory.heapUsed),
      external_mb: toMegabytes(memory.external)
    },
    system_memory: {
      total_mb: toMegabytes(os.totalmem()),
      free_mb: toMegabytes(os.freemem())
    },
    event_loop_delay_ms: {
      mean: Math.round((loopStats.mean / 1e6) * 100) / 100,
      max: Math.round((loopStats.max / 1e6) * 100) / 100
    }
  };

  if (typeof eventLoopMonitor?.reset === 'function') {
    eventLoopMonitor.reset();
  }

  return snapshot;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalisePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('[telemetry] Failed to parse stored snapshot payload', error);
      return {};
    }
  }
  return raw;
}

function buildHistoryEntry(record) {
  if (!record) return null;
  const payload = normalisePayload(record.payload);
  const capturedAt = toIsoString(record.captured_at || payload.captured_at);

  return {
    captured_at: capturedAt,
    load_one: payload?.load_average?.one ?? null,
    load_five: payload?.load_average?.five ?? null,
    load_fifteen: payload?.load_average?.fifteen ?? null,
    rss_mb: payload?.memory?.rss_mb ?? null,
    heap_used_mb: payload?.memory?.heap_used_mb ?? null,
    event_loop_delay_mean_ms: payload?.event_loop_delay_ms?.mean ?? null,
    event_loop_delay_max_ms: payload?.event_loop_delay_ms?.max ?? null
  };
}

async function persistSnapshot(organizationId, snapshot) {
  if (!organizationId || !snapshot) {
    return false;
  }

  try {
    await TelemetrySnapshot.create({
      organizationId,
      captured_at: snapshot.captured_at,
      payload: snapshot
    });
    return true;
  } catch (error) {
    console.error('[telemetry] Failed to persist snapshot', error);
    return false;
  }
}

async function getSnapshotHistory(organizationId, limit = HISTORY_LIMIT) {
  if (!organizationId) return [];

  try {
    const snapshots = await TelemetrySnapshot.findAll({
      where: { organizationId },
      order: [['captured_at', 'DESC']],
      limit
    });

    return snapshots.reverse().map((snapshot) => buildHistoryEntry(snapshot)).filter(Boolean);
  } catch (error) {
    console.error('[telemetry] Failed to load stored snapshots', error);
    return [];
  }
}

export async function getDeveloperTelemetry({ organizationId }) {
  const [readinessReport] = await Promise.all([
    getReadinessReport({ organizationId })
  ]);

  const performance = capturePerformanceSnapshot();
  await persistSnapshot(organizationId, performance);

  let history = await getSnapshotHistory(organizationId);
  const latestSummary = buildHistoryEntry({ captured_at: performance.captured_at, payload: performance });
  if (latestSummary) {
    const lastEntry = history[history.length - 1];
    if (!lastEntry || lastEntry.captured_at !== latestSummary.captured_at) {
      const preserved = Math.max(0, HISTORY_LIMIT - 1);
      const retained = preserved > 0 ? history.slice(-preserved) : [];
      history = [...retained, latestSummary];
    }
  }

  const securityChecks = readinessReport?.checks || [];
  const passingChecks = securityChecks.filter((check) => check.ok).length;
  const failingChecks = securityChecks.filter((check) => !check.ok);

  return {
    generated_at: new Date().toISOString(),
    performance,
    history,
    logs: getRecentErrorLogs(),
    terminal_logs: getTerminalEvents(),
    security: {
      generated_at: readinessReport?.generated_at || null,
      summary: readinessReport?.summary || null,
      checks: securityChecks,
      totals: {
        passing: passingChecks,
        failing: failingChecks.length
      },
      failing: failingChecks
    }
  };
}
