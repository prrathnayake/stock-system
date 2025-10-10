# Repair Center Stock System

A full-stack inventory and work-order management platform for device repair centers. The solution pairs a hardened Express API with a real-time, offline-capable React dashboard and can be deployed locally or in containers.

## Table of Contents
- [Architecture at a Glance](#architecture-at-a-glance)
  - [Backend (Node.js / Express)](#backend-nodejs--express)
  - [Frontend (React + Vite)](#frontend-react--vite)
  - [Infrastructure & Operations](#infrastructure--operations)
  - [Documentation](#documentation)
- [Getting Started](#getting-started)
  - [Quick Start with Docker](#quick-start-with-docker)
  - [Local Development](#local-development)
- [Environment Configuration](#environment-configuration)
  - [Backend `.env`](#backend-env)
  - [Frontend `.env`](#frontend-env)
- [Operational Workflows](#operational-workflows)
- [Quality Checks](#quality-checks)
- [Next Steps](#next-steps)

## Architecture at a Glance

### Backend (Node.js / Express)
- Secure Express application configured with Helmet, CORS, rate limiting, compression and structured error handling to keep APIs production-ready out of the box.
- Tenant-aware data model and request scoping provide isolation for multiple organizations sharing the same deployment.
- JWT-based authentication with rotating secrets, refresh token support, and role-aware route protection.
- Socket.IO server broadcasts live stock and work-order updates, while the API emits low-stock alerts from asynchronous queue workers.
- Redis-backed caching and BullMQ queue infrastructure drive fast dashboard responses and scheduled low-stock scans.
- Automated MySQL backups with configurable schedules and retention policies ensure disaster recovery coverage, with runtime controls exposed to administrators.

### Frontend (React + Vite)
- React 18 app bootstrapped with Vite and React Router, with React Query powering data fetching and caching.
- Auth provider and Axios interceptors coordinate token refresh, while failed mutations are queued offline in IndexedDB until connectivity is restored.
- Progressive Web App enhancements via a service worker deliver shell caching, API response caching, and background queue flushing on reconnect.
- Built-in QR/Barcode scanning workflow lets technicians scan parts directly from the browser.
- Admin console exposes organization-scoped settings, backup schedules and user management.

### Infrastructure & Operations
- `docker-compose.yml` provisions MySQL, Redis, backend, and frontend services with shared environment files and live-reload volume mounts for development.
- Backend and frontend images are also individually buildable through their respective `Dockerfile`s for production pipelines.

### Documentation
- `docs/FEATURE_AUDIT.md` summarises shipped capabilities and areas for future investment.
- `docs/LEGAL-REQUIREMENTS.md` is a placeholder for jurisdiction-specific compliance and customer-facing policies.

## Getting Started

### Quick Start with Docker
1. Create `backend/.env` and `frontend/.env` using the values in [Environment Configuration](#environment-configuration).
2. Build and start the full stack:
   ```bash
   docker compose up -d --build
   ```
3. Access the services:
   - Frontend: http://localhost:5173
   - Backend health check: http://localhost:8080/health
   - MySQL: `localhost:3307` (root/rootpassword)
   - Redis: `localhost:6379`

### Local Development

#### Backend
1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
2. Run database migrations/seed data if required:
   ```bash
   npm run seed
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

#### Frontend
1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```
2. Launch the Vite dev server:
   ```bash
   npm run dev
   ```
3. The dashboard runs at http://localhost:5173 with automatic token refresh and live updates when the backend is online.

Development credentials (for seed data): `admin@example.com / admin123`.

## Environment Configuration

### Backend `.env`
| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | API port | `8080` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASS` | MySQL connection settings | `127.0.0.1` / `3306` / `repair_center` / `appuser` / `appsecret` |
| `JWT_SECRETS` / `JWT_SECRET_IDS` | Comma-separated secrets & key IDs for signing access tokens | Falls back to `JWT_SECRET` or `dev` |
| `REFRESH_SECRETS` / `REFRESH_SECRET_IDS` | Secrets & key IDs for refresh token rotation | Falls back to `REFRESH_SECRET` or `devrefresh` |
| `JWT_EXPIRES` / `REFRESH_EXPIRES` | Token lifetimes | `15m` / `7d` |
| `CORS_ORIGIN` | Allowed frontend origin(s). Comma separate multiple values or use `*` to reflect any origin. | `http://localhost:5173` |
| `REDIS_URL` | Redis connection string | `redis://127.0.0.1:6379` |
| `STOCK_OVERVIEW_CACHE_TTL` | Cache duration (seconds) for stock overview API | `30` |
| `TLS_ENABLED` / `TLS_KEY_PATH` / `TLS_CERT_PATH` / `TLS_CA_PATH` | Optional HTTPS configuration | Disabled by default |
| `BACKUP_ENABLED` / `BACKUP_SCHEDULE` / `BACKUP_DIRECTORY` / `BACKUP_RETAIN_DAYS` | Automated backup toggle, cron schedule, storage directory, retention window | Disabled / `0 3 * * *` / `backups` / `14` |
| `SERVE_FRONTEND` | When not set to `false`, the API will serve the compiled frontend if the assets exist | `true` |
| `FRONTEND_DIST_PATH` | Override path to the compiled frontend assets served by the API | `../frontend/dist` |

Production deployments must supply non-default JWT and refresh secrets. TLS and backup settings are validated when `NODE_ENV=production`.

### Frontend `.env`
| Variable | Description | Example |
| --- | --- | --- |
| `VITE_API_URL` | Base URL for API requests | `http://localhost:8080` |
| `VITE_SOCKET_URL` | Socket.IO endpoint | `http://localhost:8080` |

## Operational Workflows
- **Real-time dashboard updates**: Stock and work-order routes emit Socket.IO events that keep dashboards synchronised without manual refresh.
- **Low-stock monitoring**: The BullMQ worker performs recurring stock scans and emits alerts when thresholds are breached.
- **Disaster recovery**: Scheduled MySQL dumps create rolling backups with automatic pruning based on retention rules. Backup cadence and retention can be tuned from the admin console without redeploying.
- **Offline-ready field operations**: Service worker caching and the offline request queue allow technicians to continue scanning and recording work even when connectivity is intermittent.

## Quality Checks
- Backend scripts: `npm run dev`, `npm start`, `npm run seed`
- Frontend scripts: `npm run dev`, `npm run build`, `npm run preview`

Run `npm run build` in both `backend/` and `frontend/` before deploying to verify production builds succeed.

## Next Steps
- Extend observability with structured logging, metrics, and alerting.
- Complete the legal and compliance documents in `docs/` before onboarding customers.
- Integrate notification channels (email/SMS/Slack) using the existing settings and queue infrastructure.
