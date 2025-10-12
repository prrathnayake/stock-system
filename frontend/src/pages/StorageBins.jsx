import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../providers/AuthProvider.jsx'
import TablePagination from '../components/TablePagination.jsx'

const initialCreateForm = { code: '', site: '', room: '' }
const initialEditForm = { code: '', site: '', room: '', locationId: null }

export default function StorageBins() {
  const { organization } = useAuth()
  const queryClient = useQueryClient()
  const [createForm, setCreateForm] = useState(initialCreateForm)
  const [editForm, setEditForm] = useState(initialEditForm)
  const [editingId, setEditingId] = useState(null)
  const [tableFeedback, setTableFeedback] = useState(null)
  const [formFeedback, setFormFeedback] = useState(null)
  const [binPage, setBinPage] = useState(1)

  const binsQuery = useQuery({
    queryKey: ['bins'],
    queryFn: async () => {
      const { data } = await api.get('/bins')
      return data
    }
  })
  const bins = binsQuery.data ?? []

  const stockQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data } = await api.get('/stock')
      return data
    }
  })
  const stock = stockQuery.data ?? []

  const createBin = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/bins', payload)
      return data
    }
  })

  const updateBin = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.patch(`/bins/${id}`, payload)
      return data
    }
  })

  const deleteBin = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/bins/${id}`)
      return true
    }
  })

  const overview = useMemo(() => {
    const map = new Map()
    bins.forEach((bin) => {
      const locationParts = []
      if (bin.location?.site) locationParts.push(bin.location.site)
      if (bin.location?.room) locationParts.push(bin.location.room)
      map.set(bin.id, {
        id: bin.id,
        code: bin.code,
        location: locationParts.join(' · '),
        site: bin.location?.site || '',
        room: bin.location?.room || '',
        locationId: bin.location?.id ?? bin.location_id ?? null,
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
            site: '',
            room: '',
            locationId: null,
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

  const BINS_PAGE_SIZE = 10
  const totalBinPages = Math.max(1, Math.ceil(overview.length / BINS_PAGE_SIZE))
  const visibleBins = useMemo(() => {
    const start = (binPage - 1) * BINS_PAGE_SIZE
    return overview.slice(start, start + BINS_PAGE_SIZE)
  }, [overview, binPage])

  useEffect(() => {
    if (binPage > totalBinPages) {
      setBinPage(totalBinPages)
    }
  }, [binPage, totalBinPages])

  const isBusy = binsQuery.isFetching || stockQuery.isFetching

  const openEdit = (bin) => {
    setTableFeedback(null)
    setEditingId(bin.id)
    setEditForm({
      code: bin.code || '',
      site: bin.site || '',
      room: bin.room || '',
      locationId: bin.locationId ?? null
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm(initialEditForm)
  }

  const handleUpdateBin = (event) => {
    event.preventDefault()
    if (!editingId) return
    const code = editForm.code.trim()
    if (!code) {
      setTableFeedback({ type: 'error', message: 'Bin code is required.' })
      return
    }
    const payload = { code }
    const site = editForm.site.trim()
    const room = editForm.room.trim()
    if (site) {
      payload.location = { site }
      if (room) {
        payload.location.room = room
      }
    } else if (editForm.locationId) {
      payload.clear_location = true
    }
    updateBin.mutate({ id: editingId, payload }, {
      onSuccess: () => {
        setTableFeedback({ type: 'success', message: 'Branch location updated successfully.' })
        cancelEdit()
        queryClient.invalidateQueries({ queryKey: ['bins'] })
        queryClient.invalidateQueries({ queryKey: ['inventory'] })
      },
      onError: (error) => {
        setTableFeedback({
          type: 'error',
          message: error.response?.data?.error || 'Unable to update branch location.'
        })
      }
    })
  }

  const handleDeleteBin = (bin) => {
    if (typeof window !== 'undefined' && !window.confirm(`Remove bin ${bin.code}?`)) return
    setTableFeedback(null)
    deleteBin.mutate(bin.id, {
      onSuccess: () => {
        setTableFeedback({ type: 'success', message: 'Branch location removed.' })
        if (editingId === bin.id) {
          cancelEdit()
        }
        queryClient.invalidateQueries({ queryKey: ['bins'] })
        queryClient.invalidateQueries({ queryKey: ['inventory'] })
      },
      onError: (error) => {
        setTableFeedback({
          type: 'error',
          message: error.response?.data?.error || 'Unable to delete branch location.'
        })
      }
    })
  }

  const handleCreateBin = (event) => {
    event.preventDefault()
    const code = createForm.code.trim()
    if (!code) {
      setFormFeedback({ type: 'error', message: 'Bin code is required.' })
      return
    }
    const payload = { code }
    const site = createForm.site.trim()
    const room = createForm.room.trim()
    if (site) {
      payload.location = { site }
      if (room) {
        payload.location.room = room
      }
    }
    createBin.mutate(payload, {
      onSuccess: () => {
        setFormFeedback({ type: 'success', message: 'Branch location created successfully.' })
        setCreateForm(initialCreateForm)
        queryClient.invalidateQueries({ queryKey: ['bins'] })
        queryClient.invalidateQueries({ queryKey: ['inventory'] })
      },
      onError: (error) => {
        setFormFeedback({
          type: 'error',
          message: error.response?.data?.error || 'Unable to create branch location.'
        })
      }
    })
  }

  const organizationName = organization?.name || organization?.legal_name || 'your organization'

  return (
    <div className="page storage-bins">
      <div className="card storage-bins__intro">
        <div>
          <h2>Branch locations</h2>
          <p className="muted">Manage branch location codes and physical storage points for {organizationName}.</p>
        </div>
        <div className="storage-bins__status">
          <span className="badge badge--muted">{overview.length} locations</span>
          <button
            className="button button--ghost button--small"
            type="button"
            onClick={() => {
              binsQuery.refetch()
              stockQuery.refetch()
            }}
            disabled={isBusy}
          >
            {isBusy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid split storage-bins__layout">
        <section className="card storage-bins__table">
          <header className="card__header">
            <div>
              <h3>Registered branch locations</h3>
              <p className="muted">Track where critical inventory lives across your branch network.</p>
            </div>
          </header>
          {tableFeedback && (
            <div className={`banner banner--${tableFeedback.type === 'error' ? 'danger' : 'info'}`}>
              {tableFeedback.message}
            </div>
          )}
          <TablePagination
            page={binPage}
            totalPages={totalBinPages}
            onPrev={() => setBinPage((page) => Math.max(1, page - 1))}
            onNext={() => setBinPage((page) => Math.min(totalBinPages, page + 1))}
            className="table-pagination--inline"
          />
          <div className="table-scroll">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Branch code</th>
                  <th>Location</th>
                  <th>Products</th>
                  <th>On hand</th>
                  <th>Available</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {overview.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">No branch locations recorded yet.</td>
                  </tr>
                ) : (
                  visibleBins.map((bin) => (
                    <React.Fragment key={bin.id}>
                      <tr>
                        <td><span className="badge">{bin.code}</span></td>
                        <td>{bin.location || '—'}</td>
                        <td>{bin.productCount}</td>
                        <td>{bin.onHand}</td>
                        <td>{bin.available}</td>
                        <td>
                          <div className="table__actions">
                            <button
                              type="button"
                              className="button button--small"
                              onClick={() => openEdit(bin)}
                              disabled={updateBin.isLoading && editingId !== bin.id}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button button--small button--danger"
                              onClick={() => handleDeleteBin(bin)}
                              disabled={deleteBin.isLoading}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingId === bin.id && (
                        <tr className="storage-bins__edit-row">
                          <td colSpan={6}>
                            <form className="storage-bins__edit-form" onSubmit={handleUpdateBin}>
                              <div className="storage-bins__edit-grid">
                                <label className="field">
                                  <span>Location code</span>
                                  <input
                                    value={editForm.code}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, code: e.target.value }))}
                                    required
                                    disabled={updateBin.isLoading}
                                  />
                                </label>
                                <label className="field">
                                  <span>Location name</span>
                                  <input
                                    value={editForm.site}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, site: e.target.value }))}
                                    placeholder="Main warehouse"
                                    disabled={updateBin.isLoading}
                                  />
                                </label>
                                <label className="field">
                                  <span>Room / area</span>
                                  <input
                                    value={editForm.room}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, room: e.target.value }))}
                                    placeholder="Aisle 3"
                                    disabled={updateBin.isLoading}
                                  />
                                </label>
                              </div>
                              <div className="form-actions">
                                <button className="button button--primary" type="submit" disabled={updateBin.isLoading}>
                                  {updateBin.isLoading ? 'Saving…' : 'Save changes'}
                                </button>
                                <button
                                  className="button button--ghost button--small"
                                  type="button"
                                  onClick={cancelEdit}
                                  disabled={updateBin.isLoading}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={binPage}
            totalPages={totalBinPages}
            onPrev={() => setBinPage((page) => Math.max(1, page - 1))}
            onNext={() => setBinPage((page) => Math.min(totalBinPages, page + 1))}
          />
        </section>

        <form className="card storage-bins__form" onSubmit={handleCreateBin}>
          <h3>Create branch location</h3>
          <p className="muted">Give every branch location a clear identifier to make put-away and picking faster.</p>
          {formFeedback && (
            <div className={`banner banner--${formFeedback.type === 'error' ? 'danger' : 'info'}`}>
              {formFeedback.message}
            </div>
          )}
          <label className="field" data-help="Unique identifier used when allocating or picking stock.">
            <span>Location code</span>
            <input
              value={createForm.code}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, code: e.target.value }))}
              placeholder="e.g. A-01"
              required
            />
          </label>
          <label className="field" data-help="Optional location name to help your team locate the branch storage point.">
            <span>Location</span>
            <input
              value={createForm.site}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, site: e.target.value }))}
              placeholder="Main warehouse"
            />
          </label>
          <label className="field" data-help="Optional zone, aisle or room information.">
            <span>Room / area</span>
            <input
              value={createForm.room}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, room: e.target.value }))}
              placeholder="Aisle 3"
            />
          </label>
          <p className="muted field--span">Locations can be assigned to products later from the stock adjustment tools.</p>
          <div className="form-actions">
            <button className="button button--primary" type="submit" disabled={createBin.isLoading}>
              {createBin.isLoading ? 'Creating…' : 'Create location'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
