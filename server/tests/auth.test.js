/**
 * Auth API tests — guards against auth regressions.
 *
 * Covers the full auth lifecycle:
 *   1. Register → returns 201, sets refresh cookie
 *   2. Login → returns 200, sets refresh cookie
 *   3. Refresh → new access token from cookie (dashboard pattern)
 *   4. Protected routes reject unauthenticated requests (401)
 *   5. Auth token grants access to protected routes
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

// DB-dependent — skip if no DATABASE_URL
const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  // Import the Express app (does NOT listen because NODE_ENV=test)
  app = (await import('../server.js')).default;
});

describe('Health', () => {
  it('GET /api/health returns 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('server', 'ok');
  });
});

describe('Auth enforcement', () => {
  it('GET /api/workspaces without token returns 401', async () => {
    const res = await request(app).get('/api/workspaces');
    expect(res.status).toBe(401);
  });

  it('GET /api/claims without token returns 401', async () => {
    const res = await request(app).get('/api/claims');
    expect(res.status).toBe(401);
  });

  it('GET /api/portfolios without token returns 401', async () => {
    const res = await request(app).get('/api/portfolios');
    expect(res.status).toBe(401);
  });

  it('GET /api/runs without token returns 401', async () => {
    const res = await request(app).get('/api/runs');
    expect(res.status).toBe(401);
  });

  it('GET /api/status/:runId without token returns 401', async () => {
    const res = await request(app).get('/api/status/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });

  it('GET /api/results/:runId/dashboard_data.json without token returns 401', async () => {
    const res = await request(app).get('/api/results/00000000-0000-0000-0000-000000000000/dashboard_data.json');
    expect(res.status).toBe(401);
  });

  it('GET /api/results/:runId/files without token returns 401', async () => {
    const res = await request(app).get('/api/results/00000000-0000-0000-0000-000000000000/files');
    expect(res.status).toBe(401);
  });

  it('POST /api/simulate/portfolio without token returns 401', async () => {
    const res = await request(app).post('/api/simulate/portfolio').send({});
    expect(res.status).toBe(401);
  });

  it('POST /api/simulate/claim without token returns 401', async () => {
    const res = await request(app).post('/api/simulate/claim').send({});
    expect(res.status).toBe(401);
  });

  it('Invalid token returns 401', async () => {
    const res = await request(app)
      .get('/api/runs')
      .set('Authorization', 'Bearer invalid-token-garbage');
    expect(res.status).toBe(401);
  });
});

describeWithDb('Auth lifecycle (requires DB)', () => {
  const testEmail = `test-${Date.now()}@vitest.local`;
  const testPassword = 'TestPass123!';
  let accessToken;
  let refreshCookie;

  it('POST /api/auth/register creates account', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: testPassword, full_name: 'Vitest User' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe(testEmail);

    accessToken = res.body.accessToken;
    const cookies = res.headers['set-cookie'];
    refreshCookie = cookies?.find(c => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeTruthy();
  });

  it('GET /api/auth/me with token returns user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testEmail);
  });

  it('POST /api/auth/refresh with cookie returns new token', async () => {
    // This is the EXACT pattern the dashboard uses
    const cookieValue = refreshCookie.split(';')[0];
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieValue);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('Protected routes accept valid token', async () => {
    const res = await request(app)
      .get('/api/runs')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
  });

  it('POST /api/auth/login works', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: testPassword });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });

  it('Duplicate register returns 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: testPassword, full_name: 'Dup' });
    expect(res.status).toBe(409);
  });

  it('Wrong password returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testEmail, password: 'WrongPassword!' });
    expect(res.status).toBe(401);
  });
});

describeWithDb('Dashboard auth flow (requires DB)', () => {
  // Simulates the EXACT flow that caused the 401 bug:
  // 1. User logs in via main app → gets refresh cookie
  // 2. Dashboard opens → uses refresh cookie to get access token
  // 3. Dashboard fetches results with access token
  const email = `dashboard-${Date.now()}@vitest.local`;
  let refreshCookie;
  let dashboardToken;

  it('Step 1: Login sets refresh cookie', async () => {
    // Register first
    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'DashTest123!', full_name: 'Dashboard Tester' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'DashTest123!' });
    expect(res.status).toBe(200);

    const cookies = res.headers['set-cookie'];
    refreshCookie = cookies?.find(c => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeTruthy();
  });

  it('Step 2: Refresh cookie yields access token (dashboard pattern)', async () => {
    const cookieValue = refreshCookie.split(';')[0];
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieValue);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    dashboardToken = res.body.accessToken;
  });

  it('Step 3: Access token works on results endpoints', async () => {
    // Should get 400 (bad UUID) or 404 (not found), but NOT 401
    const res = await request(app)
      .get('/api/status/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${dashboardToken}`);
    expect(res.status).not.toBe(401);
  });
});

describe('Public endpoints', () => {
  it('GET /api/jurisdictions does not require auth', async () => {
    const res = await request(app).get('/api/jurisdictions');
    expect(res.status).toBe(200);
  });

  it('GET /api/defaults does not require auth', async () => {
    const res = await request(app).get('/api/defaults');
    expect(res.status).toBe(200);
  });
});
