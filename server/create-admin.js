require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/db');

(async () => {
  const loginId = process.argv[2] || 'admin';
  const password = process.argv[3] || 'Admin@123';
  const fullName = process.argv[4] || 'Super Admin';
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (login_id, password_hash, full_name, role, is_active)
     VALUES ($1, $2, $3, 'super_admin', TRUE)
     ON CONFLICT (login_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE`,
    [loginId, hash, fullName]
  );
  console.log(`Super Admin ready! Login ID: ${loginId} | Password: ${password}`);
  await pool.end();
})();
