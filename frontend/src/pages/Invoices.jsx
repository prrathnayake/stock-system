import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../providers/AuthProvider.jsx'

const statusOptions = [
  { id: 'draft', label: 'Draft' },
  { id: 'issued', label: 'Issued' },
  { id: 'payment_processing', label: 'Payment processing' },
  { id: 'paid', label: 'Payment received' },
  { id: 'void', label: 'Void' }
]

const paymentMethods = ['Bank transfer', 'Card', 'Cash', 'Direct debit', 'Other']

const defaultLine = {
  product_id: '',
  description: '',
  quantity: 1,
  unit_price: 0,
  gst_rate: 0.1,
  bin_id: ''
}

function formatCurrency(value, currency = 'AUD') {
  const amount = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount)
}

function calculateLineTotals(line) {
  const qty = Number(line.quantity) || 0
  const price = Number(line.unit_price) || 0
  const rate = Number(line.gst_rate) || 0
  const subtotal = qty * price
  const gst = subtotal * rate
  const total = subtotal + gst
  return {
    line_subtotal: subtotal,
    line_gst: gst,
    line_total: total
  }
}

function calculateTotals(lines) {
  return lines.reduce(
    (acc, line) => {
      const { line_subtotal, line_gst, line_total } = calculateLineTotals(line)
      acc.subtotal += line_subtotal
      acc.gst += line_gst
      acc.total += line_total
      return acc
    },
    { subtotal: 0, gst: 0, total: 0 }
  )
}

function toDateInput(date) {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}

function defaultDueDate() {
  const due = new Date()
  due.setDate(due.getDate() + 14)
  return toDateInput(due)
}

export default function Invoices() {
  const { organization } = useAuth()
  const queryClient = useQueryClient()
  const [banner, setBanner] = useState(null)
  const [errorBanner, setErrorBanner] = useState(null)
  const [activeInvoiceId, setActiveInvoiceId] = useState(null)

  const initialOrgDefaults = {
    supplier_name: organization?.legal_name || organization?.name || '',
    supplier_abn: organization?.abn || '',
    supplier_address: organization?.address || '',
    payment_terms: organization?.default_payment_terms || '',
    currency: organization?.currency || 'AUD',
    notes: organization?.invoice_notes || ''
  }

  const defaultsRef = useRef(initialOrgDefaults)

  const [form, setForm] = useState({
    customer_name: '',
    customer_email: '',
    customer_address: '',
    customer_abn: '',
    supplier_name: initialOrgDefaults.supplier_name,
    supplier_abn: initialOrgDefaults.supplier_abn,
    supplier_address: initialOrgDefaults.supplier_address,
    payment_terms: initialOrgDefaults.payment_terms,
    reference: '',
    issue_date: toDateInput(new Date()),
    due_date: defaultDueDate(),
    currency: initialOrgDefaults.currency,
    notes: initialOrgDefaults.notes,
    status: 'issued',
    lines: [{ ...defaultLine }]
  })

  useEffect(() => {
    const nextDefaults = {
      supplier_name: organization?.legal_name || organization?.name || '',
      supplier_abn: organization?.abn || '',
      supplier_address: organization?.address || '',
      payment_terms: organization?.default_payment_terms || '',
      currency: organization?.currency || 'AUD',
      notes: organization?.invoice_notes || ''
    }

    setForm((prev) => ({
      ...prev,
      supplier_name:
        prev.supplier_name && prev.supplier_name !== defaultsRef.current.supplier_name
          ? prev.supplier_name
          : (nextDefaults.supplier_name || prev.supplier_name || ''),
      supplier_abn:
        prev.supplier_abn && prev.supplier_abn !== defaultsRef.current.supplier_abn
          ? prev.supplier_abn
          : (nextDefaults.supplier_abn || prev.supplier_abn || ''),
      supplier_address:
        prev.supplier_address && prev.supplier_address !== defaultsRef.current.supplier_address
          ? prev.supplier_address
          : (nextDefaults.supplier_address || prev.supplier_address || ''),
      payment_terms:
        prev.payment_terms && prev.payment_terms !== defaultsRef.current.payment_terms
          ? prev.payment_terms
          : (nextDefaults.payment_terms || prev.payment_terms || 'Due on receipt'),
      currency:
        prev.currency && prev.currency !== defaultsRef.current.currency
          ? prev.currency
          : (nextDefaults.currency || prev.currency || 'AUD'),
      notes:
        prev.notes && prev.notes !== defaultsRef.current.notes
          ? prev.notes
          : (nextDefaults.notes || prev.notes || '')
    }))
    defaultsRef.current = nextDefaults
  }, [
    organization?.legal_name,
    organization?.name,
    organization?.abn,
    organization?.address,
    organization?.default_payment_terms,
    organization?.currency,
    organization?.invoice_notes
  ])

  const totals = useMemo(() => {
    const rawTotals = calculateTotals(form.lines)
    return {
      subtotal: rawTotals.subtotal,
      gst: rawTotals.gst,
      total: rawTotals.total
    }
  }, [form.lines])

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data } = await api.get('/products')
      return data
    }
  })

  const { data: stock = [] } = useQuery({
    queryKey: ['stock-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/stock')
      return data
    }
  })

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: async () => {
      const { data } = await api.get('/invoices')
      return data
    }
  })

  const { data: activeInvoice } = useQuery({
    queryKey: ['invoice-detail', activeInvoiceId],
    queryFn: async () => {
      const { data } = await api.get(`/invoices/${activeInvoiceId}`)
      return data
    },
    enabled: Boolean(activeInvoiceId)
  })

  const [statusForm, setStatusForm] = useState({
    status: 'draft',
    payment_amount: '',
    payment_method: paymentMethods[0],
    payment_reference: '',
    payment_notes: ''
  })

  useEffect(() => {
    if (activeInvoice) {
      setStatusForm({
        status: activeInvoice.status,
        payment_amount: activeInvoice.balance_due > 0 ? activeInvoice.balance_due.toFixed(2) : '',
        payment_method: paymentMethods[0],
        payment_reference: '',
        payment_notes: ''
      })
    }
  }, [activeInvoice?.id])

  function updateLine(index, key, value) {
    setForm((prev) => {
      const nextLines = prev.lines.map((line, idx) => {
        if (idx !== index) return line
        if (key === 'product_id') {
          const product = products.find((item) => item.id === Number(value))
          return {
            ...line,
            product_id: value,
            description: line.description || product?.name || '',
            bin_id: '',
            gst_rate: line.gst_rate ?? 0.1
          }
        }
        if (key === 'gst_rate') {
          const numeric = Number(value)
          const normalised = Number.isNaN(numeric) ? 0 : numeric > 1 ? numeric / 100 : numeric
          return { ...line, gst_rate: normalised }
        }
        if (key === 'quantity') {
          const qty = Math.max(1, Number(value) || 1)
          return { ...line, quantity: qty }
        }
        return { ...line, [key]: value }
      })
      return { ...prev, lines: nextLines }
    })
  }

  function addLine() {
    setForm((prev) => ({
      ...prev,
      lines: [...prev.lines, { ...defaultLine }]
    }))
  }

  function removeLine(index) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, idx) => idx !== index)
    }))
  }

  const createInvoiceMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customer_name: form.customer_name,
        customer_email: form.customer_email || undefined,
        customer_address: form.customer_address || undefined,
        customer_abn: form.customer_abn || undefined,
        supplier_name: form.supplier_name || undefined,
        supplier_abn: form.supplier_abn || undefined,
        supplier_address: form.supplier_address || undefined,
        payment_terms: form.payment_terms || organization?.default_payment_terms || undefined,
        reference: form.reference || undefined,
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
        currency: form.currency || organization?.currency || 'AUD',
        notes: form.notes || organization?.invoice_notes || undefined,
        status: form.status,
        lines: form.lines
          .filter((line) => line.description && Number(line.quantity) > 0 && line.product_id)
          .map((line) => ({
            product_id: Number(line.product_id),
            description: line.description,
            quantity: Number(line.quantity) || 1,
            unit_price: Number(line.unit_price) || 0,
            gst_rate: Number(line.gst_rate) || 0,
            bin_id: line.bin_id ? Number(line.bin_id) : undefined
          }))
      }
      const { data } = await api.post('/invoices', payload)
      return data
    },
    onSuccess: (data) => {
      setBanner(`Invoice ${data.invoice_number} created successfully.`)
      setErrorBanner(null)
      setForm((prev) => ({
        ...prev,
        customer_name: '',
        customer_email: '',
        customer_address: '',
        customer_abn: '',
        reference: '',
        notes: '',
        status: 'issued',
        lines: [{ ...defaultLine }]
      }))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      if (data?.id) {
        setActiveInvoiceId(data.id)
        queryClient.invalidateQueries({ queryKey: ['invoice-detail', data.id] })
      }
    },
    onError: (error) => {
      const message = error?.response?.data?.error || 'Unable to create invoice. Please check the details and try again.'
      setErrorBanner(message)
      setBanner(null)
    }
  })

  const statusMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.patch(`/invoices/${id}/status`, payload)
      return data
    },
    onSuccess: (data) => {
      setBanner(`Invoice ${data.invoice_number} updated successfully.`)
      setErrorBanner(null)
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['invoice-detail', data.id] })
      }
    },
    onError: (error) => {
      const message = error?.response?.data?.error || 'Unable to update invoice status.'
      setErrorBanner(message)
    }
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (form.lines.length === 0) {
      setErrorBanner('Add at least one line item before creating the invoice.')
      return
    }
    const missingProduct = form.lines.some((line) => !line.product_id)
    if (missingProduct) {
      setErrorBanner('Select a product for each line item to ensure inventory is updated correctly.')
      return
    }
    createInvoiceMutation.mutate()
  }

  function handleStatusSubmit(e) {
    e.preventDefault()
    if (!activeInvoice) return
    const payload = { status: statusForm.status }
    if (statusForm.status === 'paid') {
      const amount = Number(statusForm.payment_amount || activeInvoice.balance_due)
      if (Number.isNaN(amount) || amount <= 0) {
        setErrorBanner('Enter a valid payment amount to close the invoice.')
        return
      }
      payload.payment = {
        amount,
        method: statusForm.payment_method,
        reference: statusForm.payment_reference || undefined,
        notes: statusForm.payment_notes || undefined,
        paid_at: new Date().toISOString()
      }
    }
    statusMutation.mutate({ id: activeInvoice.id, payload })
  }

  function productOptions() {
    return products.map((product) => ({
      value: product.id,
      label: `${product.sku} — ${product.name}`
    }))
  }

  function binsForProduct(productId) {
    const inventory = stock.find((item) => item.id === Number(productId))
    if (!inventory) return []
    return inventory.bins.filter((bin) => bin.on_hand > 0)
  }

  return (
    <div className="page">
      {banner && <div className="banner banner--success">{banner}</div>}
      {errorBanner && <div className="banner banner--error">{errorBanner}</div>}

      <div className="grid split">
        <div className="card">
          <div className="card__header">
            <div>
              <h2>Create invoice</h2>
              <p className="muted">Capture all mandatory fields for Australian tax invoices and preview totals with GST.</p>
            </div>
          </div>
          <form className="form" onSubmit={handleSubmit}>
            <div className="grid two-columns">
              <label className="form-control">
                <span>Customer name *</span>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                  required
                />
              </label>
              <label className="form-control">
                <span>Customer email</span>
                <input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => setForm((prev) => ({ ...prev, customer_email: e.target.value }))}
                />
              </label>
              <label className="form-control">
                <span>Customer ABN</span>
                <input
                  type="text"
                  value={form.customer_abn}
                  onChange={(e) => setForm((prev) => ({ ...prev, customer_abn: e.target.value }))}
                  placeholder="ABN (11 digits)"
                />
              </label>
              <label className="form-control">
                <span>Invoice reference</span>
                <input
                  type="text"
                  value={form.reference}
                  onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))}
                  placeholder="PO number or internal reference"
                />
              </label>
            </div>

            <label className="form-control">
              <span>Customer billing address</span>
              <textarea
                rows={3}
                value={form.customer_address}
                onChange={(e) => setForm((prev) => ({ ...prev, customer_address: e.target.value }))}
              />
            </label>

            <div className="grid two-columns">
              <label className="form-control">
                <span>Supplier name</span>
                <input
                  type="text"
                  value={form.supplier_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, supplier_name: e.target.value }))}
                />
              </label>
              <label className="form-control">
                <span>Supplier ABN *</span>
                <input
                  type="text"
                  value={form.supplier_abn}
                  onChange={(e) => setForm((prev) => ({ ...prev, supplier_abn: e.target.value }))}
                  placeholder="Required for Australian tax invoices"
                  required
                />
              </label>
            </div>

            <label className="form-control">
              <span>Supplier address</span>
              <textarea
                rows={3}
                value={form.supplier_address}
                onChange={(e) => setForm((prev) => ({ ...prev, supplier_address: e.target.value }))}
              />
            </label>

            <div className="grid two-columns">
              <label className="form-control">
                <span>Issue date</span>
                <input
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, issue_date: e.target.value }))}
                />
              </label>
              <label className="form-control">
                <span>Due date</span>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))}
                />
              </label>
            </div>

            <div className="grid two-columns">
              <label className="form-control">
                <span>Payment terms</span>
                <input
                  type="text"
                  value={form.payment_terms}
                  onChange={(e) => setForm((prev) => ({ ...prev, payment_terms: e.target.value }))}
                  placeholder="e.g. 14 days or due on receipt"
                />
              </label>
              <label className="form-control">
                <span>Invoice status</span>
                <select
                  value={form.status}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  {statusOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="line-items">
              <div className="line-items__header">
                <h3>Line items</h3>
                <button className="button button--ghost" type="button" onClick={addLine}>
                  + Add line
                </button>
              </div>
              {form.lines.length === 0 && <p className="muted">Add at least one product or service to generate an invoice.</p>}
              {form.lines.map((line, index) => {
                const bins = binsForProduct(line.product_id)
                const totalsForLine = calculateLineTotals(line)
                return (
                  <div key={index} className="line-item">
                    <div className="grid two-columns">
                      <label className="form-control">
                        <span>Product</span>
                        <select
                          value={line.product_id}
                          onChange={(e) => updateLine(index, 'product_id', e.target.value)}
                          required
                        >
                          <option value="">Select product</option>
                          {productOptions().map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="form-control">
                        <span>Description *</span>
                        <input
                          type="text"
                          value={line.description}
                          onChange={(e) => updateLine(index, 'description', e.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <div className="grid three-columns">
                      <label className="form-control">
                        <span>Quantity</span>
                        <input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(index, 'quantity', e.target.value)}
                        />
                      </label>
                      <label className="form-control">
                        <span>Unit price (ex GST)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_price}
                          onChange={(e) => updateLine(index, 'unit_price', e.target.value)}
                        />
                      </label>
                      <label className="form-control">
                        <span>GST rate</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={Number(line.gst_rate) <= 1 ? (Number(line.gst_rate) * 100).toFixed(2) : line.gst_rate}
                          onChange={(e) => updateLine(index, 'gst_rate', e.target.value)}
                          placeholder="10"
                        />
                      </label>
                    </div>
                    <div className="grid two-columns">
                      <label className="form-control">
                        <span>Fulfil from bin</span>
                        <select
                          value={line.bin_id}
                          onChange={(e) => updateLine(index, 'bin_id', e.target.value)}
                        >
                          <option value="">Auto select based on availability</option>
                          {bins.map((bin) => (
                            <option key={bin.bin_id} value={bin.bin_id}>
                              {bin.bin_code} · {bin.on_hand} on hand
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="line-item__totals">
                        <p className="muted">Subtotal: {formatCurrency(totalsForLine.line_subtotal, form.currency)}</p>
                        <p className="muted">GST: {formatCurrency(totalsForLine.line_gst, form.currency)}</p>
                        <p><strong>Total: {formatCurrency(totalsForLine.line_total, form.currency)}</strong></p>
                      </div>
                    </div>
                    {form.lines.length > 1 && (
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => removeLine(index)}
                      >
                        Remove line
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <label className="form-control">
              <span>Additional notes</span>
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Payment instructions, bank details or warranty terms"
              />
            </label>

            <div className="invoice-summary">
              <div>
                <p className="muted">Subtotal</p>
                <p>{formatCurrency(totals.subtotal, form.currency)}</p>
              </div>
              <div>
                <p className="muted">GST (10%)</p>
                <p>{formatCurrency(totals.gst, form.currency)}</p>
              </div>
              <div>
                <p className="muted">Total due</p>
                <p className="invoice-summary__total">{formatCurrency(totals.total, form.currency)}</p>
              </div>
            </div>

            <div className="form-actions">
              <button className="button button--primary" type="submit" disabled={createInvoiceMutation.isLoading}>
                {createInvoiceMutation.isLoading ? 'Creating…' : 'Generate invoice'}
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <div className="card__header">
            <div>
              <h2>Professional invoice preview</h2>
              <p className="muted">Real-time preview of the document your customer will receive.</p>
            </div>
          </div>
          <div className="invoice-preview">
            <header className="invoice-preview__header">
              <div>
                <h3>{form.supplier_name || 'Supplier name'}</h3>
                {form.supplier_abn && <p>ABN: {form.supplier_abn}</p>}
                {form.supplier_address && (
                  <p className="muted">
                    {form.supplier_address.split('\n').map((line, idx) => (
                      <React.Fragment key={idx}>
                        {line}
                        <br />
                      </React.Fragment>
                    ))}
                  </p>
                )}
              </div>
              <div className="invoice-preview__meta">
                <p><strong>Invoice status:</strong> {statusOptions.find((opt) => opt.id === form.status)?.label || form.status}</p>
                <p><strong>Issue date:</strong> {form.issue_date || '—'}</p>
                <p><strong>Due date:</strong> {form.due_date || '—'}</p>
                {form.reference && <p><strong>Reference:</strong> {form.reference}</p>}
              </div>
              {(organization?.logo_asset_url || organization?.logo_url) && (
                <img
                  className="invoice-preview__logo"
                  src={organization.logo_asset_url || organization.logo_url}
                  alt={`${organization?.name || 'Organization'} logo`}
                />
              )}
            </header>
            <section className="invoice-preview__customer">
              <h4>Bill to</h4>
              <p>{form.customer_name || 'Customer name'}</p>
              {form.customer_abn && <p>ABN: {form.customer_abn}</p>}
              {form.customer_email && <p>{form.customer_email}</p>}
              {form.customer_address && (
                <p className="muted">
                  {form.customer_address.split('\n').map((line, idx) => (
                    <React.Fragment key={idx}>
                      {line}
                      <br />
                    </React.Fragment>
                  ))}
                </p>
              )}
            </section>
            <table className="table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>GST</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {form.lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">Add products or services to populate the invoice.</td>
                  </tr>
                )}
                {form.lines.map((line, index) => {
                  const { line_subtotal, line_gst, line_total } = calculateLineTotals(line)
                  return (
                    <tr key={index}>
                      <td>{line.description || '—'}</td>
                      <td>{line.quantity}</td>
                      <td>{formatCurrency(line.unit_price, form.currency)}</td>
                      <td>{formatCurrency(line_gst, form.currency)}</td>
                      <td>{formatCurrency(line_total, form.currency)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="invoice-preview__totals">
              <div>
                <span>Subtotal</span>
                <span>{formatCurrency(totals.subtotal, form.currency)}</span>
              </div>
              <div>
                <span>GST (10%)</span>
                <span>{formatCurrency(totals.gst, form.currency)}</span>
              </div>
              <div className="invoice-preview__grand-total">
                <span>Total due</span>
                <span>{formatCurrency(totals.total, form.currency)}</span>
              </div>
            </div>
            {form.payment_terms && (
              <section className="invoice-preview__notes">
                <h4>Payment terms</h4>
                <p>{form.payment_terms}</p>
              </section>
            )}
            {form.notes && (
              <section className="invoice-preview__notes">
                <h4>Notes</h4>
                <p>{form.notes}</p>
              </section>
            )}
            <footer className="invoice-preview__footer">
              <p className="muted">All prices are inclusive of GST. Please quote the invoice number on payment remittance.</p>
            </footer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <h2>Recent invoices</h2>
            <p className="muted">Track outstanding balances and progress invoices through payment stages.</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
              <th>Balance due</th>
              <th>Issued</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">No invoices created yet.</td>
              </tr>
            )}
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.invoice_number}</td>
                <td>{invoice.customer_name}</td>
                <td><span className={`badge badge--${invoice.status}`}>{statusOptions.find((opt) => opt.id === invoice.status)?.label || invoice.status}</span></td>
                <td>{formatCurrency(invoice.total, invoice.currency)}</td>
                <td>{formatCurrency(invoice.balance_due, invoice.currency)}</td>
                <td>{invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString() : '—'}</td>
                <td>
                  <button className="button button--ghost button--small" type="button" onClick={() => setActiveInvoiceId(invoice.id)}>
                    View details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeInvoice && (
        <div className="card">
          <div className="card__header">
            <div>
              <h2>{activeInvoice.invoice_number}</h2>
              <p className="muted">Status: {statusOptions.find((opt) => opt.id === activeInvoice.status)?.label || activeInvoice.status}</p>
            </div>
            <button className="button button--ghost" type="button" onClick={() => setActiveInvoiceId(null)}>Close</button>
          </div>

          <div className="invoice-detail">
            <div className="invoice-detail__meta">
              <p><strong>Customer:</strong> {activeInvoice.customer_name}</p>
              <p><strong>Total:</strong> {formatCurrency(activeInvoice.total, activeInvoice.currency)}</p>
              <p><strong>Balance due:</strong> {formatCurrency(activeInvoice.balance_due, activeInvoice.currency)}</p>
              <p><strong>Issued:</strong> {activeInvoice.issue_date ? new Date(activeInvoice.issue_date).toLocaleDateString() : '—'}</p>
              <p><strong>Due:</strong> {activeInvoice.due_date ? new Date(activeInvoice.due_date).toLocaleDateString() : '—'}</p>
            </div>

            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>GST</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {activeInvoice.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{formatCurrency(line.unit_price, activeInvoice.currency)}</td>
                    <td>{formatCurrency(line.line_gst, activeInvoice.currency)}</td>
                    <td>{formatCurrency(line.line_total, activeInvoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <section>
              <h3>Payments</h3>
              {activeInvoice.payments.length === 0 && <p className="muted">No payments recorded yet.</p>}
              {activeInvoice.payments.length > 0 && (
                <ul className="payment-list">
                  {activeInvoice.payments.map((payment) => (
                    <li key={payment.id}>
                      <strong>{formatCurrency(payment.amount, activeInvoice.currency)}</strong>
                      <span className="muted"> · {payment.method || 'Payment'}</span>
                      <span className="muted"> · {payment.paid_at ? new Date(payment.paid_at).toLocaleString() : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <form className="form" onSubmit={handleStatusSubmit}>
              <h3>Progress invoice</h3>
              <div className="grid two-columns">
                <label className="form-control">
                  <span>Status</span>
                  <select
                    value={statusForm.status}
                    onChange={(e) => setStatusForm((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span>Payment method</span>
                  <select
                    value={statusForm.payment_method}
                    onChange={(e) => setStatusForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                    disabled={statusForm.status !== 'paid'}
                  >
                    {paymentMethods.map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </label>
              </div>

              {statusForm.status === 'paid' && (
                <div className="grid two-columns">
                  <label className="form-control">
                    <span>Payment amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={statusForm.payment_amount}
                      onChange={(e) => setStatusForm((prev) => ({ ...prev, payment_amount: e.target.value }))}
                    />
                  </label>
                  <label className="form-control">
                    <span>Payment reference</span>
                    <input
                      type="text"
                      value={statusForm.payment_reference}
                      onChange={(e) => setStatusForm((prev) => ({ ...prev, payment_reference: e.target.value }))}
                      placeholder="Receipt number or transaction ID"
                    />
                  </label>
                  <label className="form-control" style={{ gridColumn: '1 / span 2' }}>
                    <span>Payment notes</span>
                    <textarea
                      rows={2}
                      value={statusForm.payment_notes}
                      onChange={(e) => setStatusForm((prev) => ({ ...prev, payment_notes: e.target.value }))}
                    />
                  </label>
                </div>
              )}

              <div className="form-actions">
                <button className="button button--primary" type="submit" disabled={statusMutation.isLoading}>
                  {statusMutation.isLoading ? 'Updating…' : 'Update invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
