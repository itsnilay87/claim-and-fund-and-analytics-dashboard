#!/bin/bash
set -euo pipefail
cd /opt/claim-analytics-platform

docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T web bash <<'BASH'
cd /app/server
node <<'NODE'
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query('SELECT email, password_hash FROM users WHERE email = $1', ['nmohod@5riverscap.com']);
  if (!r.rows.length) {
    console.log('USER_NOT_FOUND');
    process.exit(0);
  }
  const ok = await bcrypt.compare('TempPass2026!', r.rows[0].password_hash);
  console.log('PASSWORD_MATCH=' + ok);
  await pool.end();
})();
NODE
BASH
