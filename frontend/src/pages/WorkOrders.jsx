import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

const statusCopy = {
  intake: 'Intake',
  approved: 'Approved',
  in_progress: 'In progress',
  completed: 'Completed',
  canceled: 'Canceled'
}

export default function WorkOrders() {
  const statusOrder = Object.keys(statusCopy)
  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => {
      const { data } = await api.get('/work-orders')
      return data
    }
  })

  const grouped = useMemo(() => {
    return data.reduce((acc, order) => {
      if (!acc[order.status]) acc[order.status] = []
      acc[order.status].push(order)
      return acc
    }, Object.fromEntries(statusOrder.map((status) => [status, []])))
  }, [data, statusOrder])

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h2>Work orders</h2>
            <p className="muted">Track repairs from intake through completion.</p>
          </div>
          <button className="button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {isLoading && <p className="muted">Loading work orders…</p>}
        <div className="kanban">
          {statusOrder.map((status) => {
            const orders = grouped[status] || []
            return (
              <section className="kanban__column" key={status}>
                <header>
                  <p className="muted">{statusCopy[status] || status}</p>
                  <span className="badge badge--muted">{orders.length}</span>
                </header>
                <ul>
                  {orders.map((order) => (
                    <li key={order.id} className="kanban__card">
                      <p className="kanban__title">#{order.id} · {order.customer_name}</p>
                      <p className="muted">{order.device_info}</p>
                      <ul className="kanban__parts">
                        {order.work_order_parts?.map((part) => (
                          <li key={part.id}>
                            {part.qty_needed}× {part.product?.name || `SKU ${part.product?.sku ?? part.productId}`}
                            {part.qty_reserved > 0 && <span className="badge badge--success">{part.qty_reserved} reserved</span>}
                            {part.qty_picked > 0 && <span className="badge badge--info">{part.qty_picked} picked</span>}
                          </li>
                        ))}
                        {(!order.work_order_parts || order.work_order_parts.length === 0) && (
                          <li className="muted">No parts assigned yet.</li>
                        )}
                      </ul>
                    </li>
                  ))}
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
