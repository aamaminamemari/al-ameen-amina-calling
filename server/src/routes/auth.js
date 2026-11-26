const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { auth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const loginId = String(req.body?.login_id || req.body?.loginId || '').trim();
  const password = String(req.body?.password || '');
  if (!loginId || !password) {
    return res.status(400).json({ success: false, message: 'Login ID and password are required' });
  }
  const q = await pool.query(
    'SELECT id, login_id, password_hash, full_name, role, is_active FROM users WHERE LOWER(login_id) = LOWER($1) LIMIT 1',
    [loginId]
  );
  if (!q.rowCount || !q.rows[0].is_active) {
    return res.status(401).json({ success: false, message: 'Invalid login ID or password' });
  }
  const u = q.rows[0];
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    return res.status(401).json({ success: false, message: 'Invalid login ID or password' });
  }
  const token = jwt.sign(
    { userId: u.id, role: u.role, loginId: u.login_id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    success: true,
    token,
    school_name: process.env.SCHOOL_NAME || 'School Calling System',
    user: { id: u.id, login_id: u.login_id, full_name: u.full_name, role: u.role },
  });
}));

router.get('/me', auth, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    school_name: process.env.SCHOOL_NAME || 'School Calling System',
    user: {
      id: req.user.userId,
      login_id: req.user.loginId,
      full_name: req.user.fullName,
      role: req.user.role,
    },
  });
}));

router.post('/change-password', auth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.current_password || '');
  const newPassword = String(req.body?.new_password || '');
  if (!currentPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
  }
  const q = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
  if (!q.rowCount || !(await bcrypt.compare(currentPassword, q.rows[0].password_hash))) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.userId]);
  res.json({ success: true, message: 'Password updated successfully' });
}));

module.exports = router;
