# PostgreSQL Implementation Plan — Claim Analytics Platform

## Architecture Overview

### Current State
- **Auth**: Mock JWT via `btoa()` in `authStore.js` — client-side only
- **Data**: All claims/portfolios in `localStorage` — no server persistence
- **Simulation runs**: File-system only (`server/runs/{uuid}/`) with in-memory Map tracking
- **No database** — no ORM, no migrations, no data models

### Target State
- **PostgreSQL** on Hetzner server (Docker container, free)
- **Real JWT auth** with bcrypt + refresh tokens
- **Claims/portfolios persisted** in DB with user ownership
- **Draft saving** — auto-save incomplete work, resume later  
- **Simulation results** — metadata in DB, large JSON files on disk, last 10 runs retained per user
- **Full data isolation** between users

---

## Database Schema Design

```
┌──────────────────────┐
│       users          │
├──────────────────────┤
│ id (UUID, PK)        │
│ email (UNIQUE)       │
│ password_hash        │
│ full_name            │
│ role ('user'|'admin')│
│ created_at           │
│ updated_at           │
└──────────┬───────────┘
           │ 1:N
    ┌──────┴──────┐
    │             │
┌───▼──────┐  ┌──▼───────────┐
│workspaces│  │refresh_tokens│
├──────────┤  ├──────────────┤
│id (PK)   │  │id (PK)       │
│user_id   │  │user_id (FK)  │
│name      │  │token_hash    │
│desc      │  │expires_at    │
│created_at│  │created_at    │
│updated_at│  └──────────────┘
└────┬─────┘
     │ 1:N
  ┌──┴───┬────────────┐
  │      │            │
┌─▼────┐┌▼──────────┐┌▼──────────────┐
│claims││portfolios ││simulation_runs│
├──────┤├───────────┤├───────────────┤
│id    ││id         ││id             │
│wk_id ││wk_id      ││user_id        │
│usr_id││usr_id     ││portfolio_id?  │
│name  ││name       ││claim_id?      │
│data  ││claim_ids  ││structure_type │
│status││struct     ││status         │
│...   ││config     ││config (JSONB) │
│      ││status     ││results_path   │
│      ││run_id     ││error_message  │
│      ││...        ││started_at     │
│      ││           ││completed_at   │
│      ││           ││created_at     │
└──────┘└───────────┘└───────────────┘
```

---

## Implementation Prompts for Opus 4.6

### Execution Order (Critical Path)

```
Prompt 1: PostgreSQL + Docker Setup + Schema
    ↓
Prompt 2: Database Layer (Node.js — pg client + models)
    ↓
Prompt 3: Server-Side Auth (JWT + bcrypt + middleware)
    ↓
Prompt 4: Claims & Portfolios DB Persistence + API
    ↓
Prompt 5: Simulation Runs DB Integration + Save/Discard UX
    ↓
Prompt 6: Frontend Integration (stores → server API)
    ↓
Prompt 7: Data Isolation + Security Hardening
```

Each prompt is designed to be:
- **Self-contained** — can be executed in a fresh Opus 4.6 session
- **Under 192K context** — provides enough context without overload
- **Buildable** — produces working, testable output before moving to next prompt
- **Sequential** — each prompt builds on the previous one's output

---

## Prompt 1 — PostgreSQL Docker Setup + Schema Migration

**Purpose**: Get PostgreSQL running on Hetzner, create schema, update Docker deployment  
**Estimated context**: ~15K tokens  
**Output**: Working PostgreSQL container + migration files + updated docker-compose

---

## Prompt 2 — Database Access Layer (Node.js)

**Purpose**: Create `pg` connection pool, model files, and migration runner  
**Estimated context**: ~25K tokens  
**Output**: `server/db/` directory with pool, models, migrations

---

## Prompt 3 — Server-Side Authentication

**Purpose**: Replace mock auth with real JWT + bcrypt  
**Estimated context**: ~35K tokens  
**Output**: Auth routes, middleware, updated CORS/security

---

## Prompt 4 — Claims & Portfolios DB Persistence

**Purpose**: Migrate claims/portfolios from localStorage to PostgreSQL  
**Estimated context**: ~40K tokens  
**Output**: Full CRUD APIs with draft support

---

## Prompt 5 — Simulation Runs DB Integration

**Purpose**: Track runs in DB, save/discard UI flow, keep last 10 per user  
**Estimated context**: ~35K tokens  
**Output**: Run lifecycle in DB, cleanup logic

---

## Prompt 6 — Frontend Store Migration

**Purpose**: Rewire all Zustand stores from localStorage to server API  
**Estimated context**: ~45K tokens  
**Output**: Updated stores with API calls, loading states, error handling

---

## Prompt 7 — Data Isolation & Security

**Purpose**: Audit all endpoints for user scoping, add rate limiting, security headers  
**Estimated context**: ~30K tokens  
**Output**: Hardened API with IDOR protection, rate limits, helmet
