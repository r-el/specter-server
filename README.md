# Specter Server (specter-server)

Application server and Anti-Corruption Layer (ACL) connecting clients to the Specter edge vision engine.

## Overview & Architecture

- **Runtime**: Node.js 22+, Express 5, ESM, TypeScript, tsyringe for dependency injection.
- **Data & Auth Ownership**:
  - **Supabase**: User accounts, credentials, and camera assignments.
  - **Specter**: Source of truth for vision entities (cameras, watchlists, targets, enrollments, vision alerts).
  - **NATS JetStream**: Real-time event subscription for camera status changes and alerts relayed via Socket.IO.
- **API Routing**: All application routes live under `/api` to avoid route collisions with frontend client-side paths.

---

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+
- Running Specter instance (or Docker base stack)

### Installation & Run

```bash
cd server
npm install

# Development (with watch and tsconfig path resolution)
npm run dev

# Typecheck and tests
npm run typecheck
npm run test

# Re-sync OpenAPI / JSONSchema contracts from Specter
npm run specter:contracts
```

---

## Configuration (`.env`)

See `.env.example` for the full reference. Key settings:

```env
# Server
PORT=12113
HOST=localhost
# Comma-separated frontend origins allowed to call this API.
ALLOWED_ORIGINS=http://localhost:5173

# Supabase (Auth & Users)
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_KEY=<your-anon-or-service-key>

# Specter Integration
SPECTER_API_URL=http://127.0.0.1:8000
SPECTER_API_TOKEN_FILE=../../deploy/secrets/api.token
SPECTER_NATS_URL=nats://127.0.0.1:4222
SPECTER_OWNER_ID=facealert

# Vector Database (Diagnostics)
QDRANT_URL=http://127.0.0.1:6333
```

> **Note**: In Docker production deployments, `SPECTER_API_TOKEN_FILE` is typically mounted at `/run/secrets/specter_api_token`.

---

## API Routes Overview

All routes are mounted under `/api`:

| Path                        | Description                                              | Access                    |
| --------------------------- | -------------------------------------------------------- | ------------------------- |
| `GET /api/health`           | Healthcheck and uptime                                   | Public                    |
| `/api/auth/*`               | Login, registration, token refresh                       | Public                    |
| `/api/users/*`              | User management and roles                                | Protected (Admin/Manager) |
| `/api/cameras/*`            | Camera CRUD, start/stop, status, live tickets            | Protected (Role/Assigned) |
| `/api/alerts/*`             | Vision alerts, filtering, acknowledge/resolve, snapshots | Protected                 |
| `/api/watchlists/*`         | Watchlist and target CRUD, photo uploads/previews        | Protected                 |
| `/api/enrollment-batches/*` | Reference photo enrollment status                        | Protected                 |
| `/api/dashboard/*`          | Summary metrics and statistics                           | Protected                 |

---

## Live Video & Realtime

- **Live Video**: Clients request a short-lived, single-use ticket via `/api/cameras/:id/live/ticket` and upgrade to WebSocket for low-latency MSE streaming (fallback to authenticated JPEG snapshot endpoint).
- **Socket.IO**: Real-time push notifications for camera status and vision alerts, scoped to authorized rooms.
