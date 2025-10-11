import React, { useMemo } from 'react'

function formatDateLabel(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export default function StockHistoryChart({ points = [], height = 200 }) {
  const prepared = useMemo(() => {
    if (!points || points.length === 0) return []
    return points
      .map((point) => ({
        x: new Date(point.occurredAt).getTime(),
        y: point.level
      }))
      .sort((a, b) => a.x - b.x)
  }, [points])

  if (prepared.length === 0) {
    return <div className="chart-placeholder">No stock movement recorded yet.</div>
  }

  const values = prepared.map((point) => point.y)
  const minY = Math.min(...values)
  const maxY = Math.max(...values)
  const minX = prepared[0].x
  const maxX = prepared[prepared.length - 1].x

  const xRange = Math.max(maxX - minX, 1)
  const yRange = Math.max(maxY - minY, 1)

  const normalized = prepared.map((point) => ({
    x: ((point.x - minX) / xRange) * 100,
    y: 100 - ((point.y - minY) / yRange) * 100,
    value: point.y
  }))

  const path = normalized.reduce((acc, point, index) => (
    index === 0 ? `M ${point.x},${point.y}` : `${acc} L ${point.x},${point.y}`
  ), '')

  const areaPath = `${path} L 100,100 L 0,100 Z`

  const yTicks = 4
  const tickValues = Array.from({ length: yTicks + 1 }, (_, index) => {
    const ratio = index / yTicks
    return Math.round(minY + ratio * (maxY - minY))
  })

  return (
    <div className="chart" style={{ height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Stock level trend">
        <defs>
          <linearGradient id="stockGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(99,102,241,0.28)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0.02)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#stockGradient)" stroke="none" />
        <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="chart__labels">
        <div className="chart__y-axis">
          {tickValues.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>
        <div className="chart__x-axis">
          <span>{formatDateLabel(new Date(minX))}</span>
          <span>{formatDateLabel(new Date(maxX))}</span>
        </div>
      </div>
    </div>
  )
}
