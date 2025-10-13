import React, { useMemo } from 'react';

function formatNumber(value, options = {}) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const { maximumFractionDigits = 2, minimumFractionDigits = 0 } = options;
  return value.toLocaleString(undefined, { maximumFractionDigits, minimumFractionDigits });
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export default function DeveloperTelemetry({ telemetry, onRefresh, isRefreshing }) {
  const performance = telemetry?.performance;
  const security = telemetry?.security;

  const failingChecks = useMemo(() => security?.failing || [], [security?.failing]);
  const totalChecks = security?.checks?.length || 0;
  const passingChecks = security?.totals?.passing || (totalChecks - failingChecks.length);

  if (!telemetry) {
    return null;
  }

  return (
    <section className="developer-telemetry" aria-labelledby="developer-telemetry-heading">
      <header className="developer-telemetry__header">
        <div>
          <h3 id="developer-telemetry-heading">Operational telemetry</h3>
          <p className="muted">Live performance and security posture snapshots refresh on demand.</p>
        </div>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh snapshot'}
        </button>
      </header>
      <div className="developer-telemetry__grid">
        <section className="developer-telemetry__panel" aria-label="Performance snapshot">
          <header>
            <h4>Performance snapshot</h4>
            <p className="muted">
              Captured {performance?.captured_at ? new Date(performance.captured_at).toLocaleTimeString() : 'recently'}.
            </p>
          </header>
          <dl>
            <div>
              <dt>Uptime</dt>
              <dd>{formatDuration(performance?.uptime_seconds)}</dd>
            </div>
            <div>
              <dt>Load (1m)</dt>
              <dd>
                {formatNumber(performance?.load_average?.one)}
                {performance?.load_average?.per_core_one !== undefined && (
                  <span className="muted">
                    {' '}· per core {formatNumber(performance?.load_average?.per_core_one)}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>Load (5m / 15m)</dt>
              <dd>
                {formatNumber(performance?.load_average?.five)} / {formatNumber(performance?.load_average?.fifteen)}
              </dd>
            </div>
            <div>
              <dt>Memory (RSS / Heap)</dt>
              <dd>
                {formatNumber(performance?.memory?.rss_mb)} MB / {formatNumber(performance?.memory?.heap_used_mb)} MB
              </dd>
            </div>
            <div>
              <dt>System free memory</dt>
              <dd>{formatNumber(performance?.system_memory?.free_mb)} MB</dd>
            </div>
            <div>
              <dt>Event loop delay</dt>
              <dd>
                {formatNumber(performance?.event_loop_delay_ms?.mean)} ms avg · {formatNumber(performance?.event_loop_delay_ms?.max)} ms max
              </dd>
            </div>
          </dl>
        </section>
        <section className="developer-telemetry__panel" aria-label="Security posture">
          <header>
            <h4>Security posture</h4>
            <p className="muted">
              {passingChecks} of {totalChecks} readiness checks passing.
            </p>
          </header>
          {failingChecks.length === 0 ? (
            <p className="developer-telemetry__ok">All monitored controls are healthy.</p>
          ) : (
            <ul className="developer-telemetry__failures">
              {failingChecks.map((check) => (
                <li key={check.id}>
                  <strong>{check.title}</strong>
                  <p className="muted">{check.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
          {security?.generated_at && (
            <p className="muted developer-telemetry__timestamp">
              Readiness report generated {new Date(security.generated_at).toLocaleString()}.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
