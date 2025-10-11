# Stock Management System

A production-ready stock management platform built for multi-location repair and operations teams. It combines a hardened Express API with a responsive React dashboard so technicians, buyers, and managers share a single source of truth for products, customers, work orders, and invoicing. Dynamic organization branding flows through the UI, and workspace navigation adapts to the task at hand.

## Key Capabilities
- **Inventory intelligence** – Track on-hand, reserved, and available quantities per bin with low-stock alerts, adjustment auditing, and focused inventory versus bin workspaces.
- **Product catalogue management** – Create, update, archive, and search products with tenant-aware scoping and duplicate SKU protection.
- **Customer and sales flows** – Toggle between customer maintenance and sales fulfilment views without leaving the page, keeping context on the same data grid.
- **Operational workflows** – Coordinate purchasing, serial tracking, RMAs, work orders, and invoicing from a unified interface.
- **Dynamic organization branding** – Page headers, navigation labels, and contact information refresh instantly when organization settings change.
- **Secure multi-tenant access** – JWT authentication, role-based permissions, rate limiting, and organization-aware data scoping.
- **Observability & resilience** – Structured logging, caching, backup scheduling, email notifications, and queue-powered background jobs.

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
Copy `backend/.env.example` and adjust the values for your environment. Key entries include:
```
PORT=8080
DB_DIALECT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=repair_center
DB_USER=appuser
DB_PASS=appsecret
JWT_SECRETS=dev-secret
REFRESH_SECRETS=dev-refresh
JWT_EXPIRES=15m
REFRESH_EXPIRES=7d
CORS_ORIGIN=http://localhost:5173
REDIS_URL=redis://127.0.0.1:6379

# Mail transport
MAIL_ENABLED=false
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=mailer@example.com
MAIL_PASS=super-secret-password
MAIL_FROM=Stock System <no-reply@example.com>
MAIL_URL=
MAIL_TLS_REJECT_UNAUTHORIZED=true

# Frontend + uploads
SERVE_FRONTEND=true
FRONTEND_DIST_PATH=../frontend/dist
UPLOADS_DIRECTORY=../uploads
UPLOADS_PUBLIC_PATH=/uploads
UPLOAD_MAX_FILE_SIZE=5mb

# Backups
BACKUP_ENABLED=false
BACKUP_SCHEDULE=0 3 * * *
BACKUP_DIRECTORY=backups
BACKUP_RETAIN_DAYS=14

# Bootstrap defaults
DEFAULT_ORG_NAME=Default Organization
DEFAULT_ORG_LEGAL_NAME=Default Organization Pty Ltd
DEFAULT_ORG_CONTACT_EMAIL=operations@example.com
DEFAULT_ORG_TIMEZONE=Australia/Sydney
DEFAULT_ORG_ABN=12 345 678 901
DEFAULT_ORG_TAX_ID=
DEFAULT_ORG_ADDRESS=123 Example Street\nSydney NSW 2000
DEFAULT_ORG_PHONE=+61 2 1234 5678
DEFAULT_ORG_WEBSITE=https://example.com
DEFAULT_ORG_INVOICE_PREFIX=INV-
DEFAULT_ORG_PAYMENT_TERMS=Due within 14 days
DEFAULT_ORG_INVOICE_NOTES=Please remit payment within the agreed terms.
DEFAULT_ORG_CURRENCY=AUD
DEFAULT_ORG_INVOICING_ENABLED=true
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_NAME=Admin User
DEFAULT_ADMIN_PASSWORD=admin123
```

> **Email delivery.** Setting `MAIL_HOST` or `MAIL_URL` automatically enables outbound email even if `MAIL_ENABLED` is omitted. Explicitly set `MAIL_ENABLED=false` to suppress delivery in development.

### Frontend
Copy `frontend/.env.example` and update the API endpoints if required:
```
VITE_API_URL=http://localhost:8080
VITE_SOCKET_URL=http://localhost:8080
```

## UI Highlights
- **Organization-aware headers** – Dashboard and navigation copy react immediately to updates made in the organization settings.
- **Inventory sub-navigation** – Switch between active stock monitoring and storage bin administration without losing context.
- **Sales workspace tabs** – Jump between customer management and in-flight sales from the same route using quick toggle buttons.

## Email notifications
- Configure SMTP credentials in `backend/.env` using the `MAIL_*` variables. Providing `MAIL_HOST` or `MAIL_URL` automatically enables the transporter.
- System messages (user onboarding, inventory alerts, sale status changes) reuse a shared email service that now surfaces transporter errors in the Vitest suite (`backend/tests/email.test.js`).
- Setting `MAIL_ENABLED=true` without providing `MAIL_HOST` or `MAIL_URL` will log a configuration error and skip delivery so misconfigured environments fail loudly rather than silently.
- Leave `MAIL_ENABLED=false` in development to simulate sends without contacting your SMTP provider.

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

