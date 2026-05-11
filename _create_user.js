const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
async function main() {
  const hash = await bcrypt.hash("imughal@", 12);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = `INSERT INTO users (id, email, password_hash, full_name, role, email_verified)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, TRUE)
             ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
             RETURNING id, email, full_name, role`;
  const res = await pool.query(q, ["imughal@5riverscap.com", hash, "I Mughal", "user"]);
  console.log("USER_CREATED:", JSON.stringify(res.rows[0]));
  await pool.end();
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
