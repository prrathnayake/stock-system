import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { io } from 'socket.io-client'

const socket = io(import.meta.env.VITE_SOCKET_URL)

export default function Dashboard() {
  const [sku, setSku] = useState('')
  const query = useQuery({
    queryKey: ['stock', sku],
    queryFn: async () => {
      const { data } = await api.get('/stock', { params: { sku: sku || undefined } })
      return data
    }
  })

  useEffect(() => {
    const handler = () => query.refetch()
    socket.on('stock:update', handler)
    return () => socket.off('stock:update', handler)
  }, [query])

  return (
    <div className="container">
      <div className="card">
        <h2>Stock Dashboard</h2>
        <div className="grid">
          <div>
            <label>Filter by SKU</label>
            <input placeholder="BATT-IPHONE" value={sku} onChange={e=>setSku(e.target.value)} />
          </div>
          <div><label>&nbsp;</label><button onClick={()=>query.refetch()}>Refresh</button></div>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>SKU</th><th>Name</th><th>On Hand</th><th>Reserved</th><th>Available</th></tr>
          </thead>
          <tbody>
            {query.data?.map(row => (
              <tr key={row.id}>
                <td><span className="badge">{row.sku}</span></td>
                <td>{row.name}</td>
                <td>{row.on_hand}</td>
                <td>{row.reserved}</td>
                <td><b>{row.available}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
