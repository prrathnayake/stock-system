import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

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
  const [statusDraft, setStatusDraft] = useState({})
  const [statusNotes, setStatusNotes] = useState({})
  const [diagnosticDraft, setDiagnosticDraft] = useState({})
  const [banner, setBanner] = useState(null)

  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => {
      const { data } = await api.get('/work-orders')
      return data
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

  const handleStatusSubmit = (order) => {
    const nextStatus = statusDraft[order.id] || order.status
    const note = statusNotes[order.id] || undefined
    updateMutation.mutate({ id: order.id, payload: { status: nextStatus, status_note: note } })
  }

  const handleDiagnosticsSave = (order) => {
    const draft = diagnosticDraft[order.id]
    if (draft === undefined || draft === order.diagnostic_findings) return
    updateMutation.mutate({ id: order.id, payload: { diagnostic_findings: draft } })
  }

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h2>Work orders</h2>
            <p className="muted">Track repairs from intake through completion, including SLA and warranty insights.</p>
          </div>
          <button className="button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
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
                          {slaDue && (
                            <span className={`badge ${slaBreached ? 'badge--danger' : 'badge--info'}`}>
                              SLA {slaBreached ? 'breached' : 'due'} {slaDue.toLocaleString()}
                            </span>
                          )}
                          {warrantyExpires && (
                            <span className="badge badge--success">Warranty {warrantyExpires.toLocaleDateString()}</span>
                          )}
                        </div>
                        <div className="workorder-controls">
                          <label className="field">
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
                          <label className="field">
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
                          <label className="field">
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
