import os from 'os';
import { monitorEventLoopDelay } from 'perf_hooks';
import { getReadinessReport } from './readiness.js';
import { getRecentErrorLogs } from './errorLogBuffer.js';
import { getTerminalEvents } from './terminalAuditLog.js';

const performanceHistory = [];
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

  performanceHistory.push({
    captured_at: snapshot.captured_at,
    load_one: snapshot.load_average?.one ?? null,
    load_five: snapshot.load_average?.five ?? null,
    load_fifteen: snapshot.load_average?.fifteen ?? null,
    rss_mb: snapshot.memory?.rss_mb ?? null,
    heap_used_mb: snapshot.memory?.heap_used_mb ?? null,
    event_loop_delay_mean_ms: snapshot.event_loop_delay_ms?.mean ?? null,
    event_loop_delay_max_ms: snapshot.event_loop_delay_ms?.max ?? null
  });

  if (performanceHistory.length > HISTORY_LIMIT) {
    performanceHistory.splice(0, performanceHistory.length - HISTORY_LIMIT);
  }

  return snapshot;
}

export async function getDeveloperTelemetry({ organizationId }) {
  const [readinessReport] = await Promise.all([
    getReadinessReport({ organizationId })
  ]);

  const performance = capturePerformanceSnapshot();
  const securityChecks = readinessReport?.checks || [];
  const passingChecks = securityChecks.filter((check) => check.ok).length;
  const failingChecks = securityChecks.filter((check) => !check.ok);

  return {
    generated_at: new Date().toISOString(),
    performance,
    history: [...performanceHistory],
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
