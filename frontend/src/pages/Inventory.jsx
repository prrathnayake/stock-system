import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../providers/AuthProvider.jsx'

export default function Inventory() {
  const { user } = useAuth()
  const canManageProcurement = ['inventory', 'admin'].includes(user?.role)
  const [query, setQuery] = useState('')

  const { data: products = [], isFetching, refetch } = useQuery({
    queryKey: ['inventory', query],
    queryFn: async () => {
      const { data } = await api.get('/stock', { params: { sku: query || undefined } })
      return data
    }
  })

  const { data: serials = [] } = useQuery({
    queryKey: ['serials'],
    queryFn: async () => {
      const { data } = await api.get('/serials')
      return data
    }
  })

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/purchase-orders')
      return data
    },
    enabled: canManageProcurement
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/suppliers')
      return data
    },
    enabled: canManageProcurement
  })

  const { data: rmaCases = [] } = useQuery({
    queryKey: ['rma-cases'],
    queryFn: async () => {
      const { data } = await api.get('/rma')
      return data
    },
    enabled: canManageProcurement
  })

  const lowStock = useMemo(
    () => products.filter((row) => row.available <= (row.reorder_point ?? 0)),
    [products]
  )

  const latestSerials = serials.slice(0, 8)
  const openPurchaseOrders = purchaseOrders.slice(0, 5)
  const openRmas = rmaCases.slice(0, 5)

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h2>Inventory catalogue</h2>
            <p className="muted">Search, filter and act on live stock data, including purchasing and RMA pipelines.</p>
          </div>
          <button className="button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="filter-grid">
          <label className="field">
            <span>Search by SKU or name</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex. BATT-IPHONE" />
          </label>
        </div>
      </div>

      <div className="grid two-columns">
        <div className="card">
          <h3>All products</h3>
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Lead time (days)</th>
              </tr>
            </thead>
            <tbody>
              {products.map((row) => (
                <tr key={row.id}>
                  <td><span className="badge">{row.sku}</span></td>
                  <td>{row.name}</td>
                  <td>{row.on_hand}</td>
                  <td>{row.reserved}</td>
                  <td>{row.available}</td>
                  <td>{row.lead_time_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Low stock alerts</h3>
          <p className="muted">Products that are at or below their reorder point.</p>
          <ul className="timeline">
            {lowStock.length === 0 && <li className="muted">Everything looks healthy.</li>}
            {lowStock.map((item) => (
              <li key={item.id}>
                <div className="timeline__title">{item.name}</div>
                <div className="timeline__meta">{item.available} available · reorder at {item.reorder_point}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid two-columns">
        <div className="card">
          <h3>Serialised inventory</h3>
          <p className="muted">Most recent serial numbers registered in the system.</p>
          <table className="table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Product</th>
                <th>Status</th>
                <th>Bin</th>
              </tr>
            </thead>
            <tbody>
              {latestSerials.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">No serialised units recorded.</td>
                </tr>
              )}
              {latestSerials.map((serial) => (
                <tr key={serial.id}>
                  <td><span className="badge badge--muted">{serial.serial}</span></td>
                  <td>{serial.product?.name || serial.productId}</td>
                  <td><span className={`badge badge--${serial.status === 'available' ? 'success' : serial.status === 'faulty' ? 'danger' : 'info'}`}>{serial.status}</span></td>
                  <td>{serial.bin?.code || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Suppliers</h3>
          <p className="muted">Active vendor roster with lead times.</p>
          {canManageProcurement ? (
            <ul className="timeline">
              {suppliers.length === 0 && <li className="muted">No suppliers configured yet.</li>}
              {suppliers.map((supplier) => (
                <li key={supplier.id}>
                  <div className="timeline__title">{supplier.name}</div>
                  <div className="timeline__meta">
                    {supplier.contact_email || supplier.contact_name || '—'}
                    {supplier.lead_time_days ? ` · ${supplier.lead_time_days} day lead` : ''}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Inventory administrators can add suppliers from the backend API.</p>
          )}
        </div>
      </div>

      <div className="grid two-columns">
        <div className="card">
          <h3>Purchase orders</h3>
          <p className="muted">Open procurement activity awaiting receipt.</p>
          {canManageProcurement ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {openPurchaseOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">No purchase orders yet.</td>
                  </tr>
                )}
                {openPurchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td>{po.reference}</td>
                    <td>{po.supplier?.name || '—'}</td>
                    <td><span className="badge badge--info">{po.status}</span></td>
                    <td>{po.expected_at ? new Date(po.expected_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Purchase orders are available to inventory coordinators.</p>
          )}
        </div>

        <div className="card">
          <h3>RMA cases</h3>
          <p className="muted">Returns and credits awaiting supplier resolution.</p>
          {canManageProcurement ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {openRmas.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">No RMA activity.</td>
                  </tr>
                )}
                {openRmas.map((rma) => (
                  <tr key={rma.id}>
                    <td>{rma.reference}</td>
                    <td>{rma.supplier?.name || '—'}</td>
                    <td>{rma.status}</td>
                    <td>{rma.credit_amount ? `$${Number(rma.credit_amount).toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">RMA tracking is reserved for inventory leads.</p>
          )}
        </div>
      </div>
    </div>
  )
}
