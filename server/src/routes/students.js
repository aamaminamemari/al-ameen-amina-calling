const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { auth, allow } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function cleanPhone(val) {
  const digits = String(val || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

router.get('/', auth, allow('super_admin', 'admin', 'office'), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const className = String(req.query.class_name || '').trim();
  const where = [];
  const params = [];
  if (className) {
    params.push(className);
    where.push(`s.class_name = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(s.registration_no ILIKE $${params.length} OR s.student_name ILIKE $${params.length})`);
  }
  const sql = `
    SELECT s.*, c.father_mobile AS c_father_mobile, c.mother_mobile AS c_mother_mobile,
           c.guardian_1_mobile, c.guardian_1_relation,
           c.guardian_2_mobile, c.guardian_2_relation,
           c.guardian_3_mobile, c.guardian_3_relation
    FROM students s
    LEFT JOIN student_guardian_contacts c ON c.student_id = s.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.class_name, s.student_name
    LIMIT 1000
  `;
  const rows = (await pool.query(sql, params)).rows;
  res.json({ success: true, students: rows });
}));

router.post('/', auth, allow('super_admin', 'admin', 'office'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const regNo = String(b.registration_no || '').trim();
  const name = String(b.student_name || '').trim();
  const className = String(b.class_name || '').trim();
  if (!regNo || !name || !className) {
    return res.status(400).json({ success: false, message: 'Registration No, Name and Class are required' });
  }
  const father = cleanPhone(b.father_mobile);
  const mother = cleanPhone(b.mother_mobile);
  const g1 = cleanPhone(b.guardian_1_mobile);
  const g2 = cleanPhone(b.guardian_2_mobile);
  const g3 = cleanPhone(b.guardian_3_mobile);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stuRes = await client.query(
      `INSERT INTO students (registration_no, student_name, class_name, gender, father_name, mother_name, father_mobile, mother_mobile, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (registration_no) DO UPDATE SET
         student_name = EXCLUDED.student_name,
         class_name = EXCLUDED.class_name,
         gender = EXCLUDED.gender,
         father_mobile = COALESCE(EXCLUDED.father_mobile, students.father_mobile),
         mother_mobile = COALESCE(EXCLUDED.mother_mobile, students.mother_mobile),
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING *`,
      [regNo, name, className, b.gender || 'male', b.father_name || null, b.mother_name || null, father, mother, b.is_active !== false]
    );
    const stu = stuRes.rows[0];
    await client.query(
      `INSERT INTO student_guardian_contacts
         (student_id, father_mobile, mother_mobile, guardian_1_mobile, guardian_1_relation, guardian_2_mobile, guardian_2_relation, guardian_3_mobile, guardian_3_relation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (student_id) DO UPDATE SET
         father_mobile = EXCLUDED.father_mobile,
         mother_mobile = EXCLUDED.mother_mobile,
         guardian_1_mobile = EXCLUDED.guardian_1_mobile,
         guardian_1_relation = EXCLUDED.guardian_1_relation,
         guardian_2_mobile = EXCLUDED.guardian_2_mobile,
         guardian_2_relation = EXCLUDED.guardian_2_relation,
         guardian_3_mobile = EXCLUDED.guardian_3_mobile,
         guardian_3_relation = EXCLUDED.guardian_3_relation,
         updated_at = NOW()`,
      [stu.id, father, mother, g1, g1 ? (b.guardian_1_relation || 'Guardian 1') : null, g2, g2 ? (b.guardian_2_relation || 'Guardian 2') : null, g3, g3 ? (b.guardian_3_relation || 'Guardian 3') : null]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, student: stu });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.patch('/:id/toggle-active', auth, allow('super_admin', 'admin', 'office'), asyncHandler(async (req, res) => {
  const q = await pool.query(
    `UPDATE students SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1 RETURNING id, is_active`,
    [req.params.id]
  );
  if (!q.rowCount) return res.status(404).json({ success: false, message: 'Student not found' });
  res.json({ success: true, student: q.rows[0] });
}));

router.post('/import-excel', auth, allow('super_admin', 'admin', 'office'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Excel (.xlsx) file is required' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer);
  const ws = wb.worksheets[0];
  if (!ws) return res.status(400).json({ success: false, message: 'No worksheet found' });

  const headers = {};
  ws.getRow(1).eachCell((cell, col) => {
    const key = String(cell.value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (key) headers[key] = col;
  });

  const col = (...names) => {
    for (const n of names) {
      if (headers[n]) return headers[n];
    }
    return null;
  };

  const cReg = col('reg_no', 'registration_no', 'regno');
  const cName = col('student_name', 'name');
  const cClass = col('class', 'class_name');
  const cGender = col('gender');
  const cFather = col('father_mobile', 'father', 'father_phone');
  const cMother = col('mother_mobile', 'mother', 'mother_phone');
  const cG1 = col('guardian_1_mobile', 'guardian1_mobile', 'guardian_1');
  const cG1Rel = col('guardian_1_relation', 'guardian1_relation');
  const cG2 = col('guardian_2_mobile', 'guardian2_mobile', 'guardian_2');
  const cG2Rel = col('guardian_2_relation', 'guardian2_relation');
  const cG3 = col('guardian_3_mobile', 'guardian3_mobile', 'guardian_3');
  const cG3Rel = col('guardian_3_relation', 'guardian3_relation');

  if (!cReg || !cName || !cClass) {
    return res.status(400).json({ success: false, message: 'Excel must have columns: Reg. No, Student Name, Class' });
  }

  let imported = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const regNo = String(row.getCell(cReg).value || '').trim();
      const name = String(row.getCell(cName).value || '').trim();
      const className = String(row.getCell(cClass).value || '').trim();
      if (!regNo || !name || !className) continue;

      const gender = cGender ? String(row.getCell(cGender).value || 'male').trim().toLowerCase() : 'male';
      const father = cFather ? cleanPhone(row.getCell(cFather).value) : null;
      const mother = cMother ? cleanPhone(row.getCell(cMother).value) : null;
      const g1 = cG1 ? cleanPhone(row.getCell(cG1).value) : null;
      const g1Rel = cG1Rel ? String(row.getCell(cG1Rel).value || '').trim() || null : null;
      const g2 = cG2 ? cleanPhone(row.getCell(cG2).value) : null;
      const g2Rel = cG2Rel ? String(row.getCell(cG2Rel).value || '').trim() || null : null;
      const g3 = cG3 ? cleanPhone(row.getCell(cG3).value) : null;
      const g3Rel = cG3Rel ? String(row.getCell(cG3Rel).value || '').trim() || null : null;

      const stuRes = await client.query(
        `INSERT INTO students (registration_no, student_name, class_name, gender, father_mobile, mother_mobile, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (registration_no) DO UPDATE SET
           student_name = EXCLUDED.student_name,
           class_name = EXCLUDED.class_name,
           gender = EXCLUDED.gender,
           father_mobile = COALESCE(EXCLUDED.father_mobile, students.father_mobile),
           mother_mobile = COALESCE(EXCLUDED.mother_mobile, students.mother_mobile),
           updated_at = NOW()
         RETURNING id`,
        [regNo, name, className, gender, father, mother]
      );
      const sid = stuRes.rows[0].id;
      await client.query(
        `INSERT INTO student_guardian_contacts
           (student_id, father_mobile, mother_mobile, guardian_1_mobile, guardian_1_relation, guardian_2_mobile, guardian_2_relation, guardian_3_mobile, guardian_3_relation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (student_id) DO UPDATE SET
           father_mobile = COALESCE(EXCLUDED.father_mobile, student_guardian_contacts.father_mobile),
           mother_mobile = COALESCE(EXCLUDED.mother_mobile, student_guardian_contacts.mother_mobile),
           guardian_1_mobile = COALESCE(EXCLUDED.guardian_1_mobile, student_guardian_contacts.guardian_1_mobile),
           guardian_1_relation = COALESCE(EXCLUDED.guardian_1_relation, student_guardian_contacts.guardian_1_relation),
           guardian_2_mobile = COALESCE(EXCLUDED.guardian_2_mobile, student_guardian_contacts.guardian_2_mobile),
           guardian_2_relation = COALESCE(EXCLUDED.guardian_2_relation, student_guardian_contacts.guardian_2_relation),
           guardian_3_mobile = COALESCE(EXCLUDED.guardian_3_mobile, student_guardian_contacts.guardian_3_mobile),
           guardian_3_relation = COALESCE(EXCLUDED.guardian_3_relation, student_guardian_contacts.guardian_3_relation),
           updated_at = NOW()`,
        [sid, father, mother, g1, g1 ? (g1Rel || 'Guardian 1') : null, g2, g2 ? (g2Rel || 'Guardian 2') : null, g3, g3 ? (g3Rel || 'Guardian 3') : null]
      );
      imported++;
    }
    await client.query('COMMIT');
    res.json({ success: true, imported });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
