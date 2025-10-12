import React, { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../providers/AuthProvider.jsx'
import TablePagination from '../components/TablePagination.jsx'

const PAGE_SIZE = 10

export default function Operations() {
  const { user } = useAuth()
  const canManageProcurement = ['admin', 'user'].includes(user?.role)

  const stockQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data } = await api.get('/stock')
      return data
    }
  })
  const stock = stockQuery.data ?? []

  const serialsQuery = useQuery({
    queryKey: ['serials'],
    queryFn: async () => {
      const { data } = await api.get('/serials')
      return data
    }
  })
  const serials = serialsQuery.data ?? []

  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/suppliers')
      return data
    },
    enabled: canManageProcurement
  })
  const suppliers = suppliersQuery.data ?? []

  const purchaseOrdersQuery = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const { data } = await api.get('/purchasing/purchase-orders')
      return data
    },
    enabled: canManageProcurement
  })
  const purchaseOrders = purchaseOrdersQuery.data ?? []

  const rmaQuery = useQuery({
    queryKey: ['rma-cases'],
    queryFn: async () => {
      const { data } = await api.get('/rma')
      return data
    },
    enabled: canManageProcurement
  })
  const rmaCases = rmaQuery.data ?? []

  const lowStock = useMemo(
    () => stock.filter((item) => item.available <= (item.reorder_point ?? 0)),
    [stock]
  )

  const [serialsPage, setSerialsPage] = useState(1)
  const [purchaseOrdersPage, setPurchaseOrdersPage] = useState(1)
  const [rmaPage, setRmaPage] = useState(1)

  const serialsTotalPages = Math.max(1, Math.ceil(serials.length / PAGE_SIZE))
  const visibleSerials = useMemo(() => {
    const start = (serialsPage - 1) * PAGE_SIZE
    return serials.slice(start, start + PAGE_SIZE)
  }, [serials, serialsPage])

  const purchaseOrdersTotalPages = Math.max(1, Math.ceil(purchaseOrders.length / PAGE_SIZE))
  const visiblePurchaseOrders = useMemo(() => {
    const start = (purchaseOrdersPage - 1) * PAGE_SIZE
    return purchaseOrders.slice(start, start + PAGE_SIZE)
  }, [purchaseOrders, purchaseOrdersPage])

  const rmaTotalPages = Math.max(1, Math.ceil(rmaCases.length / PAGE_SIZE))
  const visibleRmas = useMemo(() => {
    const start = (rmaPage - 1) * PAGE_SIZE
    return rmaCases.slice(start, start + PAGE_SIZE)
  }, [rmaCases, rmaPage])

  useEffect(() => {
    if (serialsPage > serialsTotalPages) {
      setSerialsPage(serialsTotalPages)
    }
  }, [serialsPage, serialsTotalPages])

  useEffect(() => {
    if (purchaseOrdersPage > purchaseOrdersTotalPages) {
      setPurchaseOrdersPage(purchaseOrdersTotalPages)
    }
  }, [purchaseOrdersPage, purchaseOrdersTotalPages])

  useEffect(() => {
    if (rmaPage > rmaTotalPages) {
      setRmaPage(rmaTotalPages)
    }
  }, [rmaPage, rmaTotalPages])

  const procurementFetching = canManageProcurement && (
    purchaseOrdersQuery.isFetching ||
    rmaQuery.isFetching ||
    suppliersQuery.isFetching
  )

  const isRefreshing =
    stockQuery.isFetching ||
    serialsQuery.isFetching ||
    procurementFetching

  const handleRefresh = () => {
    stockQuery.refetch()
    serialsQuery.refetch()
    if (canManageProcurement) {
      purchaseOrdersQuery.refetch()
      rmaQuery.refetch()
      suppliersQuery.refetch()
    }
  }

  return (
    <div className="page operations-page">
      <div className="card operations__header">
        <div>
          <h2>Operations feed</h2>
          <p className="muted">Monitor low stock, serialised assets, purchasing and returns from one place.</p>
        </div>
        <button className="button" type="button" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="operations__grid">
        <section className="card operations__card" aria-labelledby="operations-low-stock">
          <h3 id="operations-low-stock">Low stock alerts</h3>
          <p className="muted">Products that are at or below their reorder point.</p>
          <ul className="timeline">
            {lowStock.length === 0 && <li className="muted">Everything looks healthy.</li>}
            {lowStock.map((item) => (
              <li key={item.id}>
                <div className="timeline__title">{item.name}</div>
                <div className="timeline__meta">
                  {item.available} available · reorder at {item.reorder_point}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card operations__card" aria-labelledby="operations-serials">
          <h3 id="operations-serials">Serialised inventory</h3>
          <p className="muted">Most recent serial numbers registered in the system.</p>
          <TablePagination
            page={serialsPage}
            totalPages={serialsTotalPages}
            onPrev={() => setSerialsPage((page) => Math.max(1, page - 1))}
            onNext={() => setSerialsPage((page) => Math.min(serialsTotalPages, page + 1))}
            className="table-pagination--inline"
          />
          <div className="table-scroll">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Branch location</th>
                </tr>
              </thead>
              <tbody>
                {visibleSerials.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">No serialised units recorded.</td>
                  </tr>
                )}
                {visibleSerials.map((serial) => (
                  <tr key={serial.id}>
                    <td><span className="badge badge--muted">{serial.serial}</span></td>
                    <td>{serial.product?.name || serial.productId}</td>
                    <td>
                      <span className={`badge badge--${serial.status === 'available' ? 'success' : serial.status === 'faulty' ? 'danger' : 'info'}`}>
                        {serial.status}
                      </span>
                    </td>
                    <td>{serial.bin?.code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={serialsPage}
            totalPages={serialsTotalPages}
            onPrev={() => setSerialsPage((page) => Math.max(1, page - 1))}
            onNext={() => setSerialsPage((page) => Math.min(serialsTotalPages, page + 1))}
          />
        </section>

        <section className="card operations__card" aria-labelledby="operations-suppliers">
          <h3 id="operations-suppliers">Supplies &amp; vendors</h3>
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
        </section>

        <section className="card operations__card" aria-labelledby="operations-pos">
          <h3 id="operations-pos">Purchase orders</h3>
          {canManageProcurement ? (
            <>
              <TablePagination
                page={purchaseOrdersPage}
                totalPages={purchaseOrdersTotalPages}
                onPrev={() => setPurchaseOrdersPage((page) => Math.max(1, page - 1))}
                onNext={() => setPurchaseOrdersPage((page) => Math.min(purchaseOrdersTotalPages, page + 1))}
                className="table-pagination--inline"
              />
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
                    {visiblePurchaseOrders.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">No purchase orders yet.</td>
                      </tr>
                    )}
                    {visiblePurchaseOrders.map((po) => (
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
              <TablePagination
                page={purchaseOrdersPage}
                totalPages={purchaseOrdersTotalPages}
                onPrev={() => setPurchaseOrdersPage((page) => Math.max(1, page - 1))}
                onNext={() => setPurchaseOrdersPage((page) => Math.min(purchaseOrdersTotalPages, page + 1))}
              />
            </>
          ) : (
            <p className="muted">Purchase orders are available to inventory coordinators.</p>
          )}
        </section>

        <section className="card operations__card" aria-labelledby="operations-rmas">
          <h3 id="operations-rmas">RMA cases</h3>
          {canManageProcurement ? (
            <>
              <TablePagination
                page={rmaPage}
                totalPages={rmaTotalPages}
                onPrev={() => setRmaPage((page) => Math.max(1, page - 1))}
                onNext={() => setRmaPage((page) => Math.min(rmaTotalPages, page + 1))}
                className="table-pagination--inline"
              />
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
                    {visibleRmas.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">No RMA activity.</td>
                      </tr>
                    )}
                    {visibleRmas.map((rma) => (
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
              <TablePagination
                page={rmaPage}
                totalPages={rmaTotalPages}
                onPrev={() => setRmaPage((page) => Math.max(1, page - 1))}
                onNext={() => setRmaPage((page) => Math.min(rmaTotalPages, page + 1))}
              />
            </>
          ) : (
            <p className="muted">RMA tracking is reserved for inventory leads.</p>
          )}
        </section>
      </div>
    </div>
  )
}
