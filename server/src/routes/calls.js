const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { auth, allow } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * Shared query helper for call logs with optional date-range & column filters
 */
async function queryFilteredCallLogs({
  fromDate,
  toDate,
  regNo,
  student,
  relation,
  toNumber,
  status,
  limit = 200,
}) {
  const params = [];
  const conditions = [];

  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    params.push(fromDate);
    conditions.push(`COALESCE(started_at, created_at) >= ($${params.length}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`);
  }
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    params.push(toDate);
    conditions.push(`COALESCE(started_at, created_at) < (($${params.length}::date + INTERVAL '1 day'))::timestamp AT TIME ZONE 'Asia/Kolkata'`);
  }
  if (regNo && String(regNo).trim()) {
    params.push(`%${String(regNo).trim()}%`);
    conditions.push(`COALESCE(reg_no, '') ILIKE $${params.length}`);
  }
  if (student && String(student).trim()) {
    params.push(`%${String(student).trim()}%`);
    conditions.push(`COALESCE(student_name, '') ILIKE $${params.length}`);
  }
  if (relation && String(relation).trim() && String(relation).trim().toLowerCase() !== 'all') {
    params.push(`%${String(relation).trim()}%`);
    conditions.push(`COALESCE(called_relation, '') ILIKE $${params.length}`);
  }
  if (toNumber && String(toNumber).trim()) {
    params.push(`%${String(toNumber).trim()}%`);
    conditions.push(`COALESCE(to_number, '') ILIKE $${params.length}`);
  }
  if (status && String(status).trim() && String(status).trim().toLowerCase() !== 'all') {
    params.push(String(status).trim().toLowerCase());
    conditions.push(`LOWER(COALESCE(status, '')) = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const q = await pool.query(`
    SELECT * FROM (
      SELECT
        h.id,
        'booth_' || h.id AS call_sid,
        h.registration_no AS reg_no,
        COALESCE(h.student_name, s.student_name, 'Student') AS student_name,
        COALESCE(s.class_name, h.class_name, '') AS class_name,
        'Booth' AS from_number,
        h.phone_number AS to_number,
        COALESCE(h.contact_person, 'Guardian') AS called_relation,
        h.call_status AS status,
        COALESCE(h.call_duration_seconds, 0) AS duration,
        COALESCE(ROUND(h.max_allowed_seconds / 60), 8) AS allowed_talk_time,
        h.recording_url,
        h.started_at,
        h.ended_at,
        h.created_at
      FROM hostel_call_logs h
      LEFT JOIN students s ON s.registration_no = h.registration_no

      UNION ALL

      SELECT
        cl.id,
        cl.call_sid,
        cl.reg_no,
        COALESCE(s.student_name, 'Student') AS student_name,
        COALESCE(s.class_name, '') AS class_name,
        COALESCE(cl.from_number, 'External') AS from_number,
        cl.to_number,
        COALESCE(cl.called_relation, 'Guardian') AS called_relation,
        cl.status,
        COALESCE(cl.duration, 0) AS duration,
        COALESCE(cl.allowed_talk_time, 8) AS allowed_talk_time,
        cl.recording_url,
        cl.created_at AS started_at,
        (CASE WHEN cl.duration > 0 THEN cl.created_at + (cl.duration || ' seconds')::interval ELSE cl.updated_at END) AS ended_at,
        cl.created_at
      FROM call_logs cl
      LEFT JOIN students s ON s.registration_no = cl.reg_no
      WHERE cl.context != 'booth_call' AND cl.call_sid NOT LIKE 'booth_%'
    ) combined
    ${whereClause}
    ORDER BY COALESCE(started_at, created_at) DESC
    LIMIT $${params.length}
  `, params);

  return q.rows;
}

/**
 * GET /api/calls/logs
 */
router.get('/logs', auth, allow('super_admin'), asyncHandler(async (req, res) => {
  const fromDate = req.query.from_date ? String(req.query.from_date).trim() : '';
  const toDate = req.query.to_date ? String(req.query.to_date).trim() : '';
  const defaultLimit = (fromDate || toDate) ? 1000 : 100;
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || defaultLimit));

  const rows = await queryFilteredCallLogs({
    fromDate,
    toDate,
    regNo: req.query.reg_no,
    student: req.query.student,
    relation: req.query.relation,
    toNumber: req.query.to_number,
    status: req.query.status,
    limit,
  });

  res.json({ success: true, calls: rows });
}));

async function sendLogsExcel(res, rows, fromDate = '', toDate = '') {
  const fmtIstDateTime = (dt) => {
    if (!dt) return '-';
    try {
      return new Date(dt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return String(dt);
    }
  };

  const fmtIstTime = (dt) => {
    if (!dt) return '-';
    try {
      return new Date(dt).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return '-';
    }
  };

  const fmtDuration = (secs) => {
    const s = Number(secs) || 0;
    if (s <= 0) return '0s';
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m === 0) return `${rem}s`;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Call Logs');

  sheet.mergeCells('A1:K1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${process.env.SCHOOL_NAME || 'School Calling Booth'} - Hostel Call Logs & History`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF173F77' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:K2');
  const subCell = sheet.getCell('A2');
  const rangeLabel = (fromDate || toDate) ? `${fromDate || 'Start'} to ${toDate || 'Today'}` : 'All Dates';
  subCell.value = `Date Range: ${rangeLabel} | Total Calls: ${rows.length}`;
  subCell.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 20;

  const headers = [
    '#', 'Reg No', 'Student Name', 'Class', 'Relation',
    'Dialed To', 'Status', 'Start Time', 'Stop Time', 'Duration', 'Time Limit'
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  rows.forEach((r, i) => {
    const startVal = r.started_at || r.created_at;
    let endVal = r.ended_at;
    if (!endVal && startVal && r.duration) {
      endVal = new Date(new Date(startVal).getTime() + Number(r.duration) * 1000);
    }
    const row = sheet.addRow([
      i + 1,
      r.reg_no || '-',
      r.student_name || '-',
      r.class_name || '-',
      r.called_relation || 'Guardian',
      r.to_number || '-',
      r.status === 'completed' ? 'Completed' : (r.status || '-'),
      fmtIstDateTime(startVal),
      fmtIstTime(endVal),
      fmtDuration(r.duration),
      `${r.allowed_talk_time || 8} min`,
    ]);
    row.eachCell((cell, colNumber) => {
      cell.alignment = {
        horizontal: [1, 2, 4, 7, 10, 11].includes(colNumber) ? 'center' : 'left',
        vertical: 'middle',
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      if (colNumber === 7) {
        cell.font = { bold: true, color: { argb: r.status === 'completed' ? 'FF16A34A' : 'FFDC2626' } };
      }
    });
  });

  const colWidths = [6, 12, 24, 10, 14, 16, 14, 24, 15, 12, 12];
  colWidths.forEach((w, idx) => {
    sheet.getColumn(idx + 1).width = w;
  });

  const fileTag = (fromDate || toDate) ? `${fromDate || 'start'}_to_${toDate || 'today'}` : 'all';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Hostel_Call_Logs_${fileTag}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

/**
 * GET /api/calls/logs/export
 */
router.get('/logs/export', auth, allow('super_admin'), asyncHandler(async (req, res) => {
  const fromDate = req.query.from_date ? String(req.query.from_date).trim() : '';
  const toDate = req.query.to_date ? String(req.query.to_date).trim() : '';

  const rows = await queryFilteredCallLogs({
    fromDate,
    toDate,
    regNo: req.query.reg_no,
    student: req.query.student,
    relation: req.query.relation,
    toNumber: req.query.to_number,
    status: req.query.status,
    limit: 5000,
  });

  await sendLogsExcel(res, rows, fromDate, toDate);
}));

/**
 * POST /api/calls/logs/export
 */
router.post('/logs/export', auth, allow('super_admin'), asyncHandler(async (req, res) => {
  const fromDate = req.body?.from_date ? String(req.body.from_date).trim() : '';
  const toDate = req.body?.to_date ? String(req.body.to_date).trim() : '';
  const records = Array.isArray(req.body?.records) ? req.body.records : null;

  const rows = records || await queryFilteredCallLogs({
    fromDate,
    toDate,
    limit: 5000,
  });

  await sendLogsExcel(res, rows, fromDate, toDate);
}));

/**
 * GET /api/calls/recordings/:date/:filename
 */
router.get('/recordings/:date/:filename', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = bearerToken || (req.query.token ? String(req.query.token).trim() : '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can access call recordings' });
    }
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  const dateFolder = String(req.params.date || '');
  const fileName = String(req.params.filename || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFolder) || !/^[a-zA-Z0-9_.-]+\.(wav|mp3)$/i.test(fileName)) {
    return res.status(400).json({ success: false, message: 'Invalid recording path' });
  }

  const recordingsRoot = path.resolve(__dirname, '..', '..', 'recordings');
  const fullPath = path.resolve(recordingsRoot, dateFolder, fileName);
  if (!fullPath.startsWith(recordingsRoot) || !fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, message: 'Recording not found on this server' });
  }

  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  }
  res.setHeader('Content-Type', fileName.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav');
  return res.sendFile(fullPath);
}));

// Wire IVR routes from callingBooth
const { router: boothRouter } = require('./callingBooth');
router.use('/ivr', boothRouter);

module.exports = router;
