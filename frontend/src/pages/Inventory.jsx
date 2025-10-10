import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function Inventory() {
  const [query, setQuery] = useState('');
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ['inventory', query],
    queryFn: async () => {
      const { data } = await api.get('/stock', { params: { sku: query || undefined } });
      return data;
    }
  });

  const lowStock = useMemo(
    () => data.filter((row) => row.available <= (row.reorder_point ?? 0)),
    [data]
  );

  return (
    <div className="page">
      <div className="card">
        <div className="card__header">
          <div>
            <h2>Inventory catalogue</h2>
            <p className="muted">Search, filter and act on live stock data.</p>
          </div>
          <button className="button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="filter-grid">
          <label className="field">
            <span>Search by SKU or name</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex. BATT-IPHONE" />
          </label>
        </div>
      </div>

      <div className="grid two-columns">
        <div className="card">
          <h3>All products</h3>
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Lead time (days)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id}>
                  <td><span className="badge">{row.sku}</span></td>
                  <td>{row.name}</td>
                  <td>{row.on_hand}</td>
                  <td>{row.reserved}</td>
                  <td>{row.available}</td>
                  <td>{row.lead_time_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
      </div>
    </div>
  );
}
