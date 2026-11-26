require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./src/db');

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Auto-initialize standalone database schema on startup
async function ensureSchema() {
  const sqlPath = path.join(__dirname, 'sql', 'calling_schema.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
  }
}

// API Routes
app.use('/api', require('./src/routes/auth'));
app.use('/api/students', require('./src/routes/students'));
app.use('/api/calling-schedules', require('./src/routes/callingSchedule'));
app.use('/api/calling-booth', require('./src/routes/callingBooth').router);
app.use('/api/calls', require('./src/routes/calls'));

// Serve standalone Calling Admin Dashboard
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ success: true, school: process.env.SCHOOL_NAME || 'School Calling System' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server error' });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[${process.env.SCHOOL_NAME || 'School Calling System'}] Running on http://localhost:${PORT}`);
  try {
    await ensureSchema();
    console.log('[DB] Standalone calling schema verified.');
  } catch (err) {
    console.warn('[DB] Schema notice:', err.message);
  }
  if (!process.env.RENDER && process.env.ENABLE_SIP_BRIDGE !== 'false') {
    try {
      require('./src/services/yealinkSipBridge').startSipBridge();
    } catch (err) {
      console.warn('[SIP Bridge] Notice:', err.message);
    }
  } else {
    console.log('[SIP Bridge] Cloud mode detected (Render) - SIP UDP bridge runs on Hostel PC.');
  }
  try {
    require('./src/services/recordingCleanup').startRecordingCleanupScheduler();
  } catch (err) {
    console.warn('[Recording Cleanup] Notice:', err.message);
  }
});
