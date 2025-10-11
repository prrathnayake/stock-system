# Repair Center Stock System

A production-ready inventory, purchasing, and work-order platform tailored for device repair centers. The stack combines a hardened Express API with a responsive React dashboard so technicians, buyers, and managers share a single source of truth for parts, serials, RMAs, and invoicing.

## Key Capabilities
- **Inventory intelligence** – Track on-hand, reserved, and available quantities per bin with low-stock alerts and adjustment auditing.
- **Product catalogue management** – Create, update, archive, and search products with tenant-aware scoping and duplicate SKU protection.
- **Operational workflows** – Coordinate purchasing, serial tracking, RMAs, work orders, and invoicing from a unified interface.
- **Secure multi-tenant access** – JWT authentication, role-based permissions, rate limiting, and organization-aware data scoping.
- **Observability & resilience** – Structured logging, caching, backup scheduling, and queue-powered background jobs.

## Use Case Diagram
```mermaid
usecaseDiagram
  actor Admin as Admin
  actor Technician as Technician
  actor Buyer as Buyer
  actor Customer as Customer

  Admin --> (Configure Organization Profile)
  Admin --> (Manage Users)
  Admin --> (Manage Product Catalogue)
  Admin --> (Review System Backups)

  Technician --> (Search Inventory)
  Technician --> (Adjust Stock Levels)
  Technician --> (Reserve Serial Numbers)
  Technician --> (Process Work Orders)

  Buyer --> (Raise Purchase Orders)
  Buyer --> (Receive Stock)
  Buyer --> (Log Supplier RMAs)

  Customer --> (Receive Invoice)
  Customer --> (Approve Work Orders)

  (Manage Product Catalogue) ..> (Search Inventory) : «include»
  (Raise Purchase Orders) ..> (Receive Stock) : «extend»
```

## Architecture Overview
| Layer | Highlights |
| --- | --- |
| **Frontend (React + Vite)** | React Query for data caching, Axios interceptors for token refresh, socket-driven realtime updates, offline mutation queue, QR/barcode scanning, and modular UI variants per user. |
| **Backend (Express + Sequelize)** | Helmet, CORS, rate limiting, compression, async error handling, organization-aware ORM hooks, BullMQ queues, Redis cache, scheduled backups, and Socket.IO broadcasting. |
| **Data** | MySQL (or SQLite for testing) with scoped associations for products, stock levels, serials, work orders, invoices, suppliers, RMAs, and organizational settings. |
| **DevOps** | Docker Compose for local orchestration, production Dockerfiles, environment validation, and automated Vitest system coverage.

### API Surface
| Area | Routes |
| --- | --- |
| Authentication | `POST /auth/login`, `POST /auth/refresh` |
| Products | `GET /products`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` |
| Stock | `GET /stock`, `GET /stock/overview`, `POST /stock/move`, `GET /stock/:id/history` |
| Users & Organization | `/users`, `/organization`, `/backups`, `/settings`, `/work-orders`, `/serials`, `/purchasing`, `/rma`, `/invoices` |

## Getting Started
### Prerequisites
- Node.js 18+
- npm 9+
- MySQL 8.x (or Docker)
- Redis 6+
- Optional: Docker Compose for one-command provisioning

### Quick Start with Docker Compose
1. Copy environment templates:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
2. Launch the stack:
   ```bash
   docker compose up -d --build
   ```
3. Visit the services:
   - Dashboard: http://localhost:5173
   - API health: http://localhost:8080/health
   - MySQL: localhost:3307 (`root` / `rootpassword`)
   - Redis: localhost:6379

### Local Development
#### Backend
```bash
cd backend
npm install
npm run seed   # optional test fixtures
npm run dev
```
The API listens on `http://localhost:8080`.

#### Frontend
```bash
cd frontend
npm install
npm run dev
```
The Vite dev server hosts the dashboard at `http://localhost:5173` with live reload and proxying to the API.

### Running the Test Suite
From `backend/`:
```bash
npm test
```
The Vitest system test provisions an in-memory SQLite database, exercises authentication, product CRUD, stock adjustments, purchasing, RMAs, invoices, and produces `reports/system-test-report.json` summarising the run.

## Environment Configuration
### Backend
Create `backend/.env` (values shown are defaults):
```
PORT=8080
DB_DIALECT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=repair_center
DB_USER=appuser
DB_PASS=appsecret
JWT_SECRETS=dev
REFRESH_SECRETS=devrefresh
JWT_EXPIRES=15m
REFRESH_EXPIRES=7d
CORS_ORIGIN=http://localhost:5173
REDIS_URL=redis://127.0.0.1:6379
STOCK_OVERVIEW_CACHE_TTL=30
SERVE_FRONTEND=true
FRONTEND_DIST_PATH=../frontend/dist
BACKUP_ENABLED=false
BACKUP_SCHEDULE=0 3 * * *
BACKUP_DIRECTORY=backups
BACKUP_RETAIN_DAYS=14
UPLOADS_DIRECTORY=../uploads
UPLOADS_PUBLIC_PATH=/uploads
UPLOAD_MAX_FILE_SIZE=2mb
```

### Frontend
Create `frontend/.env`:
```
VITE_API_URL=http://localhost:8080
VITE_SOCKET_URL=http://localhost:8080
```

## Deployment Checklist
1. Prepare production bundles:
   ```bash
   (cd backend && npm install --production)
   (cd frontend && npm install && npm run build)
   ```
2. Set strong JWT/refresh secrets, database credentials, and enable HTTPS where required.
3. Configure automated backups (`BACKUP_ENABLED=true`) and update retention/schedule to match policy.
4. Provision monitoring (logs, metrics) and alerting for queue backlogs or low-stock events.
5. Run smoke tests and verify the `/health` endpoint before switching traffic.

## Operational Workflows
- **Product lifecycle** – Admins create products, technicians adjust stock, and archiving a product clears residual stock and hides it from catalogues while keeping audit trails.
- **Stock movements** – All adjustments record a `stock_move` entry with actor attribution and optional bin transfers.
- **Low stock alerts** – Background jobs emit events (and future email/SMS notifications) when `available <= reorder_point`.
- **Backup governance** – Administrators can trigger immediate backups and download archives from the dashboard.

## Project Structure
```
stock-system/
├── backend/         # Express API, queues, Sequelize models, Vitest system test
├── frontend/        # React dashboard (Vite), React Query data layer, UI components
├── docs/            # Feature audit and compliance placeholders
├── reports/         # Automated test reports
├── docker-compose.yml
└── README.md
```

## License
This project is released under the [MIT License](./LICENSE). Review the terms before production use.

