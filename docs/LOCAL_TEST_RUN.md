# Local Test Run Notes

## Date
- Fri Oct 10 05:18:41 UTC 2025

## Steps Performed
1. Backend: `npm run dev` inside `backend/` – fails because Redis (127.0.0.1:6379) and MySQL host `mysql` were unavailable in the default `.env`.
2. Frontend: `npm run dev -- --host 0.0.0.0 --clearScreen false` inside `frontend/` – Vite served on http://localhost:5173/ and http://172.30.2.66:5173/.

## Notes
- To access the dashboard on port 5173 from outside Docker, include `--host 0.0.0.0` so Vite binds to all interfaces.
- Start Redis and MySQL (or use `docker compose up`) before launching the backend so that API and websocket features work.
