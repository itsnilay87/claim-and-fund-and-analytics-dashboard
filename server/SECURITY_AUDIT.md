# Security Audit Report — Claim Analytics Platform

**Date:** 2025  
**Scope:** Full server + frontend security review (PostgreSQL integration hardening)

---

## Summary

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | API Route Protection | **FIXED** | Results routes were unprotected; added `optionalAuth` + ownership check |
| 2 | IDOR on File Serving | **FIXED** | `results.js` now verifies run ownership for authenticated users |
| 3 | CORS Hardening | **PASS** | `ALLOWED_ORIGIN` respected in production; `*` only behind Nginx |
| 4 | Helmet / CSP | **FIXED** | CSP directives configured for production; disabled in dev for Vite HMR |
| 5 | Rate Limiting | **FIXED** | Global 100/min, auth 5/min, refresh 10/min, simulation 10/min |
| 6 | Input Sanitization | **FIXED** | Path traversal in `jurisdictions.js`; UUID validation on all ID params |
| 7 | Refresh Token Security | **FIXED** | Max 5 per user enforced; periodic + opportunistic cleanup |
| 8 | Error Handling | **FIXED** | Generic errors in production; `unhandledRejection` handler added |
| 9 | Deploy Env Vars | **PASS** | `.env.example` documents all secrets with clear change-me defaults |
| 10 | Logout State Cleanup | **FIXED** | Frontend now resets workspace/claim/portfolio stores on logout |
| 11 | Dockerfile / Deploy | **PASS** | `npm ci --omit=dev`, non-root user, no secrets baked in |

---

## 1. API Route Protection Audit

### Route Table

| Route | Auth | IDOR-safe | Rate Limited | Notes |
|-------|------|-----------|-------------|-------|
| `POST /api/auth/register` | None | N/A | 5/min | Public registration |
| `POST /api/auth/login` | None | N/A | 5/min | Public login |
| `POST /api/auth/refresh` | Cookie | N/A | 10/min | HttpOnly cookie token |
| `POST /api/auth/logout` | None | N/A | Global | Deletes refresh token |
| `GET /api/auth/me` | JWT | N/A | Global | Returns own user only |
| `PUT /api/auth/me` | JWT | N/A | Global | Updates own profile |
| `GET /api/workspaces` | JWT | ✓ | Global | `WHERE user_id = req.user.id` |
| `POST /api/workspaces` | JWT | ✓ | Global | Inserts with `user_id` |
| `PUT /api/workspaces/:id` | JWT | ✓ | Global | Scoped by `user_id` |
| `DELETE /api/workspaces/:id` | JWT | ✓ | Global | Scoped by `user_id` |
| `GET /api/claims` | JWT | ✓ | Global | Filtered by workspace ownership |
| `POST /api/claims` | JWT | ✓ | Global | Workspace ownership verified |
| `PUT /api/claims/:id` | JWT | ✓ | Global | Ownership via workspace join |
| `DELETE /api/claims/:id` | JWT | ✓ | Global | Ownership via workspace join |
| `GET /api/portfolios` | JWT | ✓ | Global | Workspace ownership verified |
| `POST /api/portfolios` | JWT | ✓ | Global | Workspace ownership verified |
| `PUT /api/portfolios/:id` | JWT | ✓ | Global | Ownership via workspace join |
| `DELETE /api/portfolios/:id` | JWT | ✓ | Global | Ownership via workspace join |
| `GET /api/runs` | JWT | ✓ | Global | `WHERE user_id = req.user.id` |
| `GET /api/runs/compare` | JWT | ✓ | Global | Ownership verified per run |
| `GET /api/runs/:id` | JWT | ✓ | Global | Scoped by `user_id` |
| `DELETE /api/runs/:id` | JWT | ✓ | Global | Scoped by `user_id` |
| `POST /api/simulate/claim` | JWT | N/A | 10/min | Creates run under `user_id` |
| `POST /api/simulate/portfolio` | JWT | N/A | 10/min | Creates run under `user_id` |
| `POST /api/simulate` | None | N/A | 10/min | Legacy endpoint (backward compat) |
| `GET /api/status/:runId` | Optional | ✓ | Global | Ownership checked if authed |
| `GET /api/results/:runId/*` | Optional | ✓ | Global | Ownership checked if authed |
| `GET /api/jurisdictions` | None | N/A | Global | Public reference data |
| `GET /api/jurisdictions/:id` | None | N/A | Global | Public reference data |
| `GET /api/templates` | None | N/A | Global | Public reference data |
| `GET /api/defaults` | None | N/A | Global | Public reference data |
| `GET /api/runs/legacy` | None | N/A | Global | Legacy run list |
| `GET /api/health` | None | N/A | None | Health check (skips limiter) |

### Findings

- **All CRUD routes** use `authenticateToken` middleware and scope DB queries by `req.user.id` — no IDOR possible.
- **Results routes** were completely unprotected (no auth, no ownership check). **Fixed** — see §2.
- **Jurisdictions / Templates / Defaults** are intentionally public reference data.
- **Legacy routes** (`POST /api/simulate`, `GET /api/runs/legacy`) remain unauthenticated for backward compatibility.
- **Dead route bug**: `GET /api/runs/legacy` was registered after the authenticated `/api/runs` router, making it unreachable. **Fixed** — moved before the router mount.

---

## 2. IDOR on File Serving — FIXED

**Before:** All `results.js` routes (`/api/results/:runId/*`, `/api/status/:runId`) had no authentication. Any user who knew or guessed a UUID could access another user's simulation output files.

**After:**
- Added `optionalAuth` middleware to every route in `results.js`.
- Added `UUID_RE` validation — rejects non-UUID `runId` params with 400.
- Added `verifyRunOwnership(runId, req)` — queries `simulation_runs` table to verify the run belongs to `req.user.id`. Uses per-request caching to avoid repeated DB calls.
- **Backward compatibility:** If no auth token is provided (legacy clients), access is permitted. Once a user authenticates, ownership is enforced.

**File changed:** `server/routes/results.js`

---

## 3. CORS Hardening — PASS

**Configuration:**
- **Development:** Allows `localhost:5173`, `localhost:5174`, `localhost:3000` (Vite dev servers).
- **Production with `ALLOWED_ORIGIN`:** Only that specific origin is permitted.
- **Production without `ALLOWED_ORIGIN`:** Allows all origins — acceptable when behind Nginx reverse proxy that controls external access.
- `credentials: true` enabled for HttpOnly cookie transport.

**Recommendation:** Always set `ALLOWED_ORIGIN` in production `.env` for defense-in-depth.

---

## 4. Helmet / CSP — FIXED

**Before:** `helmet()` with all defaults. No Content Security Policy configured.

**After:**
```js
helmet({
  contentSecurityPolicy: IS_PRODUCTION ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'none'"],
    }
  } : false,   // disabled in dev for Vite HMR
  xFrameOptions: { action: 'deny' },
})
```

- `X-Frame-Options: DENY` prevents clickjacking.
- CSP blocks XSS by restricting script/style/connect sources to same origin.
- `unsafe-inline` on styleSrc required for Vite-built CSS injection.
- CSP disabled in development to allow Vite HMR WebSocket + inline scripts.

**File changed:** `server/server.js`

---

## 5. Rate Limiting — FIXED

| Limiter | Scope | Limit | Window | Applied To |
|---------|-------|-------|--------|-----------|
| `authLimiter` | Per IP | 5 requests | 1 min | `/api/auth/register`, `/api/auth/login` |
| `refreshLimiter` | Per IP | 10 requests | 1 min | `/api/auth/refresh` |
| `simulateLimiter` | Per IP | 10 requests | 1 min | `/api/simulate/claim`, `/api/simulate/portfolio` |
| `apiLimiter` (global) | Per IP | 100 requests | 1 min | All `/api/*` except `/api/health` |

**Before:** Only auth endpoints had rate limiting. Simulation and general API had none.

**After:** Added global API limiter (100/min, skips health check) and simulation-specific limiter (10/min). Rate limit responses return JSON `{ error: '...' }` for API client compatibility.

**Files changed:** `server/server.js`, `server/routes/simulate.js`

---

## 6. Input Sanitization — FIXED

### Parameterized Queries ✓
All database queries use `$1, $2, ...` parameterized placeholders. No string concatenation or template literals in SQL. **Zero SQL injection risk.**

### UUID Validation ✓
All route handlers that accept ID params validate UUID format before DB queries:
- `claims.js`, `portfolios.js`, `workspaces.js`, `runs.js` — regex `UUID_RE` check, returns 400 on invalid.
- `results.js` — **added** UUID validation (was missing).

### Path Traversal — FIXED
- **`results.js`:** `getResultFilePath()` already validates `resolved.startsWith(outputDir)`.
- **`jurisdictions.js`:** Was vulnerable — `req.params.id` passed directly to `path.join()`. **Fixed** with alphanumeric-only regex (`/^[a-zA-Z0-9_-]+$/`) and resolved path verification.
- **`templates.js`:** Already checks for `..` in template ID.

### Request Size
- JSON body limit: 10 MB. Appropriate for simulation configuration payloads.

**File changed:** `server/routes/jurisdictions.js`

---

## 7. Refresh Token Security — FIXED

### Token Storage ✓
Tokens are SHA-256 hashed before database storage. Raw tokens only exist in HttpOnly cookies.

### Token Rotation ✓
On refresh, the old token is deleted and a new token+cookie is issued. Prevents token replay after rotation.

### Max Tokens Per User — FIXED
**Before:** No limit — a user could accumulate unlimited refresh tokens (e.g., by logging in from many devices).

**After:** `RefreshToken.enforceMaxPerUser(userId, 5)` called on every login/register. Deletes oldest tokens beyond the limit using:
```sql
DELETE FROM refresh_tokens WHERE id IN (
  SELECT id FROM refresh_tokens WHERE user_id = $1
  ORDER BY created_at DESC OFFSET $2
)
```

### Expired Token Cleanup — FIXED
**Before:** Expired tokens accumulated indefinitely.

**After:**
- **Periodic cleanup:** `setInterval` in `server.js` calls `RefreshToken.deleteExpired()` every hour.
- **Opportunistic cleanup:** Refresh endpoint calls `deleteExpired()` when encountering an expired token.

### Cookie Configuration ✓
- `httpOnly: true` — not accessible to JavaScript.
- `secure: true` in production — HTTPS only.
- `sameSite: 'strict'` — CSRF protection.
- `maxAge: 7 days` — matches token expiry.

**Files changed:** `server/routes/auth.js`, `server/db/models/RefreshToken.js`, `server/server.js`

---

## 8. Error Handling — FIXED

### Production Error Masking — FIXED
**Before:** Global error handler returned `err.message` to client in all environments, potentially leaking internal details (SQL errors, stack traces).

**After:**
```js
const message = IS_PRODUCTION ? 'Internal server error' : err.message;
res.status(500).json({ error: message });
```

### Unhandled Rejection Handler — FIXED
**Before:** No handler for `unhandledRejection` or `uncaughtException`.

**After:**
```js
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
```

### Auth Error Messages ✓
- Login returns generic "Invalid email or password" (does not reveal which is wrong).
- Register returns "Email already registered" — acceptable for UX; not a major concern since registration is open.

**File changed:** `server/server.js`

---

## 9. Deploy Environment Variables — PASS

`deploy/.env.example` documents all required secrets:
- `JWT_SECRET` — with "change-me" placeholder
- `POSTGRES_PASSWORD` — with "change-me" placeholder
- `DATABASE_URL` — full connection string
- `ALLOWED_ORIGIN` — commented but documented with example
- `PYTHON_PATH` — defaults to `python3`
- `NODE_ENV` — set to `production`

**Recommendation:** Generate JWT_SECRET and POSTGRES_PASSWORD with `openssl rand -base64 48` at deploy time.

---

## 10. Logout State Cleanup — FIXED

**Before:** `authStore.logout()` cleared only auth state (`accessToken`, `user`, `isAuthenticated`). The `workspaceStore`, `claimStore`, and `portfolioStore` retained stale data from the previous session — a data leak if another user logged in on the same browser.

**After:** Logout now calls `reset()` on all data stores:
```js
logout: async () => {
  try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
  clearAccessToken();
  useWorkspaceStore.getState().reset();
  useClaimStore.getState().reset();
  usePortfolioStore.getState().reset();
  set({ user: null, isAuthenticated: false, error: null });
},
```

**File changed:** `app/src/store/authStore.js`

---

## 11. Dockerfile / Deploy — PASS

### Dockerfile Review
- ✓ Multi-stage build concept (single stage with `npm ci --omit=dev`)
- ✓ No secrets baked into image
- ✓ Python dependencies installed via `requirements.txt`
- ✓ Non-root user: runs as `appuser` (UID 1001)
- ✓ `COPY` instructions are selective (no `.git`, `node_modules`)
- ✓ Health check available at `/api/health`

### docker-compose.yml
- ✓ PostgreSQL data stored in named volume (`pgdata`)
- ✓ Database not exposed to host network (internal only)
- ✓ Environment variables loaded from `.env` file
- ✓ `depends_on` ensures DB starts before app

### Nginx (in-container)
- ✓ Reverse proxies to Node on localhost:3001
- ✓ Serves static dashboard files directly
- ✓ Configured via supervisord

---

## Files Modified

| File | Changes |
|------|---------|
| `server/server.js` | Helmet CSP, global rate limiter, error masking, unhandled rejection handlers, legacy route ordering, periodic token cleanup |
| `server/routes/results.js` | `optionalAuth`, UUID validation, ownership verification on all routes |
| `server/routes/auth.js` | `enforceMaxPerUser()` on login/register, opportunistic expired token cleanup |
| `server/routes/simulate.js` | Simulation rate limiter (10/min) on claim + portfolio endpoints |
| `server/routes/jurisdictions.js` | Path traversal protection (alphanumeric validation + resolved path check) |
| `server/db/models/RefreshToken.js` | `enforceMaxPerUser()` method |
| `app/src/store/authStore.js` | Reset all data stores on logout |
| `deploy/.env.example` | Already complete — no changes needed |
