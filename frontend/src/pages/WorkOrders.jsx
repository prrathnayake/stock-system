import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../providers/AuthProvider.jsx'

const statusLabels = {
  intake: 'Intake',
  diagnostics: 'Diagnostics',
  awaiting_approval: 'Awaiting Approval',
  approved: 'Approved',
  awaiting_parts: 'Awaiting Parts',
  in_progress: 'In Progress',
  completed: 'Completed',
  canceled: 'Canceled'
}

const statusOrder = [
  'intake',
  'diagnostics',
  'awaiting_approval',
  'approved',
  'awaiting_parts',
  'in_progress',
  'completed',
  'canceled'
]

const priorityLabels = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent'
}

const emptyCreateForm = {
  customer_name: '',
  device_info: '',
  device_serial: '',
  priority: 'normal',
  intake_notes: '',
  assigned_to: ''
}

function SerialList({ assignments }) {
  if (!assignments || assignments.length === 0) return null
  return (
    <ul className="serial-list">
      {assignments.map((assignment) => {
        const serial = assignment.serial_number || assignment.serialNumber
        return (
          <li key={assignment.id || `${serial?.serial}-${assignment.status}`}
            className={`serial serial--${assignment.status}`}>
            <span className="badge badge--muted">{serial?.serial || '—'}</span>
            <span>{assignment.status}</span>
          </li>
        )
      })}
    </ul>
  )
}

function StatusHistory({ history }) {
  if (!history || history.length === 0) return null
  return (
    <ul className="timeline">
      {history.map((item) => {
        const status = item.to_status || item.toStatus
        const timestamp = item.createdAt || item.created_at
        return (
          <li key={item.id}>
            <div className="timeline__title">{statusLabels[status] || status}</div>
            <div className="timeline__meta">
              {timestamp ? new Date(timestamp).toLocaleString() : '—'}
              {item.performedBy?.full_name && ` · ${item.performedBy.full_name}`}
              {item.note && <span> · {item.note}</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function WorkOrders() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [statusDraft, setStatusDraft] = useState({})
  const [statusNotes, setStatusNotes] = useState({})
  const [diagnosticDraft, setDiagnosticDraft] = useState({})
  const [banner, setBanner] = useState(null)
  const [createForm, setCreateForm] = useState(emptyCreateForm)
  const [createBanner, setCreateBanner] = useState(null)

  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['work-orders', user?.role, user?.id],
    queryFn: async () => {
      const { data } = await api.get('/work-orders')
      return data
    },
    enabled: Boolean(user)
  })

  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['work-order-users'],
    queryFn: async () => {
      const { data } = await api.get('/users')
      return data
    },
    enabled: isAdmin
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data } = await api.get('/customers')
      return data
    },
    enabled: Boolean(user)
  })

  const customerOptions = useMemo(() => (
    customers.map((customer) => {
      const summaryParts = [customer.company, customer.email, customer.phone].filter(Boolean)
      return {
        id: customer.id,
        name: customer.name,
        summary: summaryParts.join(' • ')
      }
    })
      .filter((option) => option.name)
  ), [customers])

  const defaultAssignee = useMemo(() => {
    if (!isAdmin) return ''
    if (assignableUsers.length > 0) return String(assignableUsers[0].id)
    if (user?.id) return String(user.id)
    return ''
  }, [assignableUsers, isAdmin, user?.id])

  useEffect(() => {
    if (!isAdmin) return
    if (createForm.assigned_to) return
    if (defaultAssignee) {
      setCreateForm((prev) => ({ ...prev, assigned_to: defaultAssignee }))
    }
  }, [defaultAssignee, isAdmin, createForm.assigned_to])

  const createWorkOrderMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/work-orders', payload)
      return data
    },
    onSuccess: (created) => {
      setCreateBanner({ type: 'success', message: `Work order #${created?.id ?? ''} created.` })
      setCreateForm({ ...emptyCreateForm, assigned_to: defaultAssignee })
      refetch()
    },
    onError: (error) => {
      setCreateBanner({ type: 'error', message: error.response?.data?.error || 'Unable to create work order.' })
    }
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const response = await api.patch(`/work-orders/${id}`, payload)
      return response
    },
    onSuccess: (response, variables) => {
      const payload = variables?.payload || {}
      if (payload.status_note !== undefined) {
        setStatusNotes((prev) => ({ ...prev, [variables.id]: '' }))
      }
      if (payload.diagnostic_findings !== undefined) {
        setDiagnosticDraft((prev) => ({ ...prev, [variables.id]: payload.diagnostic_findings }))
      }
      if (response?.data?.offline) {
        setBanner('Offline changes queued and will sync when connectivity returns.')
      } else {
        setBanner(null)
        refetch()
      }
    }
  })

  const grouped = useMemo(() => {
    return data.reduce((acc, order) => {
      if (!acc[order.status]) acc[order.status] = []
      acc[order.status].push(order)
      return acc
    }, Object.fromEntries(statusOrder.map((status) => [status, []])))
  }, [data])

  const handleCreateWorkOrder = (event) => {
    event.preventDefault()
    if (!createForm.customer_name || !createForm.device_info) {
      setCreateBanner({ type: 'error', message: 'Customer name and device information are required.' })
      return
    }
    const payload = {
      customer_name: createForm.customer_name,
      device_info: createForm.device_info,
      device_serial: createForm.device_serial?.trim() ? createForm.device_serial.trim() : undefined,
      priority: createForm.priority,
      intake_notes: createForm.intake_notes?.trim() ? createForm.intake_notes.trim() : undefined
    }
    const assignedId = Number(createForm.assigned_to)
    if (isAdmin && Number.isInteger(assignedId) && assignedId > 0) {
      payload.assigned_to = assignedId
    }
    setCreateBanner(null)
    createWorkOrderMutation.mutate(payload)
  }

  const handleStatusSubmit = (order) => {
    if (!isAdmin) return
    const nextStatus = statusDraft[order.id] || order.status
    const note = statusNotes[order.id] || undefined
    updateMutation.mutate({ id: order.id, payload: { status: nextStatus, status_note: note } })
  }

  const handleDiagnosticsSave = (order) => {
    if (!isAdmin) return
    const draft = diagnosticDraft[order.id]
    if (draft === undefined || draft === order.diagnostic_findings) return
    updateMutation.mutate({ id: order.id, payload: { diagnostic_findings: draft } })
  }

  return (
    <div className="page">
    <div className="card">
      <div className="card__header">
        <div>
          <h2>{isAdmin ? 'Work orders' : 'My work orders'}</h2>
          <p className="muted">
            {isAdmin
              ? 'Track repairs from intake through completion, including SLA and warranty insights.'
              : 'View the repairs assigned to you and monitor progress across each stage.'}
          </p>
        </div>
        <button className="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {isAdmin && (
        <form className="form-grid form-grid--inline workorder-create" onSubmit={handleCreateWorkOrder}>
          <h3>Create work order</h3>
          {createBanner && (
            <div className={`banner banner--${createBanner.type || 'info'}`}>
              {createBanner.message}
            </div>
          )}
          <label className="field" data-help="Customer or account requesting service.">
            <span>Customer name</span>
            <input
              value={createForm.customer_name}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, customer_name: e.target.value }))}
              required
              placeholder="Acme Industries"
              list="workorder-customers"
            />
            {customerOptions.length > 0 && (
              <datalist id="workorder-customers">
                {customerOptions.map((customer) => (
                  <option key={customer.id ?? customer.name} value={customer.name}>
                    {customer.summary}
                  </option>
                ))}
              </datalist>
            )}
          </label>
          <label className="field" data-help="Describe the product received for repair.">
            <span>Device information</span>
            <input
              value={createForm.device_info}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, device_info: e.target.value }))}
              required
              placeholder="Model, asset tag or unit type"
            />
          </label>
          <label className="field" data-help="Optional serial or IMEI for tracking.">
            <span>Device serial</span>
            <input
              value={createForm.device_serial}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, device_serial: e.target.value }))}
              placeholder="Serial number (optional)"
            />
          </label>
          <label className="field" data-help="Helps the team triage urgent jobs first.">
            <span>Priority</span>
            <select
              value={createForm.priority}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, priority: e.target.value }))}
            >
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field" data-help="Assign the job to a technician.">
            <span>Assigned to</span>
            <select
              value={createForm.assigned_to}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
            >
              <option value="">Select teammate</option>
              {assignableUsers.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.full_name || account.email}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--span" data-help="Capture fault description, accessories and initial findings.">
            <span>Intake notes</span>
            <textarea
              rows={2}
              value={createForm.intake_notes}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, intake_notes: e.target.value }))}
              placeholder="Symptoms, accessories received, damage reports"
            />
          </label>
          <div className="form-actions">
            <button className="button button--primary" type="submit" disabled={createWorkOrderMutation.isLoading}>
              {createWorkOrderMutation.isLoading ? 'Creating…' : 'Create work order'}
            </button>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => {
                setCreateForm({ ...emptyCreateForm, assigned_to: defaultAssignee })
                setCreateBanner(null)
              }}
            >
              Clear
            </button>
          </div>
        </form>
      )}
      {banner && <div className="banner banner--warning">{banner}</div>}
        {isLoading && <p className="muted">Loading work orders…</p>}
        <div className="kanban">
          {statusOrder.map((status) => {
            const orders = grouped[status] || []
            return (
              <section className="kanban__column" key={status}>
                <header>
                  <p className="muted">{statusLabels[status] || status}</p>
                  <span className="badge badge--muted">{orders.length}</span>
                </header>
                <ul>
                  {orders.map((order) => {
                    const slaDue = order.sla_due_at ? new Date(order.sla_due_at) : null
                    const slaBreached = slaDue && slaDue.getTime() < Date.now() && !['completed', 'canceled'].includes(order.status)
                    const warrantyExpires = order.warranty_expires_at ? new Date(order.warranty_expires_at) : null
                    const serialAssignments = order.work_order_parts?.flatMap((part) => part.serial_assignments || part.serialAssignments || []) || []
                    const history = order.work_order_status_histories || order.workOrderStatusHistories || []
                    return (
                      <li key={order.id} className="kanban__card">
                        <div className="kanban__title">#{order.id} · {order.customer_name}</div>
                        <p className="muted">{order.device_info}</p>
                        <div className="workorder-meta">
                          <span className="badge">{priorityLabels[order.priority] || 'Normal'}</span>
                          {order.device_serial && <span className="badge badge--muted">SN {order.device_serial}</span>}
                          {isAdmin && order.assignee && (
                            <span className="badge badge--muted">
                              Assigned to {order.assignee.full_name || order.assignee.email}
                            </span>
                          )}
                          {!isAdmin && (
                            <span className="badge badge--info">Assigned to you</span>
                          )}
                          {slaDue && (
                            <span className={`badge ${slaBreached ? 'badge--danger' : 'badge--info'}`}>
                              SLA {slaBreached ? 'breached' : 'due'} {slaDue.toLocaleString()}
                            </span>
                          )}
                          {warrantyExpires && (
                            <span className="badge badge--success">Warranty {warrantyExpires.toLocaleDateString()}</span>
                          )}
                        </div>
                        {isAdmin ? (
                          <>
                            <div className="workorder-controls">
                              <label className="field" data-help="Set the current progress stage for this work order.">
                                <span>Status</span>
                                <select
                                  value={statusDraft[order.id] || order.status}
                                  onChange={(e) => setStatusDraft((prev) => ({ ...prev, [order.id]: e.target.value }))}
                                >
                                  {statusOrder.map((statusKey) => (
                                    <option key={statusKey} value={statusKey}>{statusLabels[statusKey]}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="field" data-help="Optional note shared with the team when applying the update.">
                                <span>Update note</span>
                                <input
                                  value={statusNotes[order.id] || ''}
                                  onChange={(e) => setStatusNotes((prev) => ({ ...prev, [order.id]: e.target.value }))}
                                  placeholder="Optional context"
                                />
                              </label>
                              <button
                                className="button button--small"
                                onClick={() => handleStatusSubmit(order)}
                                disabled={updateMutation.isLoading}
                              >
                                {updateMutation.isLoading ? 'Saving…' : 'Apply'}
                              </button>
                            </div>
                            <div className="workorder-diagnostics">
                              <label className="field" data-help="Record fault isolation and test results for future reference.">
                                <span>Diagnostics</span>
                                <textarea
                                  rows={3}
                                  value={diagnosticDraft[order.id] ?? order.diagnostic_findings ?? ''}
                                  onChange={(e) => setDiagnosticDraft((prev) => ({ ...prev, [order.id]: e.target.value }))}
                                  placeholder="Capture triage and troubleshooting notes"
                                />
                              </label>
                              <button
                                className="button button--ghost"
                                onClick={() => handleDiagnosticsSave(order)}
                                disabled={updateMutation.isLoading}
                              >
                                Save diagnostics
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="workorder-section">
                            <h4>Status</h4>
                            <p className="muted">{statusLabels[order.status] || order.status}</p>
                            {order.diagnostic_findings && (
                              <p className="muted">Diagnostics: {order.diagnostic_findings}</p>
                            )}
                          </div>
                        )}
                        <div className="workorder-section">
                          <h4>Parts</h4>
                          <ul className="kanban__parts">
                            {order.work_order_parts?.map((part) => (
                              <li key={part.id}>
                                <div>
                                  {part.qty_needed}× {part.product?.name || `SKU ${part.product?.sku ?? part.productId}`}
                                </div>
                                <div className="muted">
                                  {part.qty_reserved} reserved · {part.qty_picked} picked
                                </div>
                                <SerialList assignments={part.serial_assignments || part.serialAssignments} />
                              </li>
                            ))}
                            {(!order.work_order_parts || order.work_order_parts.length === 0) && (
                              <li className="muted">No parts assigned yet.</li>
                            )}
                          </ul>
                          {serialAssignments.length > 0 && (
                            <p className="muted">{serialAssignments.length} serialised units linked.</p>
                          )}
                        </div>
                        <div className="workorder-section">
                          <h4>Status history</h4>
                          <StatusHistory history={history} />
                        </div>
                      </li>
                    )
                  })}
                  {orders.length === 0 && <li className="muted">No work orders</li>}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
