import React, { useEffect, useMemo, useState } from 'react';

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

function buildSeries(history = [], key) {
  return history
    .map((entry) => ({
      timestamp: entry?.captured_at ? new Date(entry.captured_at) : null,
      value: typeof entry?.[key] === 'number' && !Number.isNaN(entry[key]) ? entry[key] : null
    }))
    .filter((item) => item.value !== null);
}

function Sparkline({ title, series, formatter = (value) => value, units = '', color = 'var(--color-primary)', width = 160, height = 60 }) {
  const latest = series.length > 0 ? series[series.length - 1] : null;
  const min = series.reduce((acc, point) => (point.value < acc ? point.value : acc), Number.POSITIVE_INFINITY);
  const max = series.reduce((acc, point) => (point.value > acc ? point.value : acc), Number.NEGATIVE_INFINITY);
  const hasRange = Number.isFinite(min) && Number.isFinite(max);

  const path = useMemo(() => {
    if (series.length < 2 || !hasRange) return '';
    const range = max - min || 1;
    return series
      .map((point, index) => {
        const x = (index / (series.length - 1)) * width;
        const normalised = range === 0 ? 0.5 : 1 - (point.value - min) / range;
        const y = normalised * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [series, hasRange, max, min]);

  const heightPx = Math.max(height, 40);

  return (
    <div className="developer-telemetry__sparkline" style={{ '--sparkline-height': `${heightPx}px` }}>
      <div className="developer-telemetry__sparkline-header">
        <div>
          <span className="developer-telemetry__sparkline-label">{title}</span>
          <strong className="developer-telemetry__sparkline-value">
            {latest ? formatter(latest.value) : '—'}
            {units}
          </strong>
        </div>
        {latest?.timestamp && (
          <time className="developer-telemetry__sparkline-time" dateTime={latest.timestamp.toISOString()}>
            {latest.timestamp.toLocaleTimeString()}
          </time>
        )}
      </div>
      <div className="developer-telemetry__sparkline-chart" role="img" aria-label={`${title} trend`}>
        {series.length < 2 ? (
          <span className="developer-telemetry__sparkline-empty">Not enough data</span>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            <polyline points={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      {hasRange && series.length >= 2 && (
        <div className="developer-telemetry__sparkline-range">
          <span>Min {formatter(min)}{units}</span>
          <span>Max {formatter(max)}{units}</span>
        </div>
      )}
    </div>
  );
}

const TERMINAL_EVENT_LABELS = {
  session_created: 'Session created',
  session_claimed: 'Session claimed',
  session_connected: 'Shell connected',
  session_closed: 'Session closed',
  session_disconnected: 'Client disconnected',
  session_error: 'Session error',
  session_rejected: 'Session rejected',
  corrupt: 'Corrupt log entry'
};

function describeTerminalEvent(event) {
  const label = TERMINAL_EVENT_LABELS[event?.type] || 'Terminal event';
  return label;
}

function truncate(value, max = 72) {
  if (typeof value !== 'string') return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export default function DeveloperTelemetry({ telemetry, onRefresh, isRefreshing }) {
  const performance = telemetry?.performance;
  const security = telemetry?.security;
  const history = Array.isArray(telemetry?.history) ? telemetry.history : [];
  const logs = Array.isArray(telemetry?.logs) ? telemetry.logs : [];
  const terminalLogs = Array.isArray(telemetry?.terminal_logs) ? telemetry.terminal_logs : [];

  const failingChecks = useMemo(() => security?.failing || [], [security?.failing]);
  const totalChecks = security?.checks?.length || 0;
  const passingChecks = security?.totals?.passing || (totalChecks - failingChecks.length);

  const loadSeries = useMemo(() => buildSeries(history, 'load_one'), [history]);
  const memorySeries = useMemo(() => buildSeries(history, 'rss_mb'), [history]);
  const heapSeries = useMemo(() => buildSeries(history, 'heap_used_mb'), [history]);
  const eventLoopSeries = useMemo(() => buildSeries(history, 'event_loop_delay_max_ms'), [history]);
  const chartOptions = useMemo(() => ([
    {
      id: 'load',
      title: 'Load (1m)',
      series: loadSeries,
      formatter: (value) => formatNumber(value, { maximumFractionDigits: 2 }),
      units: '',
      color: 'var(--color-primary)'
    },
    {
      id: 'memory',
      title: 'Memory RSS',
      series: memorySeries,
      formatter: (value) => formatNumber(value, { maximumFractionDigits: 1 }),
      units: ' MB',
      color: 'var(--color-accent-end)'
    },
    {
      id: 'heap',
      title: 'Heap used',
      series: heapSeries,
      formatter: (value) => formatNumber(value, { maximumFractionDigits: 1 }),
      units: ' MB',
      color: 'var(--color-success)'
    },
    {
      id: 'event-loop',
      title: 'Event loop max',
      series: eventLoopSeries,
      formatter: (value) => formatNumber(value, { maximumFractionDigits: 1 }),
      units: ' ms',
      color: 'var(--color-warning)'
    }
  ]), [loadSeries, memorySeries, heapSeries, eventLoopSeries]);

  const [activeChartId, setActiveChartId] = useState(() => chartOptions[0]?.id || null);

  useEffect(() => {
    if (!chartOptions || chartOptions.length === 0) {
      setActiveChartId(null);
      return;
    }
    const current = chartOptions.find((option) => option.id === activeChartId);
    if (!current) {
      setActiveChartId(chartOptions[0]?.id || null);
    }
  }, [chartOptions, activeChartId]);

  const activeChart = useMemo(
    () => chartOptions.find((option) => option.id === activeChartId) || null,
    [chartOptions, activeChartId]
  );

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
          <div className="developer-telemetry__charts">
            <h5>Performance trends</h5>
            <p className="muted">History from recent telemetry refreshes.</p>
            {chartOptions.length > 0 ? (
              <>
                <nav className="developer-telemetry__chart-nav" aria-label="Performance metrics">
                  {chartOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`developer-telemetry__chart-nav-button${activeChartId === option.id ? ' developer-telemetry__chart-nav-button--active' : ''}`}
                      onClick={() => setActiveChartId(option.id)}
                    >
                      {option.title}
                    </button>
                  ))}
                </nav>
                {activeChart ? (
                  <Sparkline
                    key={activeChart.id}
                    title={activeChart.title}
                    series={activeChart.series}
                    formatter={activeChart.formatter}
                    units={activeChart.units}
                    color={activeChart.color}
                    width={360}
                    height={140}
                  />
                ) : (
                  <p className="muted developer-telemetry__chart-empty">No telemetry history captured yet.</p>
                )}
              </>
            ) : (
              <p className="muted developer-telemetry__chart-empty">No telemetry history captured yet.</p>
            )}
          </div>
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
      <section className="developer-telemetry__panel developer-telemetry__panel--logs" aria-label="Recent error logs">
        <header>
          <h4>Recent error logs</h4>
          <p className="muted">
            {logs.length > 0
              ? `Last ${Math.min(logs.length, 20)} captured errors from the API node.`
              : 'No recent errors captured since the last telemetry refresh.'}
          </p>
        </header>
        {logs.length > 0 ? (
          <div className="developer-telemetry__table-wrapper">
            <table className="developer-telemetry__table">
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                    </td>
                    <td>{entry.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Infrastructure is quiet—no error logs to display.</p>
        )}
      </section>
      <section className="developer-telemetry__panel developer-telemetry__panel--logs" aria-label="Terminal session activity">
        <header>
          <h4>Terminal session activity</h4>
          <p className="muted">
            {terminalLogs.length > 0
              ? `Last ${Math.min(terminalLogs.length, 40)} security-audited session events.`
              : 'No terminal sessions have been recorded yet.'}
          </p>
        </header>
        {terminalLogs.length > 0 ? (
          <div className="developer-telemetry__table-wrapper">
            <table className="developer-telemetry__table developer-telemetry__table--terminal">
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Event</th>
                  <th scope="col">Session</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {terminalLogs.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.timestamp ? (
                        <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{describeTerminalEvent(entry)}</td>
                    <td>
                      {entry.session_reference ? <code>{entry.session_reference}</code> : '—'}
                      {entry.user_id && <div className="muted">User #{entry.user_id}</div>}
                    </td>
                    <td>
                      {entry.ip || '—'}
                      {entry.user_agent && (
                        <div className="muted" title={entry.user_agent}>
                          {truncate(entry.user_agent, 64)}
                        </div>
                      )}
                    </td>
                    <td>{entry.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Launch a terminal session to populate encrypted audit logs.</p>
        )}
      </section>
    </section>
  );
}
