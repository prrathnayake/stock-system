import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../providers/AuthProvider.jsx'
import StockHistoryChart from '../components/StockHistoryChart.jsx'

const initialProductForm = {
  sku: '',
  name: '',
  uom: 'ea',
  reorder_point: '5',
  lead_time_days: '0',
  unit_price: '0',
  track_serial: false,
  on_hand: '0',
  reserved: '0'
}

const initialAdjustmentForm = {
  product_id: '',
  bin_id: '',
  qty: '',
  direction: 'increase'
}

export default function Inventory() {
  const { user, organization } = useAuth()
  const canManageProcurement = ['admin', 'user'].includes(user?.role)
  const [query, setQuery] = useState('')
  const [productForm, setProductForm] = useState(initialProductForm)
  const [adjustForm, setAdjustForm] = useState(initialAdjustmentForm)
  const [feedback, setFeedback] = useState(null)
  const [binFeedback, setBinFeedback] = useState(null)
  const [selectedProductId, setSelectedProductId] = useState(null)
  const [editingProduct, setEditingProduct] = useState(null)
  const [editForm, setEditForm] = useState(initialProductForm)
  const [binForm, setBinForm] = useState({ code: '', site: '', room: '' })
  const [activeSection, setActiveSection] = useState('stock')

  const queryClient = useQueryClient()

  const currencyCode = (organization?.currency || user?.organization?.currency || 'AUD').toUpperCase()
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('en-AU', { style: 'currency', currency: currencyCode }),
    [currencyCode]
  )

  const stockQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data } = await api.get('/stock')
      return data
    }
  })
  const stock = stockQuery.data ?? []
  const { isFetching, refetch } = stockQuery

  const serialsQuery = useQuery({
    queryKey: ['serials'],
    queryFn: async () => {
      const { data } = await api.get('/serials')
      return data
    }
  })
  const serials = serialsQuery.data ?? []

  const purchaseOrdersQuery = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/purchase-orders')
      return data
    },
    enabled: canManageProcurement
  })
  const purchaseOrders = purchaseOrdersQuery.data ?? []

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/suppliers')
      return data
    },
    enabled: canManageProcurement
  })
  const suppliers = suppliersQuery.data ?? []

  const rmaQuery = useQuery({
    queryKey: ['rma-cases'],
    queryFn: async () => {
      const { data } = await api.get('/rma')
      return data
    },
    enabled: canManageProcurement
  })
  const rmaCases = rmaQuery.data ?? []

  const binsQuery = useQuery({
    queryKey: ['bins'],
    queryFn: async () => {
      const { data } = await api.get('/bins')
      return data
    }
  })
  const bins = binsQuery.data ?? []

  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data } = await api.get('/products')
      return data
    }
  })
  const products = productsQuery.data ?? []

  const productMetaMap = useMemo(() => {
    const map = new Map()
    products.forEach((item) => {
      map.set(item.id, { ...item, unit_price: Number(item.unit_price ?? 0) })
    })
    return map
  }, [products])

  const filteredProducts = useMemo(() => {
    if (!query) return stock
    const term = query.toLowerCase()
    return stock.filter((row) =>
      row.sku.toLowerCase().includes(term) || row.name.toLowerCase().includes(term)
    )
  }, [stock, query])

  const enrichedProducts = useMemo(() => (
    filteredProducts.map((row) => {
      const meta = productMetaMap.get(row.id)
      return {
        ...row,
        uom: meta?.uom ?? row.uom ?? 'ea',
        track_serial: meta?.track_serial ?? row.track_serial ?? false,
        reorder_point: meta?.reorder_point ?? row.reorder_point ?? 0,
        lead_time_days: meta?.lead_time_days ?? row.lead_time_days ?? 0,
        unit_price: Number(meta?.unit_price ?? 0)
      }
    })
  ), [filteredProducts, productMetaMap])

  useEffect(() => {
    if (!enrichedProducts.length) {
      setSelectedProductId(null)
      return
    }
    const exists = enrichedProducts.some((row) => String(row.id) === selectedProductId)
    if (!exists) {
      setSelectedProductId(String(enrichedProducts[0].id))
    }
  }, [enrichedProducts, selectedProductId])

  const selectedProduct = useMemo(
    () => enrichedProducts.find((row) => String(row.id) === String(selectedProductId)) ?? null,
    [enrichedProducts, selectedProductId]
  )

  const overviewStats = useMemo(() => {
    const onHandTotal = stock.reduce((acc, row) => acc + row.on_hand, 0)
    const availableTotal = stock.reduce((acc, row) => acc + row.available, 0)
    const reorderRisk = stock.filter((row) => row.available <= (row.reorder_point ?? 0)).length
    const trackedSerials = products.filter((product) => product.track_serial).length
    return {
      skuCount: stock.length,
      onHandTotal,
      availableTotal,
      reorderRisk,
      trackedSerials
    }
  }, [stock, products])

  const lowStock = useMemo(
    () => stock.filter((row) => row.available <= (row.reorder_point ?? 0)),
    [stock]
  )

  const allBins = useMemo(() => {
    const map = new Map()
    bins.forEach((bin) => {
      map.set(bin.id, {
        id: bin.id,
        code: bin.code,
        location: bin.location?.site || null
      })
    })
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
  }, [bins, stock])

  const binOverview = useMemo(() => {
    const map = new Map()
    bins.forEach((bin) => {
      const locationParts = []
      if (bin.location?.site) locationParts.push(bin.location.site)
      if (bin.location?.room) locationParts.push(bin.location.room)
      map.set(bin.id, {
        id: bin.id,
        code: bin.code,
        location: locationParts.join(' · '),
        productCount: 0,
        onHand: 0,
        available: 0
      })
    })
    stock.forEach((product) => {
      product.bins.forEach((bin) => {
        const id = bin.bin_id
        if (!map.has(id)) {
          map.set(id, {
            id,
            code: bin.bin_code,
            location: bin.location || '',
            productCount: 0,
            onHand: 0,
            available: 0
          })
        }
        const entry = map.get(id)
        entry.productCount += 1
        const onHand = Number(bin.on_hand || 0)
        const reserved = Number(bin.reserved || 0)
        entry.onHand += onHand
        entry.available += Math.max(0, onHand - reserved)
      })
    })
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
  }, [bins, stock])

  const productForAdjustment = useMemo(
    () => stock.find((item) => String(item.id) === adjustForm.product_id) || null,
    [stock, adjustForm.product_id]
  )

  const binsForSelection = useMemo(() => {
    if (productForAdjustment && productForAdjustment.bins.length > 0) {
      return productForAdjustment.bins.map((bin) => ({
        id: bin.bin_id,
        code: bin.bin_code,
        location: bin.location
      }))
    }
    return allBins
  }, [productForAdjustment, allBins])

  const hasBinsAvailable = binsForSelection.length > 0

  const historyQuery = useQuery({
    queryKey: ['stock-history', selectedProductId],
    queryFn: async () => {
      const { data } = await api.get(`/stock/${selectedProductId}/history`)
      return data
    },
    enabled: Boolean(selectedProductId)
  })

  const historyPoints = historyQuery.data?.datapoints ?? []
  const historySummary = historyQuery.data?.summary ?? null

  const productOptions = useMemo(
    () => stock.map((row) => ({ id: row.id, name: row.name, sku: row.sku })),
    [stock]
  )

  const latestSerials = serials.slice(0, 8)
  const openPurchaseOrders = purchaseOrders.slice(0, 5)
  const openRmas = rmaCases.slice(0, 5)

  const createProduct = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/products', payload)
      return data
    }
  })

  const updateProduct = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.patch(`/products/${id}`, payload)
      return data
    }
  })

  const updateStockLevels = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.patch(`/stock/${id}/levels`, payload)
      return data
    }
  })

  const removeProduct = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/products/${id}`)
      return true
    }
  })

  const adjustStock = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/stock/move', payload)
      return data
    }
  })

  const createBin = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/bins', payload)
      return data
    }
  })

  const handleCreateProduct = (event) => {
    event.preventDefault()
    setFeedback(null)
    const payload = {
      sku: productForm.sku.trim(),
      name: productForm.name.trim(),
      uom: productForm.uom.trim() || 'ea',
      reorder_point: Number(productForm.reorder_point) || 0,
      lead_time_days: Number(productForm.lead_time_days) || 0,
      unit_price: Math.max(0, Number(productForm.unit_price) || 0),
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
        productsQuery.refetch()
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
    setSelectedProductId(value || null)
  }

  const handleCreateBin = (event) => {
    event.preventDefault()
    setBinFeedback(null)
    const code = binForm.code.trim()
    if (!code) {
      setBinFeedback({ type: 'error', message: 'Bin code is required.' })
      return
    }
    const payload = { code }
    const site = binForm.site.trim()
    const room = binForm.room.trim()
    if (site) {
      payload.location = { site }
      if (room) {
        payload.location.room = room
      }
    }
    createBin.mutate(payload, {
      onSuccess: () => {
        setBinFeedback({ type: 'success', message: 'Bin created successfully.' })
        setBinForm({ code: '', site: '', room: '' })
        queryClient.invalidateQueries({ queryKey: ['bins'] })
        refetch()
      },
      onError: (error) => {
        setBinFeedback({
          type: 'error',
          message: error.response?.data?.error || 'Unable to create bin right now.'
        })
      }
    })
  }

  const openEdit = (product) => {
    const meta = productMetaMap.get(product.id) || product
    setEditingProduct({
      id: product.id,
      name: meta.name ?? product.name ?? '',
      sku: meta.sku ?? product.sku ?? '',
      uom: meta.uom ?? product.uom ?? 'ea',
      reorder_point: Number(meta.reorder_point ?? product.reorder_point ?? 0),
      lead_time_days: Number(meta.lead_time_days ?? product.lead_time_days ?? 0),
      unit_price: Number(meta.unit_price ?? product.unit_price ?? 0),
      track_serial: Boolean(meta.track_serial ?? product.track_serial ?? false),
      on_hand: Number(product.on_hand ?? 0),
      reserved: Number(product.reserved ?? 0)
    })
    setEditForm({
      sku: meta.sku ?? product.sku ?? '',
      name: meta.name ?? product.name ?? '',
      uom: meta.uom ?? product.uom ?? 'ea',
      reorder_point: String(meta.reorder_point ?? product.reorder_point ?? 0),
      lead_time_days: String(meta.lead_time_days ?? product.lead_time_days ?? 0),
      unit_price: String(meta.unit_price ?? product.unit_price ?? 0),
      track_serial: Boolean(meta.track_serial ?? product.track_serial ?? false),
      on_hand: String(product.on_hand ?? 0),
      reserved: String(product.reserved ?? 0)
    })
  }

  const closeEdit = () => {
    setEditingProduct(null)
    setEditForm(initialProductForm)
  }

  const handleUpdateProduct = async (event) => {
    event.preventDefault()
    if (!editingProduct) return

    setFeedback(null)

    const sku = editForm.sku.trim()
    const name = editForm.name.trim()
    const uom = editForm.uom.trim() || 'ea'
    const reorderPoint = Math.max(0, Number(editForm.reorder_point) || 0)
    const leadTime = Math.max(0, Number(editForm.lead_time_days) || 0)
    const unitPrice = Math.max(0, Number(editForm.unit_price) || 0)
    const trackSerial = Boolean(editForm.track_serial)
    const desiredOnHand = Math.max(0, Number(editForm.on_hand) || 0)
    const desiredReserved = Math.max(0, Number(editForm.reserved) || 0)

    if (!sku || !name) {
      setFeedback({ type: 'error', message: 'SKU and product name are required.' })
      return
    }
    if (desiredReserved > desiredOnHand) {
      setFeedback({ type: 'error', message: 'Reserved stock cannot exceed on-hand quantity.' })
      return
    }

    const productPayload = {}
    if (sku !== editingProduct.sku) productPayload.sku = sku
    if (name !== editingProduct.name) productPayload.name = name
    if (uom !== editingProduct.uom) productPayload.uom = uom
    if (reorderPoint !== editingProduct.reorder_point) productPayload.reorder_point = reorderPoint
    if (leadTime !== editingProduct.lead_time_days) productPayload.lead_time_days = leadTime
    if (unitPrice !== editingProduct.unit_price) productPayload.unit_price = unitPrice
    if (trackSerial !== editingProduct.track_serial) productPayload.track_serial = trackSerial

    const stockPayload = {}
    if (desiredOnHand !== editingProduct.on_hand) stockPayload.on_hand = desiredOnHand
    if (desiredReserved !== editingProduct.reserved) stockPayload.reserved = desiredReserved

    if (Object.keys(productPayload).length === 0 && Object.keys(stockPayload).length === 0) {
      setFeedback({ type: 'info', message: 'No changes detected for this product.' })
      return
    }

    try {
      if (Object.keys(productPayload).length > 0) {
        await updateProduct.mutateAsync({ id: editingProduct.id, payload: productPayload })
      }
      if (Object.keys(stockPayload).length > 0) {
        await updateStockLevels.mutateAsync({ id: editingProduct.id, payload: stockPayload })
      }
      setFeedback({ type: 'success', message: 'Product updated successfully.' })
      closeEdit()
      refetch()
      productsQuery.refetch()
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error.response?.data?.error || 'Unable to update this product.'
      })
    }
  }

  const handleRemoveProduct = (product) => {
    if (!product) return
    const confirmed = window.confirm(`Remove ${product.name}? This will zero out its stock levels.`)
    if (!confirmed) return
    setFeedback(null)
    removeProduct.mutate(product.id, {
      onSuccess: () => {
        setFeedback({ type: 'success', message: `${product.name} was archived and stock cleared.` })
        if (String(product.id) === String(selectedProductId)) {
          setSelectedProductId(null)
        }
        if (String(product.id) === adjustForm.product_id) {
          setAdjustForm(initialAdjustmentForm)
        }
        refetch()
        productsQuery.refetch()
      },
      onError: (error) => {
        setFeedback({
          type: 'error',
          message: error.response?.data?.error || 'Unable to remove this product.'
        })
      }
    })
  }

  const actionDisabled =
    createProduct.isLoading ||
    updateProduct.isLoading ||
    updateStockLevels.isLoading ||
    removeProduct.isLoading
  const savingProduct = updateProduct.isLoading || updateStockLevels.isLoading
  const isStockView = activeSection === 'stock'
  const isBinsView = activeSection === 'bins'

  return (
    <div className="page inventory">
      <div className="subnav" role="tablist" aria-label="Inventory sections">
        <button
          id="inventory-stock-tab"
          type="button"
          role="tab"
          aria-controls="inventory-stock-panel"
          aria-selected={isStockView}
          tabIndex={isStockView ? 0 : -1}
          className={`subnav__item${isStockView ? ' subnav__item--active' : ''}`}
          onClick={() => setActiveSection('stock')}
        >
          Active stock
        </button>
        <button
          id="inventory-bins-tab"
          type="button"
          role="tab"
          aria-controls="inventory-bins-panel"
          aria-selected={isBinsView}
          tabIndex={isBinsView ? 0 : -1}
          className={`subnav__item${isBinsView ? ' subnav__item--active' : ''}`}
          onClick={() => setActiveSection('bins')}
        >
          Storage bins
        </button>
      </div>

      {isStockView && (
        <section
          id="inventory-stock-panel"
          role="tabpanel"
          aria-labelledby="inventory-stock-tab"
          className="inventory__panel"
        >
          <div className="card inventory__header">
            <div>
              <h2>Inventory control center</h2>
              <p className="muted">Search, curate and adjust your catalogue with real-time visibility into stock health.</p>
            </div>
            <div className="inventory__header-actions">
              <button className="button" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {feedback && (
            <div className={`banner banner--${feedback.type === 'error' ? 'danger' : 'info'}`}>
              {feedback.message}
            </div>
          )}

          <div className="grid stats">
        <div className="stat-card card">
          <p className="muted">Active SKUs</p>
          <h2>{overviewStats.skuCount}</h2>
          <p className="stat-card__hint">Total live items across the organisation.</p>
        </div>
        <div className="stat-card card">
          <p className="muted">On-hand units</p>
          <h2>{overviewStats.onHandTotal}</h2>
          <p className="stat-card__hint">All bins summed together.</p>
        </div>
        <div className="stat-card card">
          <p className="muted">Available to promise</p>
          <h2>{overviewStats.availableTotal}</h2>
          <p className="stat-card__hint">On hand minus reserved commitments.</p>
        </div>
        <div className="stat-card card">
          <p className="muted">Reorder alerts</p>
          <h2>{overviewStats.reorderRisk}</h2>
          <p className="stat-card__hint">Products at or below their reorder point.</p>
        </div>
        <div className="stat-card card">
          <p className="muted">Tracked serial SKUs</p>
          <h2>{overviewStats.trackedSerials}</h2>
          <p className="stat-card__hint">Items with serial level traceability.</p>
        </div>
      </div>

          <div className="inventory__layout">
        <div className="card inventory__table-card">
          <div className="inventory__table-header">
            <div>
              <h3>Catalogue</h3>
              <p className="muted">Click a row to reveal bin allocations and action shortcuts.</p>
            </div>
            <div className="inventory__table-controls">
              <label className="field" data-help="Filter the catalogue by SKU or product name.">
                <span>Search catalogue</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by SKU or product name"
                />
              </label>
            </div>
          </div>
          <table className="table inventory-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Bins</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Unit price</th>
                <th>Reorder point</th>
                <th>Lead time (days)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {enrichedProducts.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    {query ? 'No products match your search.' : 'No products found. Try adjusting your filters or add a new item.'}
                  </td>
                </tr>
              )}
              {enrichedProducts.map((product) => (
                <React.Fragment key={product.id}>
                  <tr
                    className={`inventory-table__row${String(product.id) === String(selectedProductId) ? ' inventory-table__row--active' : ''}`}
                    onClick={() => setSelectedProductId(String(product.id))}
                  >
                    <td><span className="badge">{product.sku}</span></td>
                    <td>{product.name}</td>
                    <td>
                      {product.bins.length === 0 ? (
                        <span className="muted">No bins</span>
                      ) : (
                        <div
                          className="inventory-table__bins-cell"
                          title={product.bins.map((bin) => {
                            const location = bin.location ? ` · ${bin.location}` : ''
                            const available = (bin.on_hand - (bin.reserved ?? 0))
                            return `${bin.bin_code}${location}: ${available} available`
                          }).join('\n')}
                        >
                          {product.bins.slice(0, 2).map((bin) => (
                            <span key={bin.bin_id} className="badge badge--muted inventory-table__bin-pill">
                              {bin.bin_code}{bin.location ? ` · ${bin.location}` : ''}
                            </span>
                          ))}
                          {product.bins.length > 2 && (
                            <span className="muted">+{product.bins.length - 2} more</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{product.on_hand}</td>
                    <td>{product.reserved}</td>
                    <td>{product.available}</td>
                    <td>{currencyFormatter.format(Number(product.unit_price) || 0)}</td>
                    <td>{product.reorder_point}</td>
                    <td>{product.lead_time_days}</td>
                    <td>
                      <div className="table__actions">
                        <button
                          className="button button--small"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEdit(product)
                          }}
                          disabled={actionDisabled}
                        >
                          Update
                        </button>
                        <button
                          className="button button--small button--danger"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            handleRemoveProduct(product)
                          }}
                          disabled={removeProduct.isLoading}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                  {String(product.id) === String(selectedProductId) && (
                    <tr className="inventory-table__details">
                      <td colSpan={10}>
                        <div className="inventory-detail">
                          <div>
                            <p className="inventory-detail__label">Unit of measure</p>
                            <p className="inventory-detail__value">{product.uom.toUpperCase()}</p>
                          </div>
                          <div>
                            <p className="inventory-detail__label">Serial tracking</p>
                            <p className="inventory-detail__value">{product.track_serial ? 'Enabled' : 'Disabled'}</p>
                          </div>
                          <div>
                            <p className="inventory-detail__label">Unit price</p>
                            <p className="inventory-detail__value">{currencyFormatter.format(Number(product.unit_price) || 0)}</p>
                          </div>
                          <div className="inventory-detail__bins">
                            <p className="inventory-detail__label">Bin allocations</p>
                            <ul>
                              {product.bins.length === 0 && <li>No bin assignments yet.</li>}
                              {product.bins.map((bin) => (
                                <li key={bin.bin_id}>
                                  <span>{bin.bin_code}</span>
                                  <span>{bin.location ? ` · ${bin.location}` : ''}</span>
                                  <span className="inventory-detail__bin-qty">{bin.on_hand} on hand</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="inventory__aside">
          <div className="card inventory__history-card">
            <div className="inventory__history-header">
              <div>
                <h3>Stock history</h3>
                <p className="muted">Visualise adjustments and movements over time.</p>
              </div>
              {historySummary && (
                <span className="badge badge--muted">{historySummary.totalMoves} movements</span>
              )}
            </div>
            {historyQuery.isFetching ? (
              <p className="muted">Loading history…</p>
            ) : (
              <>
                <StockHistoryChart points={historyPoints} height={220} />
                <ul className="timeline inventory__history-timeline">
                  {historyPoints.length === 0 && <li className="muted">No stock movements recorded for this product yet.</li>}
                  {[...historyPoints].reverse().slice(0, 6).map((entry) => (
                    <li key={entry.id}>
                      <div className="timeline__title">{entry.reason} · {entry.qty} units</div>
                      <div className="timeline__meta">
                        {new Date(entry.occurredAt).toLocaleString()} · Level {entry.level}
                        {entry.performedBy ? ` · by ${entry.performedBy}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {selectedProduct && (
            <div className="card inventory__summary-card">
              <h3>{selectedProduct.name}</h3>
              <p className="muted">SKU {selectedProduct.sku}</p>
              <div className="inventory__summary-grid">
                <div>
                  <p className="inventory-detail__label">Available</p>
                  <p className="inventory-detail__value">{selectedProduct.available}</p>
                </div>
                <div>
                  <p className="inventory-detail__label">On hand</p>
                  <p className="inventory-detail__value">{selectedProduct.on_hand}</p>
                </div>
                <div>
                  <p className="inventory-detail__label">Reserved</p>
                  <p className="inventory-detail__value">{selectedProduct.reserved}</p>
                </div>
                <div>
                  <p className="inventory-detail__label">Reorder point</p>
                  <p className="inventory-detail__value">{selectedProduct.reorder_point}</p>
                </div>
                <div>
                  <p className="inventory-detail__label">Lead time</p>
                  <p className="inventory-detail__value">{selectedProduct.lead_time_days} days</p>
                </div>
                <div>
                  <p className="inventory-detail__label">Tracked serials</p>
                  <p className="inventory-detail__value">{selectedProduct.track_serial ? 'Yes' : 'No'}</p>
                </div>
              </div>
              {historySummary && (
                <p className="muted inventory__summary-footer">Last movement on {new Date(historySummary.lastUpdated).toLocaleString()}.</p>
              )}
            </div>
          )}
        </aside>
          </div>

          <div className="inventory__forms">
            <form className="card form-grid" onSubmit={handleCreateProduct}>
              <h3>Create product</h3>
          <label className="field" data-help="Unique identifier used for scanning, search and integrations.">
            <span>SKU</span>
            <input
              value={productForm.sku}
              onChange={(e) => setProductForm((prev) => ({ ...prev, sku: e.target.value }))}
              placeholder="Ex. BATT-IPHONE"
              required
            />
          </label>
          <label className="field" data-help="Descriptive name your team recognises on pick lists and invoices.">
            <span>Name</span>
            <input
              value={productForm.name}
              onChange={(e) => setProductForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="iPhone Battery"
              required
            />
          </label>
          <label className="field" data-help="Base unit for tracking this item (e.g. each, box, pack).">
            <span>Unit of measure</span>
            <input
              value={productForm.uom}
              onChange={(e) => setProductForm((prev) => ({ ...prev, uom: e.target.value }))}
              placeholder="ea"
            />
          </label>
          <label className="field" data-help="Quantity at which replenishment reminders should trigger.">
            <span>Reorder point</span>
            <input
              type="number"
              min="0"
              value={productForm.reorder_point}
              onChange={(e) => setProductForm((prev) => ({ ...prev, reorder_point: e.target.value }))}
            />
          </label>
          <label className="field" data-help="Average supplier lead time in days.">
            <span>Lead time (days)</span>
            <input
              type="number"
              min="0"
              value={productForm.lead_time_days}
              onChange={(e) => setProductForm((prev) => ({ ...prev, lead_time_days: e.target.value }))}
            />
          </label>
          <label className="field" data-help="Default price applied when adding this product to invoices.">
            <span>Unit price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={productForm.unit_price}
              onChange={(e) => setProductForm((prev) => ({ ...prev, unit_price: e.target.value }))}
              placeholder={`e.g. ${currencyFormatter.format(99.95)}`}
            />
            <small className="muted">Stored in {currencyCode}.</small>
          </label>
          <label className="field field--checkbox" data-help="Track individual serial numbers for warranty or traceability.">
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

            <form className="card form-grid" onSubmit={handleAdjustStock}>
              <h3>Adjust stock</h3>
          <label className="field" data-help="Select the item that requires a stock adjustment.">
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
          <label className="field" data-help="Bin location receiving or issuing the stock movement.">
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
          <label className="field" data-help="Number of units being moved in this adjustment.">
            <span>Quantity</span>
            <input
              type="number"
              min="1"
              value={adjustForm.qty}
              onChange={(e) => setAdjustForm((prev) => ({ ...prev, qty: e.target.value }))}
              required
            />
          </label>
          <label className="field" data-help="Choose whether inventory is being added or removed.">
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

          <div className="inventory__insights">
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

        <div className="card">
          <h3>Serialised inventory</h3>
          <p className="muted">Most recent serial numbers registered in the system.</p>
          <div className="table-scroll">
            <table className="table table--compact">
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

        <div className="card">
          <h3>Purchase orders</h3>
          <p className="muted">Open procurement activity awaiting receipt.</p>
          {canManageProcurement ? (
            <div className="table-scroll">
              <table className="table table--compact">
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
            </div>
          ) : (
            <p className="muted">Purchase orders are available to inventory coordinators.</p>
          )}
        </div>

        <div className="card">
          <h3>RMA cases</h3>
          <p className="muted">Returns and credits awaiting supplier resolution.</p>
          {canManageProcurement ? (
            <div className="table-scroll">
              <table className="table table--compact">
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
            </div>
          ) : (
            <p className="muted">RMA tracking is reserved for inventory leads.</p>
          )}
        </div>
          </div>
        </section>
      )}

      {isBinsView && (
        <section
          id="inventory-bins-panel"
          role="tabpanel"
          aria-labelledby="inventory-bins-tab"
          className="inventory__panel"
        >
          <div className="card inventory__header">
            <div>
              <h2>Storage locations</h2>
              <p className="muted">Create bins and review how stock is distributed across the floor.</p>
            </div>
            <div className="inventory__header-actions">
              <button
                className="button"
                type="button"
                onClick={() => {
                  binsQuery.refetch()
                  refetch()
                }}
                disabled={binsQuery.isFetching || isFetching}
              >
                {binsQuery.isFetching || isFetching ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          <div className="grid split inventory__bins-view">
            <form className="card form-grid" onSubmit={handleCreateBin}>
              <h3>Create storage bin</h3>
              {binFeedback && (
                <div className={`banner banner--${binFeedback.type === 'error' ? 'danger' : 'info'}`}>
                  {binFeedback.message}
                </div>
              )}
              <label className="field" data-help="Unique identifier used when allocating or picking stock.">
                <span>Bin code</span>
                <input
                  value={binForm.code}
                  onChange={(e) => setBinForm((prev) => ({ ...prev, code: e.target.value }))}
                  placeholder="e.g. A-01"
                  required
                />
              </label>
              <label className="field" data-help="Optional location name to help your team locate the bin.">
                <span>Location</span>
                <input
                  value={binForm.site}
                  onChange={(e) => setBinForm((prev) => ({ ...prev, site: e.target.value }))}
                  placeholder="Main warehouse"
                />
              </label>
              <label className="field" data-help="Optional zone, aisle or room information.">
                <span>Room / area</span>
                <input
                  value={binForm.room}
                  onChange={(e) => setBinForm((prev) => ({ ...prev, room: e.target.value }))}
                  placeholder="Aisle 3"
                />
              </label>
              <p className="muted field--span">Bins can be assigned to products later from the stock adjustment tools.</p>
              <div className="form-actions">
                <button className="button button--primary" type="submit" disabled={createBin.isLoading}>
                  {createBin.isLoading ? 'Creating…' : 'Create bin'}
                </button>
              </div>
            </form>

            <section className="card inventory__bins-table">
              <header className="card__header">
                <div>
                  <h3>Registered bins</h3>
                  <p className="muted">Overview of storage locations and current stock assignments.</p>
                </div>
                <span className="badge badge--muted">{binOverview.length} locations</span>
              </header>
              <div className="table-scroll">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>Bin</th>
                      <th>Location</th>
                      <th>Products</th>
                      <th>On hand</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {binOverview.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">No bins recorded yet.</td>
                      </tr>
                    ) : (
                      binOverview.map((bin) => (
                        <tr key={bin.id}>
                          <td><span className="badge">{bin.code}</span></td>
                          <td>{bin.location || '—'}</td>
                          <td>{bin.productCount}</td>
                          <td>{bin.onHand}</td>
                          <td>{bin.available}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      )}

      {editingProduct && (
        <div className="inventory__modal" role="dialog" aria-modal="true">
          <div className="inventory__modal-content card">
            <div className="inventory__modal-header">
              <div>
                <h3>Edit product</h3>
                <p className="muted">Update catalogue details for {editingProduct.name}.</p>
              </div>
              <button className="button button--ghost" type="button" onClick={closeEdit}>
                Close
              </button>
            </div>
            <form className="form-grid" onSubmit={handleUpdateProduct}>
              <label className="field" data-help="Update the product's unique identifier.">
                <span>SKU</span>
                <input
                  value={editForm.sku}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, sku: e.target.value }))}
                  required
                />
              </label>
              <label className="field" data-help="Friendly name used across the app and exports.">
                <span>Name</span>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>
              <label className="field" data-help="Measurement unit for this item.">
                <span>Unit of measure</span>
                <input
                  value={editForm.uom}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, uom: e.target.value }))}
                />
              </label>
              <label className="field" data-help="Stock threshold that triggers reorder workflows.">
                <span>Reorder point</span>
                <input
                  type="number"
                  min="0"
                  value={editForm.reorder_point}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, reorder_point: e.target.value }))}
                />
              </label>
              <label className="field" data-help="Current supplier lead time in days.">
                <span>Lead time (days)</span>
                <input
                  type="number"
                  min="0"
                  value={editForm.lead_time_days}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, lead_time_days: e.target.value }))}
                />
              </label>
              <label className="field" data-help="Default price applied to invoices for this product.">
                <span>Unit price</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.unit_price}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, unit_price: e.target.value }))}
                />
                <small className="muted">Stored in {currencyCode}.</small>
              </label>
              <label className="field" data-help="Adjust the total quantity on hand across all bins.">
                <span>On-hand quantity</span>
                <input
                  type="number"
                  min="0"
                  value={editForm.on_hand}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, on_hand: e.target.value }))}
                />
              </label>
              <label className="field" data-help="Reserved units are committed to orders or work orders.">
                <span>Reserved quantity</span>
                <input
                  type="number"
                  min="0"
                  value={editForm.reserved}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, reserved: e.target.value }))}
                />
                <small className="muted">Reserved stock cannot exceed on-hand quantity.</small>
              </label>
              <label className="field field--checkbox" data-help="Keep serial tracking enabled for warranty traceability.">
                <input
                  type="checkbox"
                  checked={editForm.track_serial}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, track_serial: e.target.checked }))}
                />
                <span>Track serial numbers for this product</span>
              </label>
              <div className="form-actions">
                <button className="button" type="button" onClick={closeEdit} disabled={savingProduct}>Cancel</button>
                <button className="button button--primary" type="submit" disabled={savingProduct}>
                  {savingProduct ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
