import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/db.js';

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node scripts/set-password.js email@example.com "new-password"');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const result = await query(
  `UPDATE app_users SET password_hash = $1, auth_version = auth_version + 1, updated_at = now() WHERE lower(email) = lower($2) RETURNING email, role`,
  [hash, email]
);

if (!result.rows[0]) {
  console.error(`No user found for ${email}`);
  process.exitCode = 1;
} else {
  console.log(`Password set for ${result.rows[0].email} (${result.rows[0].role})`);
}

await pool.end();
