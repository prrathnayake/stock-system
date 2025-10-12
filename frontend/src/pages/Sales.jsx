import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import TablePagination from '../components/TablePagination.jsx'

const createEmptyCustomerForm = () => ({
  name: '',
  company: '',
  email: '',
  phone: '',
  address: '',
  notes: ''
})

const createEmptySaleForm = () => ({
  customer_id: '',
  reference: '',
  notes: '',
  items: [
    { product_id: '', quantity: 1 }
  ]
})

function Banner({ banner, onClose }) {
  if (!banner) return null
  return (
    <div className={`banner banner--${banner.type || 'info'}`}>
      <span>{banner.message}</span>
      <button type="button" onClick={onClose} className="button button--ghost">Dismiss</button>
    </div>
  )
}

export default function Sales() {
  const queryClient = useQueryClient()
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerForm, setCustomerForm] = useState(createEmptyCustomerForm)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [customerBanner, setCustomerBanner] = useState(null)

  const [saleStatus, setSaleStatus] = useState('')
  const [saleForm, setSaleForm] = useState(createEmptySaleForm)
  const [saleBanner, setSaleBanner] = useState(null)
  const [customerPage, setCustomerPage] = useState(1)
  const [salePage, setSalePage] = useState(1)
  const [activeSection, setActiveSection] = useState('sales')
  const [activeSale, setActiveSale] = useState(null)
  const [saleDetailForm, setSaleDetailForm] = useState({ reference: '', notes: '', customer_id: '' })
  const [saleDetailBanner, setSaleDetailBanner] = useState(null)
  const [saleDetailLoading, setSaleDetailLoading] = useState(false)
  const saleDetailsLocked = activeSale ? ['complete', 'canceled'].includes(activeSale.status) : false

  useEffect(() => {
    if (saleDetailsLocked && activeSale && !saleDetailBanner) {
      setSaleDetailBanner({ type: 'info', message: 'This sale is locked because it has been completed or canceled.' })
    }
    if (!saleDetailsLocked && saleDetailBanner?.type === 'info' && saleDetailBanner.message.includes('locked')) {
      setSaleDetailBanner(null)
    }
  }, [saleDetailsLocked, activeSale?.id, saleDetailBanner])

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ['customers', customerSearch],
    queryFn: async () => {
      const params = customerSearch ? { q: customerSearch } : undefined
      const { data } = await api.get('/customers', { params })
      return data
    }
  })

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data } = await api.get('/products')
      return data.filter((product) => product.active !== false)
    }
  })

  const { data: sales = [], isFetching: loadingSales } = useQuery({
    queryKey: ['sales', saleStatus],
    queryFn: async () => {
      const params = saleStatus ? { status: saleStatus } : undefined
      const { data } = await api.get('/sales', { params })
      return data
    }
  })

  const productMap = useMemo(() => {
    const map = {}
    products.forEach((product) => {
      map[product.id] = product
    })
    return map
  }, [products])

  const saleItems = saleForm.items
  const selectedCustomer = customers.find((customer) => String(customer.id) === String(saleForm.customer_id)) || null
  const saleCustomerOptions = useMemo(() => {
    const map = new Map()
    customers.forEach((customer) => {
      const label = customer.name || customer.company || customer.email || `Customer #${customer.id}`
      map.set(String(customer.id), label)
    })
    if (activeSale?.customer) {
      const id = String(activeSale.customer.id)
      if (!map.has(id)) {
        const label = activeSale.customer.name || activeSale.customer.company || activeSale.customer.email || `Customer #${activeSale.customer.id}`
        map.set(id, label)
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }))
  }, [customers, activeSale?.customer])

  const PAGE_SIZE = 10

  const customerTotalPages = Math.max(1, Math.ceil(customers.length / PAGE_SIZE))
  const visibleCustomers = useMemo(() => {
    const start = (customerPage - 1) * PAGE_SIZE
    return customers.slice(start, start + PAGE_SIZE)
  }, [customers, customerPage])

  useEffect(() => {
    setCustomerPage(1)
  }, [customerSearch])

  useEffect(() => {
    if (customerPage > customerTotalPages) {
      setCustomerPage(customerTotalPages)
    }
  }, [customerPage, customerTotalPages])

  const resetCustomerForm = () => {
    setCustomerForm(createEmptyCustomerForm())
    setEditingCustomer(null)
  }

  const createCustomerMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/customers', payload)
      return data
    },
    onSuccess: (created) => {
      setCustomerBanner({ type: 'success', message: `Customer ${created.name} added.` })
      resetCustomerForm()
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (error) => {
      setCustomerBanner({ type: 'error', message: error.response?.data?.error || 'Unable to add customer.' })
    }
  })

  const updateCustomerMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.put(`/customers/${id}`, payload)
      return data
    },
    onSuccess: (updated) => {
      setCustomerBanner({ type: 'success', message: `Customer ${updated.name} updated.` })
      resetCustomerForm()
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      if (saleForm.customer_id && String(saleForm.customer_id) === String(updated.id)) {
        setSaleForm((prev) => ({ ...prev, customer_id: String(updated.id) }))
      }
    },
    onError: (error) => {
      setCustomerBanner({ type: 'error', message: error.response?.data?.error || 'Unable to update customer.' })
    }
  })

  const deleteCustomerMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/customers/${id}`)
    },
    onSuccess: (_data, id) => {
      setCustomerBanner({ type: 'success', message: 'Customer removed.' })
      if (editingCustomer?.id === id) {
        resetCustomerForm()
      }
      if (String(saleForm.customer_id) === String(id)) {
        setSaleForm((prev) => ({ ...prev, customer_id: '' }))
      }
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (error) => {
      setCustomerBanner({ type: 'error', message: error.response?.data?.error || 'Unable to remove customer.' })
    }
  })

  const createSaleMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/sales', payload)
      return data
    },
    onSuccess: (sale) => {
      if (sale?.offline) {
        setSaleBanner({ type: 'info', message: 'Sale queued while offline. It will sync automatically.' })
      } else {
        setSaleBanner({ type: 'success', message: 'Sale created and stock reserved.' })
      }
      setSaleForm(createEmptySaleForm())
      queryClient.invalidateQueries({ queryKey: ['sales'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (error) => {
      setSaleBanner({ type: 'error', message: error.response?.data?.error || 'Unable to create sale.' })
    }
  })

  const reserveSaleMutation = useMutation({
    mutationFn: async (id) => {
      const { data } = await api.post(`/sales/${id}/reserve`)
      return data
    },
    onSuccess: () => {
      setSaleBanner({ type: 'success', message: 'Reservation attempt completed.' })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
    },
    onError: (error) => {
      setSaleBanner({ type: 'error', message: error.response?.data?.error || 'Unable to reserve stock for sale.' })
    }
  })

  const completeSaleMutation = useMutation({
    mutationFn: async (id) => {
      const { data } = await api.post(`/sales/${id}/complete`)
      return data
    },
    onSuccess: () => {
      setSaleBanner({ type: 'success', message: 'Sale completed and stock reduced.' })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (error) => {
      setSaleBanner({ type: 'error', message: error.response?.data?.error || 'Unable to complete sale.' })
    }
  })

  const cancelSaleMutation = useMutation({
    mutationFn: async (id) => {
      const { data } = await api.post(`/sales/${id}/cancel`)
      return data
    },
    onSuccess: () => {
      setSaleBanner({ type: 'success', message: 'Sale canceled and stock released.' })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (error) => {
      setSaleBanner({ type: 'error', message: error.response?.data?.error || 'Unable to cancel sale.' })
    }
  })

  const updateSaleDetailsMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.patch(`/sales/${id}`, payload)
      return data
    },
    onSuccess: (updated) => {
      setSaleDetailBanner({ type: 'success', message: 'Sale updated successfully.' })
      setActiveSale(updated)
      setSaleDetailForm({
        reference: updated.reference || '',
        notes: updated.notes || '',
        customer_id: updated.customer ? String(updated.customer.id) : updated.customerId ? String(updated.customerId) : ''
      })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
    onError: (error) => {
      setSaleDetailBanner({ type: 'error', message: error.response?.data?.error || 'Unable to update sale.' })
    }
  })

  const handleCustomerSubmit = (event) => {
    event.preventDefault()
    const payload = {
      name: customerForm.name,
      company: customerForm.company,
      email: customerForm.email,
      phone: customerForm.phone,
      address: customerForm.address,
      notes: customerForm.notes
    }
    if (editingCustomer) {
      updateCustomerMutation.mutate({ id: editingCustomer.id, payload })
    } else {
      createCustomerMutation.mutate(payload)
    }
  }

  const handleSaleItemChange = (index, field, value) => {
    setSaleForm((prev) => {
      const items = prev.items.map((item, idx) => {
        if (idx !== index) return item
        return { ...item, [field]: value }
      })
      return { ...prev, items }
    })
  }

  const closeSaleDetails = () => {
    setActiveSale(null)
    setSaleDetailBanner(null)
    setSaleDetailForm({ reference: '', notes: '', customer_id: '' })
    setSaleDetailLoading(false)
  }

  const openSaleDetails = (sale) => {
    if (!sale) return
    setSaleDetailBanner(null)
    setSaleDetailForm({
      reference: sale.reference || '',
      notes: sale.notes || '',
      customer_id: sale.customer ? String(sale.customer.id) : sale.customerId ? String(sale.customerId) : ''
    })
    setActiveSale(sale)
    setSaleDetailLoading(true)
    api.get(`/sales/${sale.id}`)
      .then(({ data }) => {
        setActiveSale(data)
        setSaleDetailForm({
          reference: data.reference || '',
          notes: data.notes || '',
          customer_id: data.customer ? String(data.customer.id) : data.customerId ? String(data.customerId) : ''
        })
      })
      .catch((error) => {
        setSaleDetailBanner({ type: 'error', message: error.response?.data?.error || 'Unable to load sale details.' })
      })
      .finally(() => {
        setSaleDetailLoading(false)
      })
  }

  const handleSaleDetailChange = (field, value) => {
    setSaleDetailForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSaleDetailSubmit = (event) => {
    event.preventDefault()
    if (!activeSale) return
    if (['complete', 'canceled'].includes(activeSale.status)) {
      setSaleDetailBanner({ type: 'error', message: 'Completed or canceled sales cannot be modified.' })
      return
    }
    setSaleDetailBanner(null)
    const payload = {}
    const trimmedReference = saleDetailForm.reference.trim()
    const trimmedNotes = saleDetailForm.notes.trim()
    const currentReference = activeSale.reference || ''
    const currentNotes = activeSale.notes || ''
    const currentCustomerId = activeSale.customer
      ? String(activeSale.customer.id)
      : activeSale.customerId
        ? String(activeSale.customerId)
        : ''

    if (trimmedReference !== currentReference) {
      payload.reference = trimmedReference
    }
    if (trimmedNotes !== currentNotes) {
      payload.notes = trimmedNotes
    }
    if (saleDetailForm.customer_id && saleDetailForm.customer_id !== currentCustomerId) {
      const parsedCustomerId = Number(saleDetailForm.customer_id)
      if (!Number.isFinite(parsedCustomerId) || parsedCustomerId <= 0) {
        setSaleDetailBanner({ type: 'error', message: 'Select a valid customer.' })
        return
      }
      payload.customer_id = parsedCustomerId
    }

    if (Object.keys(payload).length === 0) {
      setSaleDetailBanner({ type: 'info', message: 'No changes detected for this sale.' })
      return
    }

    updateSaleDetailsMutation.mutate({ id: activeSale.id, payload })
  }

  const handleSaleSubmit = (event) => {
    event.preventDefault()
    const items = saleItems
      .filter((item) => item.product_id && Number(item.quantity) > 0)
      .map((item) => {
        const productId = Number(item.product_id)
        const quantity = Number(item.quantity)
        const product = productMap[productId]
        return {
          product_id: productId,
          quantity,
          unit_price: product ? Number(product.unit_price || 0) : undefined
        }
      })

    if (!saleForm.customer_id) {
      setSaleBanner({ type: 'error', message: 'Select a customer before creating a sale.' })
      return
    }
    if (items.length === 0) {
      setSaleBanner({ type: 'error', message: 'Add at least one product to the sale.' })
      return
    }

    createSaleMutation.mutate({
      customer_id: Number(saleForm.customer_id),
      reference: saleForm.reference?.trim() || undefined,
      notes: saleForm.notes?.trim() || undefined,
      items
    })
  }

  const addSaleItem = () => {
    setSaleForm((prev) => ({
      ...prev,
      items: [...prev.items, { product_id: '', quantity: 1 }]
    }))
  }

  const removeSaleItem = (index) => {
    setSaleForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index)
    }))
  }

  const saleRows = useMemo(() => {
    return sales.map((sale) => {
      const allReserved = sale.items.every((item) => item.qty_reserved >= item.quantity)
      return {
        ...sale,
        allReserved
      }
    })
  }, [sales])

  const saleTotalPages = Math.max(1, Math.ceil(saleRows.length / PAGE_SIZE))
  const visibleSales = useMemo(() => {
    const start = (salePage - 1) * PAGE_SIZE
    return saleRows.slice(start, start + PAGE_SIZE)
  }, [saleRows, salePage])

  useEffect(() => {
    setSalePage(1)
  }, [saleStatus])

  useEffect(() => {
    if (salePage > saleTotalPages) {
      setSalePage(saleTotalPages)
    }
  }, [salePage, saleTotalPages])

  return (
    <div className="page">
      <div className="subnav" role="tablist" aria-label="Sales sections">
        <button
          id="sales-orders-tab"
          type="button"
          role="tab"
          aria-controls="sales-orders-panel"
          aria-selected={activeSection === 'sales'}
          tabIndex={activeSection === 'sales' ? 0 : -1}
          className={`subnav__item${activeSection === 'sales' ? ' subnav__item--active' : ''}`}
          onClick={() => setActiveSection('sales')}
        >
          Sales
        </button>
        <button
          id="sales-customers-tab"
          type="button"
          role="tab"
          aria-controls="sales-customers-panel"
          aria-selected={activeSection === 'customers'}
          tabIndex={activeSection === 'customers' ? 0 : -1}
          className={`subnav__item${activeSection === 'customers' ? ' subnav__item--active' : ''}`}
          onClick={() => setActiveSection('customers')}
        >
          Customers
        </button>
      </div>

      <div className="grid split">
        {activeSection === 'customers' && (
          <section
            id="sales-customers-panel"
            role="tabpanel"
            aria-labelledby="sales-customers-tab"
            className="card sales__panel"
          >
            <header className="card__header">
              <div>
                <h2>Customers</h2>
                <p className="stat-card__hint">Create and manage customer contact details.</p>
              </div>
            </header>
          <Banner banner={customerBanner} onClose={() => setCustomerBanner(null)} />
          <form className="grid two-columns" onSubmit={handleCustomerSubmit}>
            <label className="form-field">
              <span>Name</span>
              <input
                required
                type="text"
                value={customerForm.name}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Acme Industries"
              />
            </label>
            <label className="form-field">
              <span>Company</span>
              <input
                type="text"
                value={customerForm.company}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, company: event.target.value }))}
                placeholder="Trading name"
              />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input
                type="email"
                value={customerForm.email}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="customer@example.com"
              />
            </label>
            <label className="form-field">
              <span>Phone</span>
              <input
                type="text"
                value={customerForm.phone}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="+61 4 0000 0000"
              />
            </label>
            <label className="form-field form-field--full">
              <span>Address</span>
              <textarea
                rows={3}
                value={customerForm.address}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, address: event.target.value }))}
                placeholder="Shipping address"
              />
            </label>
            <label className="form-field form-field--full">
              <span>Notes</span>
              <textarea
                rows={3}
                value={customerForm.notes}
                onChange={(event) => setCustomerForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Preferred delivery windows, contacts, etc."
              />
            </label>
            <div className="form-actions">
              <button className="button button--primary" type="submit" disabled={createCustomerMutation.isLoading || updateCustomerMutation.isLoading}>
                {editingCustomer ? 'Update customer' : 'Add customer'}
              </button>
              {editingCustomer && (
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={resetCustomerForm}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          <div className="form-field">
            <span>Search customers</span>
            <input
              type="text"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Search by name, company or email"
            />
          </div>

          <TablePagination
            page={customerPage}
            totalPages={customerTotalPages}
            onPrev={() => setCustomerPage((page) => Math.max(1, page - 1))}
            onNext={() => setCustomerPage((page) => Math.min(customerTotalPages, page + 1))}
            className="table-pagination--inline"
          />

          <div className="table-scroll">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {loadingCustomers ? (
                  <tr><td colSpan={5}>Loading customers…</td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={5}>No customers found.</td></tr>
                ) : (
                  visibleCustomers.map((customer) => (
                    <tr key={customer.id}>
                      <td>{customer.name}</td>
                      <td>{customer.company || '—'}</td>
                      <td>{customer.email || '—'}</td>
                      <td>{customer.phone || '—'}</td>
                      <td className="table__actions">
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() => {
                            setEditingCustomer(customer)
                            setCustomerForm({
                              name: customer.name || '',
                              company: customer.company || '',
                              email: customer.email || '',
                              phone: customer.phone || '',
                              address: customer.address || '',
                              notes: customer.notes || ''
                            })
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Remove ${customer.name}?`)) {
                              deleteCustomerMutation.mutate(customer.id)
                            }
                          }}
                          disabled={deleteCustomerMutation.isLoading}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination
              page={customerPage}
              totalPages={customerTotalPages}
              onPrev={() => setCustomerPage((page) => Math.max(1, page - 1))}
              onNext={() => setCustomerPage((page) => Math.min(customerTotalPages, page + 1))}
            />
            </div>
          </section>
        )}

        {activeSection === 'sales' && (
          <section
            id="sales-orders-panel"
            role="tabpanel"
            aria-labelledby="sales-orders-tab"
            className="card sales__panel"
          >
          <header className="card__header">
            <div>
              <h2>Sales</h2>
              <p className="stat-card__hint">Reserve products for customers and complete sales when fulfilled.</p>
            </div>
          </header>
          <Banner banner={saleBanner} onClose={() => setSaleBanner(null)} />
          <form className="grid two-columns" onSubmit={handleSaleSubmit}>
            <label className="form-field">
              <span>Customer</span>
              <select
                required
                value={saleForm.customer_id}
                onChange={(event) => setSaleForm((prev) => ({ ...prev, customer_id: event.target.value }))}
              >
                <option value="">Select a customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Reference</span>
              <input
                type="text"
                value={saleForm.reference}
                onChange={(event) => setSaleForm((prev) => ({ ...prev, reference: event.target.value }))}
                placeholder="Optional reference"
              />
            </label>
            <label className="form-field form-field--full">
              <span>Notes</span>
              <textarea
                rows={3}
                value={saleForm.notes}
                onChange={(event) => setSaleForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Special handling instructions"
              />
            </label>
            <div className="form-field form-field--full">
              <span>Products</span>
              <div className="sale-items">
                {saleItems.map((item, index) => (
                  <div key={index} className="sale-items__row">
                    <select
                      value={item.product_id}
                      onChange={(event) => handleSaleItemChange(index, 'product_id', event.target.value)}
                    >
                      <option value="">Select product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.sku} — {product.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(event) => handleSaleItemChange(index, 'quantity', event.target.value)}
                    />
                    {saleItems.length > 1 && (
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => removeSaleItem(index)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="button button--ghost" onClick={addSaleItem}>
                  Add another product
                </button>
              </div>
            </div>
            <div className="form-actions">
              <button className="button button--primary" type="submit" disabled={createSaleMutation.isLoading}>
                Create sale
              </button>
              {selectedCustomer && (
                <span className="stat-card__hint">Reserves stock immediately for {selectedCustomer.name}.</span>
              )}
            </div>
          </form>

          <div className="form-field">
            <span>Filter by status</span>
            <select value={saleStatus} onChange={(event) => setSaleStatus(event.target.value)}>
              <option value="">All sales</option>
              <option value="reserved">Reserved</option>
              <option value="backorder">Backorder</option>
              <option value="complete">Complete</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>

          <TablePagination
            page={salePage}
            totalPages={saleTotalPages}
            onPrev={() => setSalePage((page) => Math.max(1, page - 1))}
            onNext={() => setSalePage((page) => Math.min(saleTotalPages, page + 1))}
            className="table-pagination--inline"
          />

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {loadingSales ? (
                  <tr><td colSpan={5}>Loading sales…</td></tr>
                ) : saleRows.length === 0 ? (
                  <tr><td colSpan={5}>No sales recorded yet.</td></tr>
                ) : visibleSales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <strong>#{sale.id}</strong>
                      {sale.reference ? <div className="stat-card__hint">{sale.reference}</div> : null}
                    </td>
                    <td>{sale.customer?.name || '—'}</td>
                    <td>
                      <ul className="sale-items__list">
                        {sale.items.map((item) => {
                          const product = item.product || productMap[item.productId] || {}
                          const backordered = Math.max(0, item.quantity - item.qty_reserved)
                          return (
                            <li key={item.id}>
                              <span>{product.name || `Product #${item.productId}`}</span>
                              <span className="stat-card__hint">
                                Ordered {item.quantity} • Reserved {item.qty_reserved} • Shipped {item.qty_shipped}
                                {backordered > 0 ? ` • Backorder ${backordered}` : ''}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </td>
                    <td>
                      <span className={`badge ${sale.status === 'backorder' ? 'badge--muted' : ''}${sale.status === 'canceled' ? ' badge--danger' : ''}`}>
                        {sale.status}
                      </span>
                    </td>
                    <td className="table__actions">
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => openSaleDetails(sale)}
                      >
                        View / update
                      </button>
                      {sale.status === 'backorder' && (
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() => reserveSaleMutation.mutate(sale.id)}
                          disabled={reserveSaleMutation.isLoading}
                        >
                          Retry reserve
                        </button>
                      )}
                      {sale.status !== 'complete' && sale.status !== 'canceled' && sale.allReserved && (
                        <button
                          className="button button--primary"
                          type="button"
                          onClick={() => completeSaleMutation.mutate(sale.id)}
                          disabled={completeSaleMutation.isLoading}
                        >
                          Complete sale
                        </button>
                      )}
                      {sale.status !== 'complete' && sale.status !== 'canceled' && (
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Cancel sale #${sale.id}? Reserved stock will be released.`)) {
                              cancelSaleMutation.mutate(sale.id)
                            }
                          }}
                          disabled={cancelSaleMutation.isLoading}
                        >
                          Cancel sale
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={salePage}
              totalPages={saleTotalPages}
              onPrev={() => setSalePage((page) => Math.max(1, page - 1))}
              onNext={() => setSalePage((page) => Math.min(saleTotalPages, page + 1))}
            />
            </div>
          </section>
        )}
      </div>
      {activeSale && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`sale-detail-${activeSale.id}`}>
          <div className="modal__content card">
            <div className="modal__header">
              <div>
                <h3 id={`sale-detail-${activeSale.id}`}>Sale #{activeSale.id}</h3>
                <p className="muted">
                  {saleDetailLoading ? 'Loading sale details…' : `Status: ${activeSale.status}`}
                  {saleDetailsLocked && !saleDetailLoading ? ' · Updates locked' : ''}
                </p>
              </div>
              <button type="button" className="button button--ghost" onClick={closeSaleDetails}>Close</button>
            </div>
            {saleDetailBanner && (
              <div className={`banner banner--${saleDetailBanner.type === 'error' ? 'danger' : saleDetailBanner.type || 'info'}`}>
                {saleDetailBanner.message}
              </div>
            )}
            <form className="form-grid" onSubmit={handleSaleDetailSubmit}>
              <label className="field" data-help="Visible on documents and internal activity logs.">
                <span>Reference</span>
                <input
                  value={saleDetailForm.reference}
                  onChange={(e) => handleSaleDetailChange('reference', e.target.value)}
                  placeholder="Optional reference"
                  disabled={saleDetailsLocked || saleDetailLoading || updateSaleDetailsMutation.isLoading}
                />
              </label>
              <label className="field" data-help="Update the customer linked to this sale.">
                <span>Customer</span>
                <select
                  value={saleDetailForm.customer_id}
                  onChange={(e) => handleSaleDetailChange('customer_id', e.target.value)}
                  disabled={saleDetailsLocked || saleDetailLoading || updateSaleDetailsMutation.isLoading}
                >
                  <option value="">Select customer</option>
                  {saleCustomerOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="field field--full" data-help="Internal notes for your team.">
                <span>Notes</span>
                <textarea
                  value={saleDetailForm.notes}
                  onChange={(e) => handleSaleDetailChange('notes', e.target.value)}
                  rows={3}
                  placeholder="Add context for this sale"
                  disabled={saleDetailsLocked || saleDetailLoading || updateSaleDetailsMutation.isLoading}
                />
              </label>
              <div className="modal__actions">
                <button type="button" className="button button--ghost" onClick={closeSaleDetails} disabled={updateSaleDetailsMutation.isLoading}>
                  Close
                </button>
                <button type="submit" className="button button--primary" disabled={saleDetailsLocked || updateSaleDetailsMutation.isLoading}>
                  {saleDetailsLocked ? 'Updates disabled' : updateSaleDetailsMutation.isLoading ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
            <section className="modal__body">
              <h4>Items</h4>
              <ul className="sale-items__list">
                {Array.isArray(activeSale.items) && activeSale.items.map((item) => {
                  const product = item.product || productMap[item.productId] || {}
                  const backordered = Math.max(0, item.quantity - item.qty_reserved)
                  return (
                    <li key={item.id}>
                      <span>{product.name || `Product #${item.productId}`}</span>
                      <span className="stat-card__hint">
                        Ordered {item.quantity} • Reserved {item.qty_reserved} • Shipped {item.qty_shipped}
                        {backordered > 0 ? ` • Backorder ${backordered}` : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
