import React from 'react';
import { useAuth } from '../providers/AuthProvider.jsx';

export default function Settings() {
  const { user } = useAuth();

  return (
    <div className="page">
      <div className="card">
        <h2>Account</h2>
        <div className="details-grid">
          <div>
            <span className="muted">Name</span>
            <p>{user?.name || '—'}</p>
          </div>
          <div>
            <span className="muted">Email</span>
            <p>{user?.email || '—'}</p>
          </div>
          <div>
            <span className="muted">Role</span>
            <p className="badge badge--muted">{user?.role || 'team member'}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Deployment checklist</h2>
        <ul className="checklist">
          <li>
            <strong>Environment variables</strong>
            <p className="muted">Define secure JWT secrets, database credentials and the allowed CORS origin before going live.</p>
          </li>
          <li>
            <strong>Database backups</strong>
            <p className="muted">Schedule nightly backups of the MySQL database and verify the restoration procedure.</p>
          </li>
          <li>
            <strong>Access control</strong>
            <p className="muted">Provision accounts for staff using the admin console or SQL migrations.</p>
          </li>
          <li>
            <strong>Legal documents</strong>
            <p className="muted">Add your terms of service, privacy notice and any other required files to the repository.</p>
          </li>
        </ul>
      </div>
    </div>
  );
}
