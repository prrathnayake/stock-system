# Repair Center Stock System – Capability Audit

This audit cross-checks the repository against the requested capabilities and highlights the highest-impact additions.

## Platform Capabilities

| Capability | Status | Evidence & Notes |
| --- | --- | --- |
| Real-time updates | ✅ Present | Socket.IO server broadcasts are wired into the API and routes, and the dashboard subscribes to `stock:update` events to refresh queries in real time.【F:backend/src/index.js†L1-L26】【F:backend/src/routes/stock.js†L173-L175】【F:backend/src/routes/workorders.js†L90-L134】【F:frontend/src/pages/Dashboard.jsx†L1-L158】 |
| Background jobs & queue | ✅ Present | BullMQ-backed low stock queue workers initialise on boot, enqueue scans after stock mutations, and broadcast alerts via Socket.IO.【F:backend/package.json†L1-L28】【F:backend/src/queues/lowStock.js†L1-L118】【F:backend/src/index.js†L1-L27】【F:backend/src/routes/workorders.js†L1-L220】【F:backend/src/routes/stock.js†L1-L220】 |
| Caching & pub/sub | ✅ Present | Redis now caches the stock overview response with automatic invalidation and reuse across WebSocket-triggered updates.【F:backend/src/config.js†L1-L26】【F:backend/src/redis/client.js†L1-L26】【F:backend/src/services/cache.js†L1-L28】【F:backend/src/routes/stock.js†L1-L220】 |
| Barcode / QR scanning | ✅ Present | The Scan page uses `@zxing/browser` to stream from the camera, decode barcodes, and show the latest result.【F:frontend/src/pages/Scan.jsx†L1-L52】 |
| Offline-first PWA | ⚠️ Minimal | A very small service worker caches only the shell (`'/'`) and there is no IndexedDB or queued mutation support, so offline pick/pack is not yet functional.【F:frontend/public/sw.js†L1-L11】【F:frontend/package.json†L1-L26】 |
| RBAC & permissions | ✅ Present | Middleware enforces JWT authentication with role checks, and sensitive routes restrict access to inventory/admin roles.【F:backend/src/middleware/auth.js†L1-L18】【F:backend/src/routes/products.js†L20-L36】【F:backend/src/routes/workorders.js†L28-L134】 |
| Audit trail | ✅ Present | All reserve, pick, return, and release flows persist `stock_moves` rows tied to work orders and the acting user, ensuring traceability for every unit movement.【F:backend/src/db.js†L1-L86】【F:backend/src/routes/workorders.js†L1-L220】【F:backend/src/routes/stock.js†L1-L220】 |
| Multi-location & bins | ✅ Present | The schema models locations, bins, and stock levels per bin, and API responses aggregate per-location inventory.【F:backend/src/db.js†L32-L82】【F:backend/src/routes/stock.js†L12-L58】 |
| Serial/IMEI tracking | ❌ Missing | No serial/IMEI tables or endpoints exist in the data model; products only expose a `track_serial` flag with no supporting persistence.【F:backend/src/db.js†L21-L65】 |
| Purchasing flow | ❌ Missing | There are no supplier, PO, receiving, or cost-tracking models/endpoints implemented; the backend only wires auth, product, stock, and work-order routes.【F:backend/src/db.js†L21-L82】【F:backend/src/app.js†L33-L37】 |
| Security hardening | ⚠️ Partial | The API ships with Helmet, rate limiting, CORS, JWT access/refresh tokens, and bcrypt hashes, but there is no TLS guidance, secret rotation, or automated backups beyond documentation hints.【F:backend/src/app.js†L1-L41】【F:backend/src/config.js†L1-L30】【F:backend/src/startup/bootstrap.js†L5-L30】【F:frontend/src/pages/Settings.jsx†L1-L48】 |

## Repair Center Workflows

| Workflow | Status | Evidence & Notes |
| --- | --- | --- |
| Device intake & triage | ⚠️ Partial | Work orders capture customer/device info but lack status transitions or diagnostic/approval endpoints beyond the initial create flow.【F:backend/src/routes/workorders.js†L19-L43】【F:frontend/src/pages/WorkOrders.jsx†L1-L76】 |
| Parts reservation | ✅ Present | `/work-orders/:id/reserve` locks stock rows and increments reserved quantities transactionally, broadcasting updates afterwards.【F:backend/src/routes/workorders.js†L45-L92】 |
| Pick/pack/return | ✅ Present | New return/release endpoint restores picked stock or releases reservations, completes audit logging, and triggers live dashboard updates.【F:backend/src/routes/workorders.js†L1-L220】【F:backend/src/queues/lowStock.js†L1-L118】【F:frontend/src/pages/Dashboard.jsx†L1-L160】 |
| RMA / faulty parts | ❌ Missing | The schema and routes do not contain supplier return or credit tracking constructs.【F:backend/src/db.js†L21-L82】 |
| SLA & warranty | ❌ Missing | No SLA timers, warranty metadata, or alerts appear in the models, API, or UI components.【F:backend/src/db.js†L21-L82】【F:frontend/src/pages/Dashboard.jsx†L18-L158】 |

## High-Impact Additions

1. **Add Redis-backed infrastructure**: Introduce Redis and BullMQ workers to deliver low-stock alerts, nightly reconciliations, and asynchronous imports, pairing the queue with publish/subscribe updates for cache invalidation and real-time fan-out beyond Socket.IO.【F:backend/package.json†L1-L27】【F:backend/src/routes/stock.js†L12-L176】 
2. **Strengthen offline operations**: Replace the placeholder service worker with Workbox, add IndexedDB (e.g., Dexie) caches for stock/work order data, and sync queued mutations when connectivity returns so technicians can pick/pack offline.【F:frontend/public/sw.js†L1-L11】【F:frontend/package.json†L1-L26】 
3. **Complete the audit trail**: Persist `stock_moves` entries for reserve/pick/return flows and expose immutable audit views so every unit movement (including cancellations) is traceable.【F:backend/src/db.js†L49-L52】【F:backend/src/routes/workorders.js†L64-L135】 
4. **Extend data model coverage**: Implement serial/IMEI tracking tables, purchasing (suppliers, POs, receiving), and RMA workflows to support full repair-center lifecycle management.【F:backend/src/db.js†L21-L82】 
5. **Admin-configurable settings**: Expand the Settings page into an admin-only configuration screen (e.g., reorder thresholds, SLA targets, notification preferences) backed by secured API endpoints so administrators can manage optional features without code changes.【F:frontend/src/pages/Settings.jsx†L1-L48】 
6. **Operational hardening**: Document and automate TLS termination, database backups, secret rotation, and observability (structured logs, Sentry) to close the remaining security and reliability gaps.【F:backend/src/app.js†L1-L41】【F:backend/src/config.js†L1-L30】【F:frontend/src/pages/Settings.jsx†L27-L46】

## Next Steps for Optional Admin Settings

- Gate the Settings route behind an admin role check and fetch configurable options from a dedicated `/settings` API (persisted in MySQL or a config service).【F:frontend/src/pages/Settings.jsx†L1-L48】【F:backend/src/middleware/auth.js†L4-L18】
- Provide toggles/threshold inputs (e.g., low-stock email alerts, SLA hours) and persist them through validated mutations, ensuring changes trigger Socket.IO notifications or cache invalidation when relevant.【F:backend/src/routes/stock.js†L173-L175】【F:frontend/src/pages/Dashboard.jsx†L36-L46】
