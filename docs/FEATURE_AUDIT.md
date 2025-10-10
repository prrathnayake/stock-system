# Repair Center Stock System – Capability Audit

This audit cross-checks the repository against the requested capabilities and highlights the highest-impact additions.

## Platform Capabilities

| Capability | Status | Evidence & Notes |
| --- | --- | --- |
| Real-time updates | ✅ Present | Socket.IO server broadcasts are wired into the API and routes, and the dashboard subscribes to `stock:update` events to refresh queries in real time.【F:backend/src/index.js†L1-L26】【F:backend/src/routes/stock.js†L173-L175】【F:backend/src/routes/workorders.js†L90-L134】【F:frontend/src/pages/Dashboard.jsx†L1-L158】 |
| Background jobs & queue | ✅ Present | BullMQ-backed low stock queue workers initialise on boot, enqueue scans after stock mutations, and broadcast alerts via Socket.IO.【F:backend/package.json†L1-L28】【F:backend/src/queues/lowStock.js†L1-L118】【F:backend/src/index.js†L1-L27】【F:backend/src/routes/workorders.js†L1-L220】【F:backend/src/routes/stock.js†L1-L220】 |
| Caching & pub/sub | ✅ Present | Redis now caches the stock overview response with automatic invalidation and reuse across WebSocket-triggered updates.【F:backend/src/config.js†L1-L26】【F:backend/src/redis/client.js†L1-L26】【F:backend/src/services/cache.js†L1-L28】【F:backend/src/routes/stock.js†L1-L220】 |
| Barcode / QR scanning | ✅ Present | The Scan page uses `@zxing/browser` to stream from the camera, decode barcodes, and show the latest result.【F:frontend/src/pages/Scan.jsx†L1-L52】 |
| Offline-first PWA | ✅ Present | The service worker precaches the shell and API GETs while an IndexedDB-backed queue stores mutations until connectivity is restored, letting technicians keep working offline.【F:frontend/public/sw.js†L1-L69】【F:frontend/src/lib/offlineQueue.js†L1-L75】【F:frontend/src/lib/api.js†L1-L83】【F:frontend/src/main.jsx†L1-L35】 |
| RBAC & permissions | ✅ Present | Middleware enforces JWT authentication with role checks, and sensitive routes restrict access to inventory/admin roles.【F:backend/src/middleware/auth.js†L1-L18】【F:backend/src/routes/products.js†L20-L36】【F:backend/src/routes/workorders.js†L28-L134】 |
| Audit trail | ✅ Present | All reserve, pick, return, and release flows persist `stock_moves` rows tied to work orders and the acting user, ensuring traceability for every unit movement.【F:backend/src/db.js†L1-L86】【F:backend/src/routes/workorders.js†L1-L220】【F:backend/src/routes/stock.js†L1-L220】 |
| Multi-location & bins | ✅ Present | The schema models locations, bins, and stock levels per bin, and API responses aggregate per-location inventory.【F:backend/src/db.js†L32-L82】【F:backend/src/routes/stock.js†L12-L58】 |
| Serial/IMEI tracking | ✅ Present | Dedicated serial number models, reservation assignments, and REST endpoints provide end-to-end traceability that surfaces in the inventory UI.【F:backend/src/db.js†L68-L149】【F:backend/src/routes/serials.js†L1-L94】【F:frontend/src/pages/Inventory.jsx†L1-L144】【F:frontend/src/pages/WorkOrders.jsx†L1-L214】 |
| Purchasing flow | ✅ Present | Suppliers, purchase orders, and receiving APIs update stock levels, emit stock moves, and surface in the operations dashboard for inventory managers.【F:backend/src/db.js†L151-L213】【F:backend/src/routes/purchasing.js†L1-L171】【F:frontend/src/pages/Inventory.jsx†L1-L144】 |
| Security hardening | ✅ Present | Optional TLS bootstrapping, rotating JWT/refresh secrets, and a scheduled backup service with admin download endpoints close the previous gaps in transport security, secret rotation, and disaster recovery.【F:backend/src/index.js†L1-L32】【F:backend/src/config.js†L1-L71】【F:backend/src/services/tokenService.js†L1-L52】【F:backend/src/services/backup.js†L1-L73】【F:backend/src/routes/backups.js†L1-L36】 |

## Repair Center Workflows

| Workflow | Status | Evidence & Notes |
| --- | --- | --- |
| Device intake & triage | ✅ Present | Multi-stage work order statuses, SLA timers, diagnostics, and admin-configurable thresholds streamline intake through completion.【F:backend/src/routes/workorders.js†L1-L257】【F:backend/src/services/settings.js†L1-L69】【F:frontend/src/pages/WorkOrders.jsx†L1-L214】【F:frontend/src/pages/Settings.jsx†L1-L155】 |
| Parts reservation | ✅ Present | `/work-orders/:id/reserve` locks stock rows and increments reserved quantities transactionally, broadcasting updates afterwards.【F:backend/src/routes/workorders.js†L45-L92】 |
| Pick/pack/return | ✅ Present | New return/release endpoint restores picked stock or releases reservations, completes audit logging, and triggers live dashboard updates.【F:backend/src/routes/workorders.js†L1-L220】【F:backend/src/queues/lowStock.js†L1-L118】【F:frontend/src/pages/Dashboard.jsx†L1-L160】 |
| RMA / faulty parts | ✅ Present | Faulty returns now create RMA cases linked to suppliers, serial numbers, and credits with live visibility in the inventory dashboard.【F:backend/src/db.js†L215-L252】【F:backend/src/routes/rma.js†L1-L113】【F:frontend/src/pages/Inventory.jsx†L1-L144】 |
| SLA & warranty | ✅ Present | Work orders track SLA deadlines, warranty expirations, and breach indicators that surface in the triage UI and admin settings.【F:backend/src/db.js†L39-L115】【F:backend/src/routes/workorders.js†L1-L257】【F:frontend/src/pages/WorkOrders.jsx†L1-L214】【F:frontend/src/pages/Settings.jsx†L1-L155】 |

## High-Impact Additions

1. **Add Redis-backed infrastructure**: Introduce Redis and BullMQ workers to deliver low-stock alerts, nightly reconciliations, and asynchronous imports, pairing the queue with publish/subscribe updates for cache invalidation and real-time fan-out beyond Socket.IO.【F:backend/package.json†L1-L27】【F:backend/src/routes/stock.js†L12-L176】 
2. **Strengthen observability**: Layer in structured logging, metrics, and alerting (e.g., OpenTelemetry, Prometheus, Sentry) so the richer workflows remain debuggable in production.【F:backend/src/app.js†L1-L41】【F:backend/src/routes/workorders.js†L1-L257】
3. **Automate supplier collaboration**: Extend purchasing and RMA flows with vendor notifications, expected-delivery tracking, and document uploads to close the loop with external partners.【F:backend/src/routes/purchasing.js†L1-L171】【F:backend/src/routes/rma.js†L1-L113】【F:frontend/src/pages/Inventory.jsx†L1-L144】
4. **Operational hardening**: Document and automate TLS termination, database backups, secret rotation, and runtime health monitoring to round out the platform’s reliability posture.【F:backend/src/config.js†L1-L30】【F:backend/src/startup/bootstrap.js†L5-L30】【F:frontend/src/pages/Settings.jsx†L1-L155】
6. **Operational hardening**: Document and automate TLS termination, database backups, secret rotation, and observability (structured logs, Sentry) to close the remaining security and reliability gaps.【F:backend/src/app.js†L1-L41】【F:backend/src/config.js†L1-L30】【F:frontend/src/pages/Settings.jsx†L27-L46】

## Next Steps for Admin Operations

- Add notification fan-out (email/SMS/Slack) that leverages the new settings to alert stakeholders when SLAs breach or low-stock thresholds fire.【F:backend/src/services/settings.js†L1-L69】【F:backend/src/queues/lowStock.js†L1-L118】
- Provide in-app audit dashboards summarising purchase receipts, RMA credits, and SLA performance using the extended data model.【F:backend/src/routes/purchasing.js†L1-L171】【F:backend/src/routes/rma.js†L1-L113】【F:frontend/src/pages/WorkOrders.jsx†L1-L214】
