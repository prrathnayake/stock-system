import React, { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { io } from 'socket.io-client'
import { useAuth } from '../providers/AuthProvider.jsx'
import { ORGANIZATION_TYPES } from '../lib/appInfo.js'
import { resolveAssetUrl } from '../lib/urls'
import TablePagination from '../components/TablePagination.jsx'

const socket = io(import.meta.env.VITE_SOCKET_URL, { autoConnect: false })
const reasonLabels = {
  receive: 'Received',
  adjust: 'Adjusted',
  pick: 'Picked',
  return: 'Returned',
  transfer: 'Transferred',
  reserve: 'Reserved',
  release: 'Released',
  invoice_sale: 'Invoice fulfilled',
  receive_po: 'Purchase order received',
  rma_out: 'RMA dispatched',
  rma_return: 'RMA returned'
}

export default function Dashboard() {
  const queryClient = useQueryClient()
  const { user, organization } = useAuth()
  const organizationId = user?.organization?.id

  const orgName = organization?.legal_name || organization?.name || user?.organization?.name || null
  const typeInfo = useMemo(() => {
    const activeType = organization?.type || user?.organization?.type || ''
    return ORGANIZATION_TYPES.find((item) => item.id === activeType) || null
  }, [organization?.type, user?.organization?.type])
  const headerTitle = orgName ? `${orgName} inventory pulse` : 'Inventory control center'
  const headerSubtitle = orgName
    ? `${typeInfo?.description ? `${typeInfo.description} ` : ''}Search, curate and adjust your catalogue for ${orgName}.`
    : typeInfo?.description || 'Search, curate and adjust your catalogue with real-time visibility into stock health.'
  const timezoneSummary = useMemo(() => {
    if (!organization?.timezone) return null
    return `Timezone: ${organization.timezone}`
  }, [organization?.timezone])

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

  const [activeBanner, setActiveBanner] = useState(0)
  const [lowStockPage, setLowStockPage] = useState(1)
  const [topBinsPage, setTopBinsPage] = useState(1)

  const maxStackTotal = chartData.reduce((max, row) => Math.max(max, row.available + row.reserved), 0) || 1

  const TABLE_PAGE_SIZE = 10

  const lowStockTotalPages = Math.max(1, Math.ceil(lowStock.length / TABLE_PAGE_SIZE))
  const visibleLowStock = useMemo(() => {
    const start = (lowStockPage - 1) * TABLE_PAGE_SIZE
    return lowStock.slice(start, start + TABLE_PAGE_SIZE)
  }, [lowStock, lowStockPage])

  const topBinsTotalPages = Math.max(1, Math.ceil(topBins.length / TABLE_PAGE_SIZE))
  const visibleTopBins = useMemo(() => {
    const start = (topBinsPage - 1) * TABLE_PAGE_SIZE
    return topBins.slice(start, start + TABLE_PAGE_SIZE)
  }, [topBins, topBinsPage])

  useEffect(() => {
    if (lowStockPage > lowStockTotalPages) {
      setLowStockPage(lowStockTotalPages)
    }
  }, [lowStockPage, lowStockTotalPages])

  useEffect(() => {
    if (topBinsPage > topBinsTotalPages) {
      setTopBinsPage(topBinsTotalPages)
    }
  }, [topBinsPage, topBinsTotalPages])

  const banners = useMemo(() => {
    const orgBanners = Array.isArray(organization?.banner_images)
      ? organization.banner_images
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => resolveAssetUrl(item))
      : []
    if (orgBanners.length > 0) {
      return orgBanners
    }
    return [
      'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1515165562835-c4c2b1c9d0e2?auto=format&fit=crop&w=1200&q=80'
    ]
  }, [organization?.banner_images])

  useEffect(() => {
    setActiveBanner(0)
  }, [banners])

  const nextBanner = () => {
    setActiveBanner((prev) => (prev + 1) % banners.length)
  }

  const prevBanner = () => {
    setActiveBanner((prev) => (prev - 1 + banners.length) % banners.length)
  }

  return (
    <div className="page">
      <div className="card dashboard__intro">
        <div>
          <h2>{headerTitle}</h2>
          <p className="muted">{headerSubtitle}</p>
        </div>
        {timezoneSummary && <span className="badge badge--muted">{timezoneSummary}</span>}
      </div>

      {banners.length > 0 && (
        <section className="card dashboard__banner" aria-label="Organization highlights">
          <div className="dashboard__banner-slider">
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={prevBanner}
              aria-label="Previous banner"
            >
              ‹
            </button>
            <div className="dashboard__banner-frame">
              <img src={banners[activeBanner]} alt="Organization showcase" />
            </div>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={nextBanner}
              aria-label="Next banner"
            >
              ›
            </button>
          </div>
          <div className="dashboard__banner-dots" role="tablist" aria-label="Select banner image">
            {banners.map((_, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={index === activeBanner}
                className={`dashboard__banner-dot${index === activeBanner ? ' dashboard__banner-dot--active' : ''}`}
                onClick={() => setActiveBanner(index)}
              >
                <span className="sr-only">Banner {index + 1}</span>
              </button>
            ))}
          </div>
        </section>
      )}

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
          <p className="muted">At-risk reservations</p>
          <h2>{overview?.reservedCount ?? '—'}</h2>
          <p className="stat-card__hint">Reservations that will exhaust on-hand stock once fulfilled.</p>
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
          <TablePagination
            page={lowStockPage}
            totalPages={lowStockTotalPages}
            onPrev={() => setLowStockPage((page) => Math.max(1, page - 1))}
            onNext={() => setLowStockPage((page) => Math.min(lowStockTotalPages, page + 1))}
            className="table-pagination--inline"
          />
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
              {visibleLowStock.map((item) => (
                <tr key={item.id}>
                  <td><span className="badge">{item.sku}</span></td>
                  <td>{item.name}</td>
                  <td>{item.available}</td>
                  <td>{item.reorder_point}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination
            page={lowStockPage}
            totalPages={lowStockTotalPages}
            onPrev={() => setLowStockPage((page) => Math.max(1, page - 1))}
            onNext={() => setLowStockPage((page) => Math.min(lowStockTotalPages, page + 1))}
          />
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
            {overview?.recentActivity?.map((event) => {
              const action = reasonLabels[event.reason] || event.reason
              const labelParts = [action]
              if (event.sku) {
                labelParts.push(event.sku)
              }
              if (event.productName) {
                labelParts.push(event.productName)
              }
              const movement = event.fromBin && event.toBin
                ? `${event.fromBin} → ${event.toBin}`
                : event.fromBin
                  ? `from ${event.fromBin}`
                  : event.toBin
                    ? `to ${event.toBin}`
                    : null
              const metaParts = [
                `${event.qty} units`,
                event.performedBy ? `by ${event.performedBy}` : null,
                movement,
                new Date(event.occurredAt).toLocaleString()
              ].filter(Boolean)
              return (
                <li key={event.id}>
                  <div className="timeline__title">{labelParts.join(' · ')}</div>
                  <div className="timeline__meta">{metaParts.join(' · ')}</div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3>Top stocked branch locations</h3>
        <p className="muted">Understand where inventory is concentrated across your branch network.</p>
        <TablePagination
          page={topBinsPage}
          totalPages={topBinsTotalPages}
          onPrev={() => setTopBinsPage((page) => Math.max(1, page - 1))}
          onNext={() => setTopBinsPage((page) => Math.min(topBinsTotalPages, page + 1))}
          className="table-pagination--inline"
        />
        <table className="table">
          <thead>
            <tr>
              <th>Branch code</th>
              <th>Branch</th>
              <th>SKU</th>
              <th>Product</th>
              <th>On hand</th>
              <th>Reserved</th>
            </tr>
          </thead>
          <tbody>
            {topBins.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No branch allocations recorded.</td>
              </tr>
            )}
            {visibleTopBins.map((bin) => (
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
        <TablePagination
          page={topBinsPage}
          totalPages={topBinsTotalPages}
          onPrev={() => setTopBinsPage((page) => Math.max(1, page - 1))}
          onNext={() => setTopBinsPage((page) => Math.min(topBinsTotalPages, page + 1))}
        />
      </div>
    </div>
  )
}
