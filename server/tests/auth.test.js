/**
 * Auth API tests — guards against auth regressions.
 *
 * Covers the full auth lifecycle:
 *   1. Request-OTP → stores pending, sends OTP (mocked)
 *   2. Verify-OTP → creates account, returns 201 + tokens
 *   3. Login → returns 200, sets refresh cookie
 *   4. Refresh → new access token from cookie (dashboard pattern)
 *   5. Protected routes reject unauthenticated requests (401)
 *   6. Auth token grants access to protected routes
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

// DB-dependent — skip if no DATABASE_URL
const DB_AVAILABLE = !!process.env.DATABASE_URL;
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

let app;

// Capture OTPs sent by the email service (dev mode console fallback)
let capturedOtp = null;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  // Ensure SMTP vars are NOT set so email service falls back to console.log
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  // Intercept console.log to capture OTPs
  const origLog = console.log;
  console.log = (...args) => {
    const msg = args.join(' ');
    const match = msg.match(/\[EMAIL\] OTP for .+: (\d{6})/);
    if (match) capturedOtp = match[1];
    origLog.apply(console, args);
  };

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

describeWithDb('OTP registration flow (requires DB)', () => {
  const testEmail = `test-${Date.now()}@vitest.local`;
  const testPassword = 'TestPass123!';

  it('POST /api/auth/register/request-otp sends OTP', async () => {
    capturedOtp = null;
    const res = await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: testEmail, password: testPassword, full_name: 'Vitest User' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
    expect(capturedOtp).toBeTruthy();
    expect(capturedOtp).toHaveLength(6);
  });

  it('POST /api/auth/register/verify-otp with wrong code returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/register/verify-otp')
      .send({ email: testEmail, otp: '000000' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/register/verify-otp with correct code creates account', async () => {
    const res = await request(app)
      .post('/api/auth/register/verify-otp')
      .send({ email: testEmail, otp: capturedOtp });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe(testEmail);

    const cookies = res.headers['set-cookie'];
    const refreshCookie = cookies?.find(c => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeTruthy();
  });

  it('Duplicate request-otp for existing user returns 409', async () => {
    const res = await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: testEmail, password: testPassword, full_name: 'Dup' });
    expect(res.status).toBe(409);
  });
});

describeWithDb('OTP edge cases (requires DB)', () => {
  const edgeEmail = `edge-${Date.now()}@vitest.local`;

  it('verify-otp without request returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register/verify-otp')
      .send({ email: 'nonexistent@vitest.local', otp: '123456' });
    expect(res.status).toBe(400);
  });

  it('resend-otp creates new code', async () => {
    // First request an OTP
    capturedOtp = null;
    await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: edgeEmail, password: 'EdgeTest123!', full_name: 'Edge Tester' });
    const firstOtp = capturedOtp;

    // Resend
    capturedOtp = null;
    const res = await request(app)
      .post('/api/auth/register/resend-otp')
      .send({ email: edgeEmail });
    expect(res.status).toBe(200);
    expect(capturedOtp).toBeTruthy();

    // Verify with new OTP
    const verifyRes = await request(app)
      .post('/api/auth/register/verify-otp')
      .send({ email: edgeEmail, otp: capturedOtp });
    expect(verifyRes.status).toBe(201);
  });

  it('request-otp with invalid email returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: 'not-an-email', password: 'TestPass123!', full_name: 'Bad' });
    expect(res.status).toBe(400);
  });

  it('request-otp with short password returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: 'short@vitest.local', password: '123', full_name: 'Short' });
    expect(res.status).toBe(400);
  });
});

describeWithDb('Auth lifecycle (requires DB)', () => {
  const testEmail = `lifecycle-${Date.now()}@vitest.local`;
  const testPassword = 'TestPass123!';
  let accessToken;
  let refreshCookie;

  it('Register via OTP flow creates account', async () => {
    // Step 1: Request OTP
    capturedOtp = null;
    await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: testEmail, password: testPassword, full_name: 'Vitest User' });

    // Step 2: Verify OTP
    const res = await request(app)
      .post('/api/auth/register/verify-otp')
      .send({ email: testEmail, otp: capturedOtp });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
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
    // Register first via OTP flow
    capturedOtp = null;
    await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email, password: 'DashTest123!', full_name: 'Dashboard Tester' });
    await request(app)
      .post('/api/auth/register/verify-otp')
      .send({ email, otp: capturedOtp });

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
