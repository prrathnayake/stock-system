import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../providers/AuthProvider.jsx'

const initialProductForm = {
  sku: '',
  name: '',
  reorder_point: '5',
  lead_time_days: '0',
  track_serial: false
}

const initialAdjustmentForm = {
  product_id: '',
  bin_id: '',
  qty: '',
  direction: 'increase'
}

export default function Inventory() {
  const { user } = useAuth()
  const canManageProcurement = ['admin', 'user'].includes(user?.role)
  const [query, setQuery] = useState('')
  const [productForm, setProductForm] = useState(initialProductForm)
  const [adjustForm, setAdjustForm] = useState(initialAdjustmentForm)
  const [feedback, setFeedback] = useState(null)

  const { data: stock = [], isFetching, refetch } = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data } = await api.get('/stock')
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

  const createProduct = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/products', payload)
      return data
    }
  })

  const adjustStock = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/stock/move', payload)
      return data
    }
  })

  const filteredProducts = useMemo(() => {
    if (!query) return stock
    const term = query.toLowerCase()
    return stock.filter((row) =>
      row.sku.toLowerCase().includes(term) || row.name.toLowerCase().includes(term)
    )
  }, [stock, query])

  const lowStock = useMemo(
    () => stock.filter((row) => row.available <= (row.reorder_point ?? 0)),
    [stock]
  )

  const productOptions = useMemo(
    () => stock.map((row) => ({ id: row.id, name: row.name, sku: row.sku })),
    [stock]
  )

  const allBins = useMemo(() => {
    const map = new Map()
    stock.forEach((product) => {
      product.bins.forEach((bin) => {
        if (!map.has(bin.bin_id)) {
          map.set(bin.bin_id, {
            id: bin.bin_id,
            code: bin.bin_code,
            location: bin.location
          })
        }
      })
    })
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
  }, [stock])

  const selectedProduct = useMemo(
    () => stock.find((item) => String(item.id) === adjustForm.product_id) || null,
    [stock, adjustForm.product_id]
  )

  const binsForSelection = useMemo(() => {
    if (selectedProduct && selectedProduct.bins.length > 0) {
      return selectedProduct.bins.map((bin) => ({
        id: bin.bin_id,
        code: bin.bin_code,
        location: bin.location
      }))
    }
    return allBins
  }, [selectedProduct, allBins])

  const latestSerials = serials.slice(0, 8)
  const openPurchaseOrders = purchaseOrders.slice(0, 5)
  const openRmas = rmaCases.slice(0, 5)

  const handleCreateProduct = (event) => {
    event.preventDefault()
    setFeedback(null)
    const payload = {
      sku: productForm.sku.trim(),
      name: productForm.name.trim(),
      reorder_point: Number(productForm.reorder_point) || 0,
      lead_time_days: Number(productForm.lead_time_days) || 0,
      track_serial: Boolean(productForm.track_serial)
    }
    if (!payload.sku || !payload.name) {
      setFeedback({ type: 'error', message: 'SKU and product name are required.' })
      return
    }
    createProduct.mutate(payload, {
      onSuccess: () => {
        setFeedback({ type: 'success', message: 'Product created successfully.' })
        setProductForm(initialProductForm)
        refetch()
      },
      onError: (error) => {
        setFeedback({
          type: 'error',
          message: error.response?.data?.error || 'Unable to create product right now.'
        })
      }
    })
  }

  const handleAdjustStock = (event) => {
    event.preventDefault()
    setFeedback(null)
    const productId = Number(adjustForm.product_id)
    const binId = Number(adjustForm.bin_id)
    const qty = Number(adjustForm.qty)
    if (!productId || !binId || !qty || qty <= 0) {
      setFeedback({ type: 'error', message: 'Select a product, bin and enter a positive quantity.' })
      return
    }
    const payload = adjustForm.direction === 'increase'
      ? { product_id: productId, qty, from_bin_id: null, to_bin_id: binId, reason: 'receive' }
      : { product_id: productId, qty, from_bin_id: binId, to_bin_id: null, reason: 'adjust' }
    adjustStock.mutate(payload, {
      onSuccess: () => {
        setFeedback({
          type: 'success',
          message: adjustForm.direction === 'increase'
            ? 'Stock increased successfully.'
            : 'Stock decreased successfully.'
        })
        setAdjustForm((prev) => ({ ...prev, qty: '' }))
        refetch()
      },
      onError: (error) => {
        setFeedback({
          type: 'error',
          message: error.response?.data?.error || 'Unable to update stock levels.'
        })
      }
    })
  }

  const handleProductSelect = (value) => {
    setAdjustForm((prev) => {
      const product = stock.find((item) => String(item.id) === value)
      const defaultBin = product?.bins?.[0] || allBins[0]
      return {
        ...prev,
        product_id: value,
        bin_id: defaultBin ? String(defaultBin.bin_id ?? defaultBin.id) : ''
      }
    })
  }

  const hasBinsAvailable = binsForSelection.length > 0

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h2>Inventory controls</h2>
            <p className="muted">Create new catalogue entries and keep physical stock in sync with the system of record.</p>
          </div>
        </div>
        {feedback && (
          <div className={`banner banner--${feedback.type === 'error' ? 'danger' : 'info'}`}>
            {feedback.message}
          </div>
        )}
        <div className="grid split">
          <form className="form-grid" onSubmit={handleCreateProduct}>
            <h3>Create product</h3>
            <label className="field">
              <span>SKU</span>
              <input
                value={productForm.sku}
                onChange={(e) => setProductForm((prev) => ({ ...prev, sku: e.target.value }))}
                placeholder="Ex. BATT-IPHONE"
                required
              />
            </label>
            <label className="field">
              <span>Name</span>
              <input
                value={productForm.name}
                onChange={(e) => setProductForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="iPhone Battery"
                required
              />
            </label>
            <label className="field">
              <span>Reorder point</span>
              <input
                type="number"
                min="0"
                value={productForm.reorder_point}
                onChange={(e) => setProductForm((prev) => ({ ...prev, reorder_point: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Lead time (days)</span>
              <input
                type="number"
                min="0"
                value={productForm.lead_time_days}
                onChange={(e) => setProductForm((prev) => ({ ...prev, lead_time_days: e.target.value }))}
              />
            </label>
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={productForm.track_serial}
                onChange={(e) => setProductForm((prev) => ({ ...prev, track_serial: e.target.checked }))}
              />
              <span>Track serial numbers for this product</span>
            </label>
            <div className="form-actions">
              <button className="button button--primary" type="submit" disabled={createProduct.isLoading}>
                {createProduct.isLoading ? 'Creating…' : 'Add product'}
              </button>
            </div>
          </form>

          <form className="form-grid" onSubmit={handleAdjustStock}>
            <h3>Adjust stock</h3>
            <label className="field">
              <span>Product</span>
              <select
                value={adjustForm.product_id}
                onChange={(e) => handleProductSelect(e.target.value)}
                required
              >
                <option value="" disabled>Select product</option>
                {productOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {option.sku}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Bin</span>
              <select
                value={adjustForm.bin_id}
                onChange={(e) => setAdjustForm((prev) => ({ ...prev, bin_id: e.target.value }))}
                required
                disabled={!hasBinsAvailable}
              >
                {hasBinsAvailable ? null : <option value="">No bins available</option>}
                {binsForSelection.map((bin) => (
                  <option key={bin.id} value={bin.id}>
                    {bin.code}{bin.location ? ` · ${bin.location}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Quantity</span>
              <input
                type="number"
                min="1"
                value={adjustForm.qty}
                onChange={(e) => setAdjustForm((prev) => ({ ...prev, qty: e.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Action</span>
              <select
                value={adjustForm.direction}
                onChange={(e) => setAdjustForm((prev) => ({ ...prev, direction: e.target.value }))}
              >
                <option value="increase">Increase on-hand quantity</option>
                <option value="decrease">Decrease on-hand quantity</option>
              </select>
            </label>
            <p className="muted field--span">
              Adjustments will be logged with your user account and reflected in dashboards instantly.
            </p>
            <div className="form-actions">
              <button className="button button--primary" type="submit" disabled={adjustStock.isLoading || !hasBinsAvailable}>
                {adjustStock.isLoading ? 'Applying…' : 'Update stock'}
              </button>
            </div>
          </form>
        </div>
      </div>

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
              {filteredProducts.map((row) => (
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
