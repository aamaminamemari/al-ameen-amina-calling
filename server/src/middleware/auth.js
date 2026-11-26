const jwt = require('jsonwebtoken');
const pool = require('../db');

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    const account = await pool.query(
      'SELECT role, is_active, full_name, login_id FROM users WHERE id = $1',
      [user.userId]
    );
    if (!account.rowCount || !account.rows[0].is_active || account.rows[0].role !== user.role) {
      return res.status(401).json({ success: false, message: 'Please login again' });
    }
    req.user = {
      ...user,
      loginId: account.rows[0].login_id,
      fullName: account.rows[0].full_name,
    };
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

function allow(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}

module.exports = { auth, allow };
