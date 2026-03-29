#!/usr/bin/env node
/**
 * Post-deploy smoke test — validates a live deployment is healthy.
 *
 * Usage:
 *   node scripts/smoke_test.js                        # defaults to http://localhost
 *   node scripts/smoke_test.js http://178.104.35.208  # test production
 *
 * Checks:
 *   1. Health endpoint (server + database)
 *   2. Auth: register → login → refresh → protected route
 *   3. Public endpoints accessible without auth
 *   4. Protected endpoints return 401 without auth
 *   5. Dashboard static files served
 *
 * Exit code: 0 = all passed, 1 = failures detected
 */

const BASE_URL = process.argv[2] || 'http://localhost';
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name} — ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { redirect: 'manual', ...options });
  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text();
  return { status: res.status, body, headers: res.headers };
}

async function run() {
  console.log(`\nSmoke testing: ${BASE_URL}\n`);

  // ── 1. Health ──
  console.log('Health:');
  await check('GET /api/health returns 200', async () => {
    const { status, body } = await api('/api/health');
    assert(status === 200, `status=${status}`);
    assert(body.server === 'ok', `server=${body.server}`);
  });

  await check('Database is connected', async () => {
    const { body } = await api('/api/health');
    assert(body.database === 'ok', `database=${body.database}`);
  });

  // ── 2. Public endpoints ──
  console.log('\nPublic endpoints:');
  await check('GET /api/jurisdictions (no auth)', async () => {
    const { status } = await api('/api/jurisdictions');
    assert(status === 200, `status=${status}`);
  });

  await check('GET /api/defaults (no auth)', async () => {
    const { status } = await api('/api/defaults');
    assert(status === 200, `status=${status}`);
  });

  // ── 3. Auth enforcement ──
  console.log('\nAuth enforcement:');
  const protectedRoutes = [
    'GET /api/runs',
    'GET /api/workspaces',
    'GET /api/claims',
    'GET /api/portfolios',
    'GET /api/status/00000000-0000-0000-0000-000000000000',
    'GET /api/results/00000000-0000-0000-0000-000000000000/dashboard_data.json',
  ];
  for (const route of protectedRoutes) {
    const [method, path] = route.split(' ');
    await check(`${route} returns 401`, async () => {
      const { status } = await api(path, { method });
      assert(status === 401, `expected 401, got ${status}`);
    });
  }

  // ── 4. Auth lifecycle ──
  console.log('\nAuth lifecycle:');
  const email = `smoke-${Date.now()}@test.local`;
  const password = 'SmokeTest123!';
  let accessToken;
  let cookies;

  await check('POST /api/auth/register returns 201', async () => {
    const { status, body, headers } = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: 'Smoke Test' }),
    });
    assert(status === 201, `status=${status}: ${JSON.stringify(body)}`);
    assert(body.accessToken, 'no accessToken');
    accessToken = body.accessToken;
    cookies = headers.get('set-cookie');
    assert(cookies?.includes('refreshToken='), 'no refresh cookie');
  });

  await check('POST /api/auth/login returns 200', async () => {
    const { status, body, headers } = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert(status === 200, `status=${status}`);
    assert(body.accessToken, 'no accessToken');
    cookies = headers.get('set-cookie'); // update cookie
  });

  await check('POST /api/auth/refresh with cookie returns token', async () => {
    const cookieValue = cookies?.split(';')[0];
    assert(cookieValue, 'no cookie to send');
    const { status, body } = await api('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieValue },
    });
    assert(status === 200, `status=${status}`);
    assert(body.accessToken, 'no accessToken from refresh');
  });

  await check('Token works on protected route', async () => {
    const { status } = await api('/api/runs', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert(status === 200, `status=${status}`);
  });

  // ── 5. Dashboard static ──
  console.log('\nDashboard:');
  await check('GET /dashboard/ serves HTML', async () => {
    const { status, body } = await api('/dashboard/');
    assert(status === 200, `status=${status}`);
    assert(typeof body === 'string' && body.includes('<!'), 'not HTML');
  });

  // ── Summary ──
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('SMOKE TEST FAILED');
    process.exit(1);
  } else {
    console.log('ALL SMOKE TESTS PASSED ✓');
  }
}

run().catch(err => {
  console.error('Smoke test crashed:', err.message);
  process.exit(1);
});
