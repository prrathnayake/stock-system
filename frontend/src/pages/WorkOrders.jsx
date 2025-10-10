import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export default function WorkOrders() {
  const query = useQuery({
    queryKey: ['work-orders'],
    queryFn: async () => {
      const { data } = await api.get('/work-orders')
      return data
    }
  })

  return (
    <div className="container">
      <div className="card">
        <h2>Work Orders</h2>
        <table className="table">
          <thead><tr><th>ID</th><th>Customer</th><th>Device</th><th>Status</th></tr></thead>
          <tbody>
            {query.data?.map(w => (
              <tr key={w.id}>
                <td>#{w.id}</td>
                <td>{w.customer_name}</td>
                <td>{w.device_info}</td>
                <td><span className="badge">{w.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
