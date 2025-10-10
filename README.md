# Repair Center Stock System

A production-ready inventory and work-order management platform designed for repair centers. It ships with hardened APIs, a professional multi-page dashboard, live stock telemetry and scanning workflows.

## Architecture

- **Backend**: Node.js (Express + Sequelize + MySQL), JWT auth, Socket.IO, Zod validation, structured error handling.
- **Frontend**: React (Vite) with React Router, React Query, Axios interceptors, QR/Barcode scanning.
- **DevOps**: Docker Compose services, `.env` driven configuration, centralised logging.

## Getting Started

### With Docker

```bash
docker compose up -d --build
```

Services:
- Frontend: http://localhost:5173
- Backend: http://localhost:8080/health
- MySQL: localhost:3307 (root/rootpassword)

### Local Development

1. Provision a MySQL database (default schema `repair_center`).
2. Configure environment variables (see below) in `backend/.env` and `frontend/.env`.
3. Start the backend:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
4. Start the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

Login with the seeded credentials (development only): **admin@example.com / admin123**.

## Environment Variables

Create a `.env` file in `backend/` with:

```
PORT=8080
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=repair_center
DB_USER=appuser
DB_PASS=appsecret
JWT_SECRET=<change-me>
REFRESH_SECRET=<change-me-too>
CORS_ORIGIN=http://localhost:5173
```

In production you **must** set unique `JWT_SECRET` and `REFRESH_SECRET`; the server refuses to boot otherwise.

Frontend `.env`:

```
VITE_API_URL=http://localhost:8080
VITE_SOCKET_URL=http://localhost:8080
```

## Key Features

- Centralised Express app with rate limiting, Helmet, compression and structured error responses.
- Sequelize models with transactional stock movements and work-order part reservation workflows.
- Auth routes secured with JWTs, refresh token rotation and login throttling.
- `/stock/overview` endpoint powering dashboard KPIs, including recent activity feed.
- Responsive React UI with sidebar navigation, analytics dashboard, inventory explorer, Kanban-style work orders and scanning guide.
- Axios interceptor automatically refreshes access tokens when the refresh token is valid.
- `docs/LEGAL-REQUIREMENTS.md` placeholder for jurisdiction-specific legal documents.

## Testing & Quality

- Run `npm run build` in both `backend/` and `frontend/` to ensure production builds succeed.
- API input is validated with Zod schemas; unexpected errors bubble to a JSON error handler.
- Socket.IO broadcasts keep the dashboard in sync with stock changes.

## Deployment Checklist

- Replace all default secrets and database credentials.
- Configure HTTPS termination (e.g. via reverse proxy).
- Populate the legal/compliance documents inside the `docs/` directory.
- Add production-grade logging/monitoring (e.g. CloudWatch, ELK).

## Legal Notice

This repository ships with scaffolding only. Add your Terms of Service, Privacy Policy and any required consent forms before onboarding real customers.
