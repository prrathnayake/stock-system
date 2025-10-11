import React, { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { io } from 'socket.io-client'
import { useAuth } from '../providers/AuthProvider.jsx'

const socket = io(import.meta.env.VITE_SOCKET_URL, { autoConnect: false })
const reasonLabels = {
  receive: 'Received',
  adjust: 'Adjusted',
  pick: 'Picked',
  return: 'Returned',
  transfer: 'Transferred',
  reserve: 'Reserved',
  release: 'Released',
  invoice_sale: 'Invoice fulfilled'
}

export default function Dashboard() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = user?.organization?.id

  const { data: overview } = useQuery({
    queryKey: ['stock-overview'],
    queryFn: async () => {
      const { data } = await api.get('/stock/overview')
      return data
    },
    refetchInterval: 60_000
  })

  const { data: stock = [] } = useQuery({
    queryKey: ['stock-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/stock')
      return data
    },
    refetchInterval: 60_000
  })

  useEffect(() => {
    if (!socket.connected) socket.connect()
    const handler = (payload = {}) => {
      if (payload.organization_id && organizationId && payload.organization_id !== organizationId) {
        return
      }
      queryClient.invalidateQueries({ queryKey: ['stock-overview'] })
      queryClient.invalidateQueries({ queryKey: ['stock-dashboard'] })
    }
    socket.on('stock:update', handler)
    socket.on('alerts:low-stock', handler)
    return () => {
      socket.off('stock:update', handler)
      socket.off('alerts:low-stock', handler)
    }
  }, [queryClient, organizationId])

  const lowStock = stock.filter((item) => item.available <= item.reorder_point)
  const topBins = stock
    .flatMap((item) => item.bins.map((bin) => ({
      product: item.name,
      sku: item.sku,
      ...bin
    })))
    .sort((a, b) => b.on_hand - a.on_hand)
    .slice(0, 5)

  const chartData = stock
    .slice()
    .sort((a, b) => b.available - a.available)
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      name: item.name,
      available: item.available,
      reserved: item.reserved
    }))

  const maxStackTotal = chartData.reduce((max, row) => Math.max(max, row.available + row.reserved), 0) || 1

  return (
    <div className="page">
      <div className="grid stats">
        <div className="card stat-card">
          <p className="muted">Active products</p>
          <h2>{overview?.productCount ?? '—'}</h2>
          <p className="stat-card__hint">Tracked items currently in circulation.</p>
        </div>
        <div className="card stat-card">
          <p className="muted">Low stock items</p>
          <h2>{overview?.lowStockCount ?? '—'}</h2>
          <p className="stat-card__hint">Below reorder point across all locations.</p>
        </div>
        <div className="card stat-card">
          <p className="muted">Reserved units</p>
          <h2>{overview?.reservedCount ?? '—'}</h2>
          <p className="stat-card__hint">Allocated to work orders and repairs.</p>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <h3>Inventory mix</h3>
            <p className="muted">Compare on-hand versus reserved units for top-moving products.</p>
          </div>
        </div>
        <div className="stacked-chart" role="img" aria-label="Inventory availability chart">
          {chartData.length === 0 && <p className="muted">Inventory data will appear once products are loaded.</p>}
          {chartData.map((row) => {
            const availableWidth = Math.max(0, (row.available / maxStackTotal) * 100)
            const reservedWidth = Math.max(0, (row.reserved / maxStackTotal) * 100)
            return (
              <div key={row.id} className="stacked-chart__row">
                <div className="stacked-chart__label">{row.name}</div>
                <div className="stacked-chart__bar">
                  <span
                    className="stacked-chart__segment stacked-chart__segment--available"
                    style={{ width: `${availableWidth}%` }}
                    aria-hidden="true"
                  />
                  <span
                    className="stacked-chart__segment stacked-chart__segment--reserved"
                    style={{ width: `${reservedWidth}%` }}
                    aria-hidden="true"
                  />
                </div>
                <div className="stacked-chart__values">
                  <span>{row.available} available</span>
                  <span>{row.reserved} reserved</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid two-columns">
        <div className="card">
          <div className="card__header">
            <div>
              <h3>Low stock watchlist</h3>
              <p className="muted">Prioritise replenishment for these parts.</p>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Available</th>
                <th>Reorder point</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">No items require attention right now.</td>
                </tr>
              )}
              {lowStock.map((item) => (
                <tr key={item.id}>
                  <td><span className="badge">{item.sku}</span></td>
                  <td>{item.name}</td>
                  <td>{item.available}</td>
                  <td>{item.reorder_point}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card__header">
            <div>
              <h3>Recent activity</h3>
              <p className="muted">Stock movements in the last operations cycle.</p>
            </div>
          </div>
          <ul className="timeline">
            {(overview?.recentActivity?.length ?? 0) === 0 && <li className="muted">Awaiting first transactions.</li>}
            {overview?.recentActivity?.map((event) => (
              <li key={event.id}>
                <div className="timeline__title">{reasonLabels[event.reason] || event.reason} · {event.sku}</div>
                <div className="timeline__meta">{event.qty} units · {new Date(event.occurredAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3>Top stocked bins</h3>
        <p className="muted">Understand where inventory is concentrated across your network.</p>
        <table className="table">
          <thead>
            <tr>
              <th>Bin</th>
              <th>Location</th>
              <th>SKU</th>
              <th>Product</th>
              <th>On hand</th>
              <th>Reserved</th>
            </tr>
          </thead>
          <tbody>
            {topBins.map((bin) => (
              <tr key={`${bin.bin_id}-${bin.sku}`}>
                <td>{bin.bin_code}</td>
                <td>{bin.location || '—'}</td>
                <td><span className="badge">{bin.sku}</span></td>
                <td>{bin.product}</td>
                <td>{bin.on_hand}</td>
                <td>{bin.reserved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
