# PostgreSQL Implementation Prompts — Opus 4.6 Agent Sessions

> **Instructions**: Execute these prompts **in order** (1→7). Each prompt is designed for a **fresh Opus 4.6 copilot agent session**. Copy-paste the entire prompt block into the chat. Each session builds on the previous one's committed code.
>
> **Before each session**: Ensure you're in the `claim-analytics-platform` workspace directory.
>
> **After each session**: Verify the build works (`npx vite build` in dashboard and app), then `git add -A && git commit` before moving to the next prompt.

---

## Prompt 1 — PostgreSQL Docker Setup + Database Schema + Migrations

```
I need you to set up PostgreSQL for the claim-analytics-platform project. The platform is at `claim-analytics-platform/` inside the workspace.

## Context

This is a litigation claim analytics platform with:
- Express server at `server/server.js` (port 3001)
- React frontend (Vite) at `app/` and `dashboard/`
- Python simulation engine at `engine/`
- Docker deployment at `deploy/` targeting Hetzner server
- Currently NO database — all data in localStorage + filesystem

## What to do

### 1. Update docker-compose.yml to add PostgreSQL service

Edit `deploy/docker-compose.yml` to add a PostgreSQL 16 container alongside the existing web service:

- Service name: `db`
- Image: `postgres:16-alpine` (lightweight, free)
- Volume: `pgdata:/var/lib/postgresql/data` for persistence
- Environment: Use env vars for POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
- Internal network only (not exposed to public) — only the `web` service connects to it
- Health check: `pg_isready`
- The `web` service should `depends_on: db` with condition `service_healthy`
- Add `DATABASE_URL` env var to web service pointing to the db service

### 2. Create database migration system

Create `server/db/` directory with:

**`server/db/pool.js`** — PostgreSQL connection pool using `pg` package:
- Read `DATABASE_URL` from environment (with fallback for local dev: `postgresql://cap_user:cap_dev_pass@localhost:5432/claim_analytics`)
- Pool size: min 2, max 10
- Connection timeout: 5000ms
- Idle timeout: 30000ms
- Export `pool` and a `query(text, params)` helper
- Add graceful shutdown on SIGTERM

**`server/db/migrate.js`** — Simple migration runner:
- Read SQL files from `server/db/migrations/` directory in alphabetical order
- Track applied migrations in a `_migrations` table
- Skip already-applied migrations
- Run as standalone: `node server/db/migrate.js`
- Log each migration applied
- Wrap each migration in a transaction

### 3. Create the initial migration

Create `server/db/migrations/001_initial_schema.sql` with these tables:

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh tokens (for JWT refresh flow)
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Workspaces (organizational unit per user)
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_workspaces_user ON workspaces(user_id);

-- Claims (individual litigation claims)
CREATE TABLE claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) DEFAULT '',
    claimant VARCHAR(255) DEFAULT '',
    respondent VARCHAR(255) DEFAULT '',
    jurisdiction VARCHAR(100) DEFAULT 'indian_domestic',
    claim_type VARCHAR(100) DEFAULT 'prolongation',
    soc_value_cr DECIMAL(15,4) DEFAULT 1000,
    currency VARCHAR(10) DEFAULT 'INR',
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'simulated', 'stale')),
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_claims_workspace ON claims(workspace_id);
CREATE INDEX idx_claims_user ON claims(user_id);

-- Portfolios (bundles of claims with structure config)
CREATE TABLE portfolios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) DEFAULT 'Untitled Portfolio',
    claim_ids UUID[] DEFAULT '{}',
    structure_type VARCHAR(100),
    structure_config JSONB DEFAULT '{}',
    simulation_config JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'running', 'completed', 'failed')),
    run_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_portfolios_workspace ON portfolios(workspace_id);
CREATE INDEX idx_portfolios_user ON portfolios(user_id);

-- Simulation runs (metadata — actual results stay on filesystem)
CREATE TABLE simulation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    portfolio_id UUID REFERENCES portfolios(id) ON DELETE SET NULL,
    claim_id UUID REFERENCES claims(id) ON DELETE SET NULL,
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('claim', 'portfolio', 'legacy')),
    structure_type VARCHAR(100),
    status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    config JSONB DEFAULT '{}',
    results_path VARCHAR(500),
    summary JSONB DEFAULT '{}',
    error_message TEXT,
    progress INTEGER DEFAULT 0,
    stage VARCHAR(255),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_runs_user ON simulation_runs(user_id);
CREATE INDEX idx_runs_status ON simulation_runs(status);
CREATE INDEX idx_runs_created ON simulation_runs(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_claims_updated BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_portfolios_updated BEFORE UPDATE ON portfolios FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4. Update server/package.json

Add `pg` dependency: `"pg": "^8.13.0"`

### 5. Update deploy/.env.example

Add database-related env vars:
```
DATABASE_URL=postgresql://cap_user:cap_secure_password@db:5432/claim_analytics
JWT_SECRET=change-me-to-a-long-random-string-min-64-chars
```

### 6. Update deploy/Dockerfile

Add a step to install `pg` native dependencies if needed (the `pg` npm package uses pure JS by default, so no extra OS packages needed, but verify the npm install includes it).

### 7. Add health check for DB in server.js

Update the `/api/health` endpoint to also check DB connectivity:
```js
app.get('/api/health', async (_req, res) => {
  const checks = { server: 'ok' };
  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }
  res.json({ status: checks.database === 'ok' ? 'ok' : 'degraded', ...checks, timestamp: new Date().toISOString() });
});
```

### 8. Create a local dev setup script

Create `server/db/setup-local.sh` (and `setup-local.ps1` for Windows) that:
- Checks if PostgreSQL is running locally (or via Docker)
- If not, runs: `docker run -d --name cap-postgres -p 5432:5432 -e POSTGRES_USER=cap_user -e POSTGRES_PASSWORD=cap_dev_pass -e POSTGRES_DB=claim_analytics postgres:16-alpine`
- Then runs migrations: `node server/db/migrate.js`

### 9. Add DB initialization to server startup

In `server/server.js`, import the pool and run a connection test on startup (non-blocking — server starts even if DB is temporarily unavailable, but logs a warning). Do NOT block server startup on DB — the simulation and static file serving should work without DB.

## Important constraints

- Do NOT modify any frontend code in this prompt
- Do NOT modify any existing route handlers (claims, simulate, results, etc.)
- Do NOT modify the simulation runner
- Only add DB infrastructure — the routes will be updated in later prompts
- The PostgreSQL setup must be FREE (Docker container, no managed DB services)
- Everything should work both locally (dev) and in the Docker deployment (production)
```

---

## Prompt 2 — Database Model Layer + Query Helpers

```
I need you to create the database model layer for the claim-analytics-platform. The database schema and connection pool were set up in a previous session.

## Context

The project is at `claim-analytics-platform/`. Key files already created:
- `server/db/pool.js` — PostgreSQL connection pool (exports `pool` and `query`)
- `server/db/migrations/001_initial_schema.sql` — Tables: users, refresh_tokens, workspaces, claims, portfolios, simulation_runs
- `server/package.json` — has `pg` dependency

## What to create

### 1. `server/db/models/User.js`

Database model for users table:

```js
// Methods needed:
findByEmail(email)        // → user row or null
findById(id)              // → user row or null (exclude password_hash)
create({ email, password_hash, full_name })  // → created user (no password_hash in return)
updateProfile(id, { full_name, email })       // → updated user
```

- All queries must be parameterized ($1, $2, etc.) — never interpolate values
- `create()` should return the user WITHOUT password_hash
- `findById()` should exclude password_hash from SELECT

### 2. `server/db/models/RefreshToken.js`

```js
create(userId, tokenHash, expiresAt)  // → token record
findByHash(tokenHash)                 // → token record with user_id, or null
deleteByHash(tokenHash)               // → void
deleteAllForUser(userId)              // → void (logout from all devices)
deleteExpired()                       // → count of deleted tokens
```

### 3. `server/db/models/Workspace.js`

```js
findAllByUser(userId)                 // → workspace[] ordered by created_at desc
findById(id, userId)                  // → workspace or null (user-scoped!)
create(userId, { name, description }) // → workspace
update(id, userId, { name, description }) // → workspace (user-scoped update)
delete(id, userId)                    // → boolean
```

CRITICAL: Every query MUST include `WHERE user_id = $userId` for data isolation.

### 4. `server/db/models/Claim.js`

The claims table has two kinds of columns:
- **Indexed columns** (top-level): id, workspace_id, user_id, name, claimant, respondent, jurisdiction, claim_type, soc_value_cr, currency, status
- **JSONB data column**: stores the full claim config blob (quantum, arbitration, timeline, legal_costs, interest, challenge_tree, etc.)

```js
findAllByWorkspace(workspaceId, userId)  // → claim[] for that workspace (user-scoped)
findById(id, userId)                     // → full claim or null
create(userId, workspaceId, claimData)   // → claim (extract indexed fields from claimData, rest goes into data JSONB)
update(id, userId, updates)              // → updated claim
delete(id, userId)                       // → boolean
updateStatus(id, userId, status)         // → updated claim (just status field)
```

When creating/updating, extract these from the incoming claim object into their own columns: name, claimant, respondent, jurisdiction, claim_type, soc_value_cr, currency, status. Everything else goes into the `data` JSONB column.

`findById` and `findAllByWorkspace` should reconstruct the full claim object by merging the indexed columns back into the data JSONB in the response. The caller sees a flat claim object like they do today from localStorage.

### 5. `server/db/models/Portfolio.js`

```js
findAllByWorkspace(workspaceId, userId)  // → portfolio[]
findById(id, userId)                     // → portfolio or null
create(userId, workspaceId, portfolioData) // → portfolio
update(id, userId, updates)              // → portfolio
delete(id, userId)                       // → boolean
updateRunId(id, userId, runId)           // → portfolio
updateStatus(id, userId, status)         // → portfolio
```

### 6. `server/db/models/SimulationRun.js`

```js
create(userId, { workspaceId, portfolioId, claimId, mode, structureType, config }) // → run record
updateStatus(id, { status, progress, stage, error_message, completed_at, results_path, summary }) // → run
findById(id, userId)                     // → run or null (user-scoped)
findAllByUser(userId, { limit, offset, status, structureType }) // → { runs, total } paginated
findByPortfolio(portfolioId, userId)     // → run[] for that portfolio
deleteOldRuns(userId, keepCount = 10)    // → count deleted (keeps newest N runs per user)
delete(id, userId)                       // → boolean
compare(id1, id2, userId)               // → { run1, run2 } (both must belong to user)
```

The `deleteOldRuns` method should:
- Count runs for the user
- If more than `keepCount`, delete the oldest ones (both DB record and filesystem directory at results_path)
- Return the count of deleted runs

### 7. `server/db/models/index.js`

Export all models from a single entry point:
```js
module.exports = { User, RefreshToken, Workspace, Claim, Portfolio, SimulationRun };
```

## Important constraints

- ALL queries must be parameterized (no string interpolation)
- ALL queries that return user data must be scoped by user_id
- Use `pool.query()` from `../pool.js`
- No ORMs — use raw SQL with the `pg` package
- Add JSDoc comments for each method with @param and @returns
- Handle errors gracefully — throw descriptive errors, never swallow them
- Do NOT modify any existing files except to add the new files
- Do NOT modify frontend code
```

---

## Prompt 3 — Server-Side Authentication (JWT + bcrypt + Middleware)

```
I need you to implement server-side authentication for the claim-analytics-platform. The database layer was already created.

## Context

The project is at `claim-analytics-platform/`. Existing infrastructure:
- `server/db/pool.js` — PostgreSQL connection pool
- `server/db/models/User.js` — findByEmail, findById, create, updateProfile
- `server/db/models/RefreshToken.js` — create, findByHash, deleteByHash, deleteAllForUser, deleteExpired
- `server/server.js` — Express app with CORS, routes for simulate, results, jurisdictions, claims, templates
- `app/src/store/authStore.js` — Current mock auth with client-side btoa() JWT generation

Currently ALL API routes are unprotected. The authStore generates fake JWTs client-side.

## What to implement

### 1. Install dependencies

Add to `server/package.json`:
- `bcrypt` (^5.1.0) — password hashing
- `jsonwebtoken` (^9.0.0) — JWT generation/verification
- `express-rate-limit` (^7.0.0) — rate limiting for auth endpoints
- `helmet` (^8.0.0) — security headers

Run `cd server && npm install bcrypt jsonwebtoken express-rate-limit helmet`

### 2. Create `server/middleware/auth.js`

JWT authentication middleware:

```js
// authenticateToken(req, res, next)
// - Extract Bearer token from Authorization header
// - Verify with jsonwebtoken using JWT_SECRET env var
// - On success: set req.user = { id, email, role } from JWT payload
// - On failure: return 401 { error: 'Authentication required' }
// - On expired: return 401 { error: 'Token expired' }

// optionalAuth(req, res, next)
// - Same as authenticateToken but doesn't fail on missing token
// - If token present and valid: sets req.user
// - If token missing: continues without req.user (req.user = null)
// - If token invalid/expired: return 401 (still fails on bad tokens)
```

JWT_SECRET should come from `process.env.JWT_SECRET`. If not set in dev, use a hardcoded dev-only fallback but log a WARNING.

### 3. Create `server/routes/auth.js`

Authentication API routes:

**POST `/api/auth/register`**
- Body: `{ email, password, full_name }`
- Validate: email format, password min 8 chars, full_name not empty
- Hash password with bcrypt (salt rounds = 12)
- Create user in DB via User.create()
- Generate access token (15 min expiry) and refresh token (7 days)
- Store refresh token hash in DB (hash the token before storing — never store raw)
- Set refresh token as HttpOnly cookie: `refreshToken`, path=/api/auth, HttpOnly, SameSite=Strict, Secure in production
- Return: `{ user: { id, email, full_name, role }, accessToken }`

**POST `/api/auth/login`**
- Body: `{ email, password }`
- Find user by email
- Compare password with bcrypt
- On match: generate access + refresh tokens (same as register)
- Set refresh token as HttpOnly cookie
- Return: `{ user: { id, email, full_name, role }, accessToken }`
- On fail: return 401 `{ error: 'Invalid email or password' }` (generic message — don't leak whether email exists)

**POST `/api/auth/refresh`**
- Read refresh token from HttpOnly cookie
- Hash it and look up in DB
- If valid and not expired: generate new access token + new refresh token
- Delete old refresh token, store new one
- Set new refresh token cookie
- Return: `{ accessToken }`
- If invalid/expired: clear cookie, return 401

**POST `/api/auth/logout`**
- Read refresh token from cookie
- Delete from DB
- Clear cookie
- Return: `{ message: 'Logged out' }`

**GET `/api/auth/me`** (requires auth middleware)
- Return current user profile from req.user.id via User.findById()
- Return: `{ user: { id, email, full_name, role, created_at } }`

**PUT `/api/auth/me`** (requires auth middleware)
- Body: `{ full_name, email }` (optional fields)
- Update user profile
- Return: `{ user: updated_user }`

### 4. JWT token generation helper

Create `server/utils/jwt.js`:
- `generateAccessToken(user)` — 15 min expiry, payload: `{ sub: user.id, email: user.email, role: user.role }`
- `generateRefreshToken()` — random 64-byte hex string (NOT a JWT — just a random opaque token)
- `verifyAccessToken(token)` — verify and decode
- Sign with HS256 algorithm using `JWT_SECRET`

### 5. Rate limiting

In `server/routes/auth.js`, apply rate limiters:
- Auth endpoints (login, register): 5 requests per minute per IP
- Refresh endpoint: 10 per minute per IP
- Use `express-rate-limit`

### 6. Update `server/server.js`

- Add `helmet()` middleware (before CORS)
- Add `cookie-parser` middleware (needed to read HttpOnly cookies) — add `cookie-parser` to package.json
- Register auth routes: `app.use('/api/auth', authRouter)`
- Import auth middleware but do NOT apply it globally yet — we'll protect individual routes in a later prompt
- Update CORS to include `credentials: true` option

### 7. Update `deploy/.env.example`

Add:
```
JWT_SECRET=generate-a-64-char-random-string-here
```

## Important constraints

- NEVER log passwords or tokens (even hashed)
- NEVER store plaintext refresh tokens in DB — always hash them
- bcrypt salt rounds must be >= 12
- JWT_SECRET minimum 64 characters in production
- Rate limiting must be per-IP, not global
- All error responses must be generic (don't reveal whether email exists, etc.)
- Do NOT modify frontend code yet — that comes in Prompt 6
- Do NOT protect existing routes yet — that comes in Prompt 7
- Password validation: minimum 8 characters
- Refresh token cookie: HttpOnly=true, SameSite=Strict, Secure=(NODE_ENV==='production'), path=/api/auth
```

---

## Prompt 4 — Claims & Portfolios DB Persistence + REST API

```
I need you to create full server-side CRUD APIs for claims and portfolios, backed by PostgreSQL. The database models and auth system were already set up.

## Context

The project is at `claim-analytics-platform/`. Already implemented:
- `server/db/models/Claim.js` — findAllByWorkspace, findById, create, update, delete, updateStatus
- `server/db/models/Portfolio.js` — findAllByWorkspace, findById, create, update, delete, updateRunId, updateStatus
- `server/db/models/Workspace.js` — findAllByUser, findById, create, update, delete
- `server/middleware/auth.js` — authenticateToken middleware (sets req.user = { id, email, role })
- `server/routes/auth.js` — register, login, refresh, logout, me
- `app/src/store/claimStore.js` — Current localStorage-based claim store with these claim fields:
  id, workspace_id, name, claimant, respondent, jurisdiction, claim_type, soc_value_cr, currency,
  claimant_share_pct, current_stage, perspective, description, status, arbitration, quantum,
  challenge_tree, timeline, legal_costs, interest, no_restart_mode, simulation_seed, n_simulations,
  created_at, updated_at
- `app/src/store/portfolioStore.js` — Current localStorage-based portfolio store with these fields:
  id, workspace_id, name, claim_ids[], structure, structure_config, simulation, status, run_id,
  created_at, updated_at

The current `server/routes/claims.js` is a stub that stores to filesystem. It needs to be completely rewritten.
The current `server/routes/portfolios.js` is just a comment placeholder. It needs full implementation.

## What to implement

### 1. Rewrite `server/routes/claims.js`

Protected routes (all require `authenticateToken` middleware):

**GET `/api/claims`**
- Query params: `workspace_id` (required)
- Returns all claims for the given workspace belonging to req.user
- Response: `{ claims: [...], total: N }`

**GET `/api/claims/:id`**
- Returns a single claim (user-scoped)
- The response should merge indexed columns + JSONB data into a flat object matching the current claimStore shape
- Response: `{ claim: {...} }`

**POST `/api/claims`**
- Body: full claim object (same shape as claimStore's createClaim output)
- Required: `workspace_id`
- Validates workspace belongs to user
- Creates claim in DB with user_id = req.user.id
- Response: `{ claim: {...} }` with 201 status

**PUT `/api/claims/:id`**
- Body: partial claim update object
- Updates claim in DB (user-scoped)
- If calc-relevant fields changed and status was 'simulated', set status to 'stale' (same logic as claimStore)
- Response: `{ claim: {...} }`

**DELETE `/api/claims/:id`**
- Deletes claim (user-scoped)
- Response: `{ deleted: true }`

**PUT `/api/claims/:id/status`**
- Body: `{ status: 'draft' | 'ready' | 'simulated' | 'stale' }`
- Quick status update without full payload
- Response: `{ claim: {...} }`

### 2. Implement `server/routes/portfolios.js`

Protected routes (all require `authenticateToken` middleware):

**GET `/api/portfolios`**
- Query params: `workspace_id` (required)
- Returns all portfolios for the workspace belonging to req.user
- Response: `{ portfolios: [...], total: N }`

**GET `/api/portfolios/:id`**
- Returns a single portfolio (user-scoped)
- Response: `{ portfolio: {...} }`

**POST `/api/portfolios`**
- Body: portfolio object
- Required: `workspace_id`
- Validates workspace belongs to user
- Creates portfolio in DB
- Response: `{ portfolio: {...} }` with 201

**PUT `/api/portfolios/:id`**
- Body: partial portfolio update
- Response: `{ portfolio: {...} }`

**DELETE `/api/portfolios/:id`**
- Deletes portfolio (user-scoped)
- Response: `{ deleted: true }`

**PUT `/api/portfolios/:id/claims`**
- Body: `{ claim_ids: [...] }` — replace the claim list
- Validates all claim_ids belong to user
- Response: `{ portfolio: {...} }`

**PUT `/api/portfolios/:id/structure`**
- Body: `{ structure_type, structure_config }`
- Response: `{ portfolio: {...} }`

### 3. Create `server/routes/workspaces.js`

Protected routes:

**GET `/api/workspaces`**
- Returns all workspaces for req.user
- Response: `{ workspaces: [...] }`

**POST `/api/workspaces`**
- Body: `{ name, description }`
- Creates workspace for req.user
- Response: `{ workspace: {...} }` with 201

**PUT `/api/workspaces/:id`**
- Body: `{ name, description }`
- Updates workspace (user-scoped)
- Response: `{ workspace: {...} }`

**DELETE `/api/workspaces/:id`**
- Deletes workspace and cascades to claims/portfolios (DB handles via ON DELETE CASCADE)
- Response: `{ deleted: true }`

### 4. Draft saving support

The claim and portfolio create/update endpoints already support `status: 'draft'`. But add this specific behavior:

- When creating a claim, default status = 'draft'
- A claim with status 'draft' represents saved inputs that haven't been simulated yet
- The PUT endpoint should accept partial updates (only the fields the user has filled in so far)
- No validation of required simulation fields when status = 'draft' (user is still filling in)
- Validation only when status is being changed to 'ready' or when submitting for simulation

### 5. Register new routes in server.js

Update `server/server.js`:
- Add `app.use('/api/workspaces', authenticateToken, workspacesRouter)`
- Add `app.use('/api/portfolios', authenticateToken, portfoliosRouter)`
- Replace the existing claims router: `app.use('/api/claims', authenticateToken, claimsRouter)`
- Keep the existing simulate, results, jurisdictions, templates routes unchanged for now

### 6. Input validation

For all create/update endpoints:
- Validate required fields
- Sanitize string inputs (trim whitespace)
- Validate types (numbers are numbers, arrays are arrays)
- Reject unknown fields (optional — at minimum, don't fail on them)
- Return 400 with clear error messages: `{ error: 'Validation failed', details: [{ field, message }] }`

## Important constraints

- Every DB query MUST include `user_id = req.user.id` for data isolation
- The claim API response shape must match what the frontend claimStore currently expects
- The portfolio API response shape must match what portfolioStore currently expects
- Do NOT modify frontend code yet — that comes in Prompt 6
- Do NOT modify the simulate routes yet — that comes in Prompt 5
- All routes must have proper error handling with try/catch
- Use `authenticateToken` middleware from `server/middleware/auth.js`
```

---

## Prompt 5 — Simulation Runs DB Integration + Save/Discard Flow

```
I need you to integrate simulation runs with the PostgreSQL database and implement save/discard logic. The auth system and claim/portfolio APIs are already working.

## Context

The project is at `claim-analytics-platform/`. Already implemented:
- `server/db/models/SimulationRun.js` — create, updateStatus, findById, findAllByUser, deleteOldRuns, etc.
- `server/middleware/auth.js` — authenticateToken (sets req.user)
- `server/routes/simulate.js` — Current simulation dispatch (no auth, no DB tracking, no user association)
- `server/services/simulationRunner.js` — Spawns Python subprocess, tracks status in-memory Map + status.json files, stores outputs at `server/runs/{uuid}/outputs/`

Current flow:
1. Frontend POSTs to `/api/simulate/claim` or `/api/simulate/portfolio`
2. Server calls `startRun(config, mode)` which creates `server/runs/{uuid}/`, writes config.json, spawns Python
3. Frontend polls `/api/status/{runId}` until completion
4. Frontend fetches `/api/results/{runId}/dashboard_data.json` etc.

No user association. No DB tracking. No save option. No cleanup.

## What to implement

### 1. Update `server/routes/simulate.js`

Apply `authenticateToken` middleware to the `POST /claim` and `POST /portfolio` endpoints (NOT the legacy POST / endpoint — keep that unprotected for backward compat).

After spawning the run, create a DB record:
```js
const dbRun = await SimulationRun.create(req.user.id, {
  workspaceId: req.body.workspace_id || null,
  portfolioId: req.body.portfolio_id || null,
  claimId: req.body.claim_id || null,
  mode,
  structureType: config.structure?.type,
  config: config,  // Store the full config in JSONB
});
```

The `runId` returned to the frontend should be the same UUID used for both the filesystem directory and the DB record. Coordinate this: have the DB create generate the UUID first, then pass it to `startRun()` as a pre-generated ID.

### 2. Update `server/services/simulationRunner.js`

**Modify `startRun()`** to accept an optional pre-generated `runId` parameter:
```js
function startRun(config, mode = 'portfolio', preGeneratedRunId = null) {
  const runId = preGeneratedRunId || uuidv4();
  // ... rest of existing logic
}
```

**Add a callback mechanism** for status updates. When the Python process completes or fails, update the DB record:
```js
// On completion:
await SimulationRun.updateStatus(runId, {
  status: 'completed',
  progress: 100,
  completed_at: new Date().toISOString(),
  results_path: `server/runs/${runId}/outputs`,
  summary: extractSummary(outputDir),  // Extract key KPIs from dashboard_data.json
});

// On failure:
await SimulationRun.updateStatus(runId, {
  status: 'failed',
  error_message: errorText,
  completed_at: new Date().toISOString(),
});
```

**Add `extractSummary(outputDir)` helper** that reads `dashboard_data.json` from the output directory and extracts:
```js
{
  structure_type,
  n_claims,
  n_simulations,
  portfolio_moic: data.portfolio_summary?.expected_moic,
  portfolio_irr: data.portfolio_summary?.expected_irr,
  total_investment: data.portfolio_summary?.total_investment_cr,
}
```
This goes into the DB `summary` JSONB column for quick display in run history without loading the full JSON.

### 3. Create `server/routes/runs.js` — User's Run History API

Protected routes (all require authenticateToken):

**GET `/api/runs`**
- Returns authenticated user's simulation runs (paginated)
- Query params: `limit` (default 20, max 100), `offset` (default 0), `status`, `structure_type`
- Response: `{ runs: [...], total, limit, offset }`
- Each run includes: id, mode, structure_type, status, summary, started_at, completed_at, created_at
- Sorted by created_at DESC

**GET `/api/runs/:id`**
- Returns a single run with full metadata (user-scoped)
- Include the list of available output files (from filesystem)
- Response: `{ run: {...}, files: [...] }`

**DELETE `/api/runs/:id`**
- Soft delete: mark as deleted in DB, remove filesystem outputs
- Or hard delete both
- User-scoped

**POST `/api/runs/:id/save`**
- Marks a run as "saved" (keep it — don't auto-delete)
- Body: `{ name: 'optional custom name' }`
- Response: `{ run: {...} }`

**POST `/api/runs/:id/discard`**
- User explicitly discards a run
- Delete the filesystem outputs directory
- Delete the DB record
- Response: `{ deleted: true }`

**GET `/api/runs/compare`**
- Query params: `ids=uuid1,uuid2`
- Returns both runs' summaries side by side (user-scoped)
- Response: `{ runs: [run1, run2] }`

### 4. Update status polling endpoint

Update `server/routes/results.js` GET `/api/status/:runId`:
- Try the in-memory Map first (existing behavior)
- If not found, fall back to DB lookup (SimulationRun.findById)
- This makes status survive server restarts

### 5. Auto-cleanup: Keep last 10 runs per user

Create a cleanup function that:
- After each successful simulation completion, count user's total runs
- If > 10 unsaved runs, delete the oldest ones (filesystem + DB)
- Saved/bookmarked runs are exempt from auto-cleanup
- Add a `saved` boolean column to simulation_runs table (create migration `002_add_saved_column.sql`)

Migration `server/db/migrations/002_add_saved_column.sql`:
```sql
ALTER TABLE simulation_runs ADD COLUMN saved BOOLEAN DEFAULT FALSE;
ALTER TABLE simulation_runs ADD COLUMN name VARCHAR(255);
```

### 6. Register routes in server.js

- Add `app.use('/api/runs', authenticateToken, runsRouter)`
- Keep the existing legacy `app.get('/api/runs', ...)` as a fallback for unauthenticated requests (or remove it if the new route covers it)

### 7. Update simulate routes to pass user context

The frontend will need to send `workspace_id`, `portfolio_id`, and `claim_id` in the simulation request body so the DB record can be linked. Update the POST handlers to accept and pass these through.

## Important constraints

- The filesystem run directory structure stays the same: `server/runs/{uuid}/outputs/`
- Do NOT namespace runs by user in the filesystem yet (keep flat UUIDs) — the DB handles ownership
- The status.json file should still be written for backward compatibility
- The in-memory Map status tracking should still work (fast polling during active run)
- DB updates happen async — they should not slow down the simulation
- Do NOT modify frontend code yet — that's Prompt 6
- The legacy POST /api/simulate endpoint remains unprotected (backward compat)
```

---

## Prompt 6 — Frontend Store Migration (localStorage → Server API)

```
I need you to migrate all frontend Zustand stores from localStorage to server API calls. The server now has full PostgreSQL-backed APIs for auth, workspaces, claims, portfolios, and runs.

## Context

The project is at `claim-analytics-platform/`. The server now provides these authenticated endpoints:

**Auth** (server/routes/auth.js):
- POST /api/auth/register → { user, accessToken }
- POST /api/auth/login → { user, accessToken } + HttpOnly refresh cookie
- POST /api/auth/refresh → { accessToken }
- POST /api/auth/logout
- GET /api/auth/me → { user }
- PUT /api/auth/me → { user }

**Workspaces** (server/routes/workspaces.js):
- GET /api/workspaces → { workspaces }
- POST /api/workspaces → { workspace }
- PUT /api/workspaces/:id → { workspace }
- DELETE /api/workspaces/:id

**Claims** (server/routes/claims.js):
- GET /api/claims?workspace_id=X → { claims, total }
- GET /api/claims/:id → { claim }
- POST /api/claims → { claim }
- PUT /api/claims/:id → { claim }
- DELETE /api/claims/:id

**Portfolios** (server/routes/portfolios.js):
- GET /api/portfolios?workspace_id=X → { portfolios, total }
- POST /api/portfolios → { portfolio }
- PUT /api/portfolios/:id → { portfolio }
- DELETE /api/portfolios/:id

**Runs** (server/routes/runs.js):
- GET /api/runs → { runs, total }
- GET /api/runs/:id → { run, files }
- POST /api/runs/:id/save
- POST /api/runs/:id/discard
- DELETE /api/runs/:id

**Simulate** (existing, now auth-protected):
- POST /api/simulate/claim → { runId, status }
- POST /api/simulate/portfolio → { runId, status }

Currently the frontend stores are:
- `app/src/store/authStore.js` — Mock JWT, localStorage key `cap_auth`
- `app/src/store/workspaceStore.js` — localStorage key `cap_workspaces`
- `app/src/store/claimStore.js` — localStorage key `cap_ws_{wsId}_claims`
- `app/src/store/portfolioStore.js` — localStorage key `cap_ws_{wsId}_portfolios`

All use `localStorage` for persistence. We need to change them to use the server API.

## What to implement

### 1. Create `app/src/services/api.js` — Centralized API client

```js
// Central API client with:
// - Base URL from env: VITE_API_URL (default: empty string for same-origin)
// - Access token stored in memory (module-level variable, NOT localStorage)
// - Automatic Authorization header attachment
// - 401 interceptor that attempts token refresh, then retries the request once
// - If refresh also fails, clear auth state and redirect to login
// - credentials: 'include' for all requests (to send HttpOnly cookies)
// - JSON content type by default

const API_BASE = import.meta.env.VITE_API_URL || '';
let accessToken = null;

export function setAccessToken(token) { accessToken = token; }
export function getAccessToken() { return accessToken; }
export function clearAccessToken() { accessToken = null; }

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  
  let res = await fetch(url, { ...options, headers, credentials: 'include' });
  
  // If 401 and we have a token, try refresh
  if (res.status === 401 && accessToken) {
    const refreshed = await refreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(url, { ...options, headers, credentials: 'include' });
    }
  }
  
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || 'Request failed', body.details);
  }
  
  return res.json();
}

// Export convenience methods
export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};
```

### 2. Rewrite `app/src/store/authStore.js`

Replace mock auth with real server auth:

```js
// State: { user, isAuthenticated, isLoading, error }
// No more token in state — stored in api.js module memory
// No more localStorage for auth

login: async (email, password) => {
  set({ isLoading: true, error: null });
  try {
    const { user, accessToken } = await api.post('/api/auth/login', { email, password });
    setAccessToken(accessToken);
    set({ user, isAuthenticated: true, isLoading: false });
  } catch (err) {
    set({ error: err.message, isLoading: false });
    throw err;
  }
},

register: async (email, password, full_name) => {
  // Similar to login
},

logout: async () => {
  try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
  clearAccessToken();
  // Clear ALL other stores (workspaces, claims, portfolios)
  set({ user: null, isAuthenticated: false });
},

// On app startup: try to restore session via refresh token
initAuth: async () => {
  set({ isLoading: true });
  try {
    const { accessToken } = await api.post('/api/auth/refresh');
    setAccessToken(accessToken);
    const { user } = await api.get('/api/auth/me');
    set({ user, isAuthenticated: true, isLoading: false });
  } catch {
    set({ isLoading: false }); // Not logged in, that's ok
  }
},
```

### 3. Rewrite `app/src/store/workspaceStore.js`

Replace localStorage with server API:

```js
// State: { workspaces, activeWorkspaceId, isLoading }
// On login: fetch workspaces from server
// On create/update/delete: call server API then update local state

fetchWorkspaces: async () => {
  set({ isLoading: true });
  const { workspaces } = await api.get('/api/workspaces');
  set({ workspaces, isLoading: false });
},

createWorkspace: async (name, description) => {
  const { workspace } = await api.post('/api/workspaces', { name, description });
  set(state => ({ workspaces: [...state.workspaces, workspace] }));
  return workspace;
},
// ... similar for update, delete
```

Keep `activeWorkspaceId` in localStorage (just the ID — it's a UI preference, not data).

### 4. Rewrite `app/src/store/claimStore.js`

Replace localStorage with server API:

```js
// State: { claims, activeClaim, isLoading }

loadClaims: async (wsId) => {
  set({ isLoading: true });
  const { claims } = await api.get(`/api/claims?workspace_id=${wsId}`);
  set({ claims, isLoading: false });
},

createClaim: async (wsId, jurisdiction, defaults) => {
  const claimData = { workspace_id: wsId, jurisdiction, status: 'draft', ...defaults };
  const { claim } = await api.post('/api/claims', claimData);
  set(state => ({ claims: [...state.claims, claim], activeClaim: claim }));
  return claim;
},

updateClaim: async (id, updates) => {
  const { claim } = await api.put(`/api/claims/${id}`, updates);
  set(state => ({
    claims: state.claims.map(c => c.id === id ? claim : c),
    activeClaim: state.activeClaim?.id === id ? claim : state.activeClaim,
  }));
  return claim;
},

deleteClaim: async (id) => {
  await api.delete(`/api/claims/${id}`);
  set(state => ({
    claims: state.claims.filter(c => c.id !== id),
    activeClaim: state.activeClaim?.id === id ? null : state.activeClaim,
  }));
},
```

### 5. Rewrite `app/src/store/portfolioStore.js`

Same pattern as claimStore — replace localStorage with server API calls.

### 6. Update simulation hooks

Update `app/src/hooks/useClaimSimulation.js` and `app/src/hooks/usePortfolio.js`:
- Add auth headers to fetch calls (use `api.post()` from api.js instead of raw `fetch()`)
- Pass `workspace_id` and `claim_id`/`portfolio_id` in the simulation request body
- After simulation completes, show a save/discard dialog

### 7. Add "Save/Discard Run" UX

After a simulation completes:
- Show a modal/toast: "Simulation complete! Save results?" with [Save] [Discard] buttons
- Save: POST `/api/runs/{runId}/save` with optional name
- Discard: POST `/api/runs/{runId}/discard`
- If user navigates away without choosing, the run auto-deletes after the 10-run limit is hit

### 8. Add "Run History" view

Create a simple component (can be minimal — just a list):
- Fetch GET `/api/runs` to show past runs
- Each entry: name/date, structure type, status, key KPIs from summary
- Click to reload dashboard with those results
- Delete button to remove old runs

### 9. Auto-save draft on navigation

When user is editing a claim or portfolio and navigates away:
- Check if there are unsaved changes
- If so, auto-save as draft: PUT `/api/claims/:id` with current form state
- Show brief toast: "Draft saved"
- This replaces the localStorage auto-persistence

### 10. Update App.jsx initialization

On app mount:
- Call `authStore.initAuth()` to check for existing session
- If authenticated, fetch workspaces
- Show loading spinner while checking auth
- If not authenticated, show login page

## Important constraints

- Remove ALL localStorage usage from stores (except activeWorkspaceId which is just a UI preference)
- Access token must be in-memory only (module variable in api.js), NEVER in localStorage
- Refresh token is HttpOnly cookie (managed by browser, invisible to JS)
- All API calls go through the centralized api.js client
- Handle loading states (isLoading) in all stores for good UX
- Handle errors gracefully — show error messages, don't crash
- On logout, clear all store state completely
- The migration should not break any existing component that reads from stores — the store interface (state shape + action names) should remain compatible where possible. When renaming is necessary, update all component references.
- If a store action was synchronous and is now async, update all calling components to handle the Promise
```

---

## Prompt 7 — Data Isolation Audit + Security Hardening

```
I need you to perform a comprehensive security audit and hardening of the claim-analytics-platform. Auth, DB persistence, and frontend integration are all working. This is the final step to ensure the platform is production-safe.

## Context

The project is at `claim-analytics-platform/`. All these are now implemented:
- PostgreSQL database with users, workspaces, claims, portfolios, simulation_runs tables
- JWT auth with bcrypt, refresh tokens, HttpOnly cookies
- Auth middleware on protected routes
- Claims/portfolios CRUD APIs with user_id scoping
- Simulation runs tracked in DB with user ownership
- Frontend stores use API instead of localStorage

## What to audit and fix

### 1. API Route Protection Audit

Check EVERY route in the server and verify it's properly protected:

| Route | Auth Required? | User Scoping? |
|-------|---------------|---------------|
| POST /api/auth/register | No | N/A |
| POST /api/auth/login | No | N/A |
| POST /api/auth/refresh | No (uses cookie) | N/A |
| POST /api/auth/logout | No (best effort) | N/A |
| GET /api/auth/me | YES | Own profile |
| PUT /api/auth/me | YES | Own profile |
| GET /api/workspaces | YES | user_id = req.user.id |
| POST /api/workspaces | YES | user_id = req.user.id |
| PUT /api/workspaces/:id | YES | user_id = req.user.id |
| DELETE /api/workspaces/:id | YES | user_id = req.user.id |
| GET /api/claims | YES | user_id = req.user.id |
| GET /api/claims/:id | YES | user_id = req.user.id |
| POST /api/claims | YES | user_id = req.user.id |
| PUT /api/claims/:id | YES | user_id = req.user.id |
| DELETE /api/claims/:id | YES | user_id = req.user.id |
| GET /api/portfolios | YES | user_id = req.user.id |
| POST /api/portfolios | YES | user_id = req.user.id |
| PUT /api/portfolios/:id | YES | user_id = req.user.id |
| DELETE /api/portfolios/:id | YES | user_id = req.user.id |
| GET /api/runs | YES | user_id = req.user.id |
| GET /api/runs/:id | YES | user_id = req.user.id |
| DELETE /api/runs/:id | YES | user_id = req.user.id |
| POST /api/runs/:id/save | YES | user_id = req.user.id |
| POST /api/runs/:id/discard | YES | user_id = req.user.id |
| POST /api/simulate/claim | YES | records user_id |
| POST /api/simulate/portfolio | YES | records user_id |
| POST /api/simulate (legacy) | NO | backward compat |
| GET /api/status/:runId | OPTIONAL | show status to owner only if auth present |
| GET /api/results/:runId/* | OPTIONAL | serve files — verify ownership if authenticated |
| GET /api/jurisdictions | NO | public reference data |
| GET /api/jurisdictions/:id | NO | public reference data |
| GET /api/templates | NO | public reference data |
| GET /api/defaults | NO | public reference data |
| GET /api/health | NO | monitoring |

For each route, read the actual code and:
1. Verify `authenticateToken` middleware is applied where needed
2. Verify DB queries include `user_id = req.user.id` WHERE clause
3. Verify no IDOR vulnerability (can't access another user's data by guessing UUID)

### 2. IDOR Protection on File Serving

The results routes (`GET /api/results/:runId/*`) serve files from `server/runs/{runId}/`.

Currently anyone who knows a runId can access the files. Fix this:
- If auth token is present: verify the run belongs to req.user via DB lookup
- If no auth token and legacy mode: allow (backward compat with existing runs)
- Cache the ownership check per request (don't query DB for every file in a session)

### 3. CORS Hardening

Review and update CORS configuration in `server/server.js`:
- Development: allow `http://localhost:*` (current behavior is fine)
- Production: Only allow the specific domain where the app is hosted
- Always include `credentials: true` in CORS config (needed for HttpOnly cookies)
- Verify `Access-Control-Allow-Credentials: true` header is sent

### 4. Security Headers via Helmet

Verify `helmet()` is applied and configured:
- Content Security Policy (CSP): allow inline scripts for Vite dev, restrict in production
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Remove X-Powered-By

### 5. Rate Limiting

Verify rate limiting is applied:
- Auth endpoints: 5/min per IP (already done in Prompt 3)
- Simulation endpoints: 10/min per user (prevent abuse)
- General API: 100/min per IP
- Return `429 Too Many Requests` with `Retry-After` header

Add rate limiting to simulation endpoints if not already present.

### 6. Input Sanitization

Review all POST/PUT endpoints for:
- SQL injection: All queries use parameterized queries ($1, $2) — verify no string concatenation
- XSS: Sanitize any user input that gets rendered (claim names, descriptions)
- Path traversal: Verify runId, claimId params are validated as UUIDs before filesystem access
- JSON size limits: Verify `express.json({ limit: '10mb' })` is reasonable

Add UUID format validation middleware for route params that should be UUIDs.

### 7. Refresh Token Security

Verify:
- Refresh tokens are hashed before DB storage (never stored raw)
- Expired tokens are cleaned up (add a periodic cleanup or clean on each refresh attempt)
- Token rotation: new refresh token on each use, old one deleted
- Maximum refresh tokens per user: 5 (prevent token accumulation from multiple devices)

### 8. Error Handling

Verify:
- No stack traces in production error responses
- Auth errors don't leak info (generic "Invalid credentials" not "User not found" vs "Wrong password")
- Database errors return 500 with generic message, details logged server-side only
- Unhandled promise rejections don't crash the server

### 9. Update deploy/.env.example

Ensure all required env vars are documented:
```
# Database
DATABASE_URL=postgresql://cap_user:CHANGE_ME@db:5432/claim_analytics

# Authentication
JWT_SECRET=CHANGE_ME_TO_64_RANDOM_CHARS

# Server
NODE_ENV=production
PORT=3001
ALLOWED_ORIGIN=https://your-domain.com

# Python engine
PYTHON_PATH=python3
```

### 10. Logout State Cleanup

Verify that on logout:
- All client-side state is cleared (workspaces, claims, portfolios, runs)
- Access token is cleared from memory
- Refresh token cookie is cleared
- User is redirected to login page
- Subsequent API calls fail with 401 (not cached stale data)

### 11. Update Dockerfile

If any new npm packages were added (helmet, express-rate-limit, etc.), verify the Dockerfile's `npm ci` step will pick them up. The Dockerfile copies package.json and runs npm ci, so it should work automatically.

## Output

After completing the audit, create/update a file `server/SECURITY_AUDIT.md` documenting:
- Each check performed
- Status: PASS / FAIL / FIXED
- Any remaining known issues or future improvements

## Important constraints

- Fix any issues you find — don't just document them
- Don't break existing functionality while hardening
- The legacy simulation endpoint must remain backward-compatible
- Jurisdiction and template endpoints remain public (no auth)
- Health endpoint remains public
```

---

## Post-Implementation Verification Prompt (Optional — Run After All 7 Are Done)

```
I need you to verify the complete PostgreSQL integration for the claim-analytics-platform is working end-to-end. All 7 implementation phases have been completed.

## What to verify

### 1. Database Setup
- Run `node server/db/migrate.js` — should apply all migrations successfully
- Check tables exist: users, refresh_tokens, workspaces, claims, portfolios, simulation_runs, _migrations

### 2. Server Startup
- Run `cd server && node server.js` — should start on port 3001
- Check `/api/health` returns database: 'ok'

### 3. Auth Flow
- Register: `curl -X POST http://localhost:3001/api/auth/register -H 'Content-Type: application/json' -d '{"email":"test@test.com","password":"testpass123","full_name":"Test User"}'`
- Login: Should return accessToken and set HttpOnly cookie
- Protected route: GET /api/workspaces with Authorization header succeeds
- Without token: GET /api/workspaces returns 401

### 4. CRUD Flow
- Create workspace → Create claim (draft) → Update claim → Create portfolio → Add claim to portfolio
- Verify all data persisted in PostgreSQL (not localStorage)

### 5. Simulation Flow
- Run a claim simulation with auth
- Verify DB record created in simulation_runs
- Verify status polling works
- Verify results accessible only to owner

### 6. Frontend Build
- `cd dashboard && npx vite build` — no errors
- `cd app && npx vite build` — no errors

### 7. Docker Build
- `docker compose -f deploy/docker-compose.yml build` — succeeds
- PostgreSQL service starts and is reachable from web service

Report any issues found and fix them.
```

---

## Quick Reference — Execution Checklist

- [ ] **Prompt 1**: PostgreSQL Docker + Schema + Migrations
- [ ] **Prompt 2**: Database Model Layer (6 model files)
- [ ] **Prompt 3**: Auth System (JWT + bcrypt + middleware)
- [ ] **Prompt 4**: Claims & Portfolios CRUD API
- [ ] **Prompt 5**: Simulation Runs DB + Save/Discard
- [ ] **Prompt 6**: Frontend Store Migration
- [ ] **Prompt 7**: Security Audit + Hardening
- [ ] **Verify**: End-to-end test
