-- Standalone School Calling System Schema (PostgreSQL / Neon)

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  login_id VARCHAR(64) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'super_admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  password_change_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  registration_no VARCHAR(64) UNIQUE NOT NULL,
  student_name VARCHAR(180) NOT NULL,
  class_name VARCHAR(64) NOT NULL,
  roll_no VARCHAR(32),
  gender VARCHAR(16) DEFAULT 'male',
  father_name VARCHAR(150),
  mother_name VARCHAR(150),
  guardian_name VARCHAR(150),
  father_mobile VARCHAR(32),
  mother_mobile VARCHAR(32),
  guardian_mobile VARCHAR(32),
  alternate_mobile VARCHAR(32),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_guardian_contacts (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT UNIQUE NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  father_mobile VARCHAR(32),
  mother_mobile VARCHAR(32),
  guardian_1_mobile VARCHAR(32),
  guardian_1_relation VARCHAR(64),
  guardian_2_mobile VARCHAR(32),
  guardian_2_relation VARCHAR(64),
  guardian_3_mobile VARCHAR(32),
  guardian_3_relation VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calling_schedules (
  id BIGSERIAL PRIMARY KEY,
  session_name VARCHAR(32) DEFAULT '2026-2027',
  class_name VARCHAR(64) NOT NULL,
  gender VARCHAR(16),
  allowed_talk_time INTEGER NOT NULL DEFAULT 8,
  days TEXT[] NOT NULL DEFAULT ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
  start_time VARCHAR(16) NOT NULL DEFAULT '06:00',
  end_time VARCHAR(16) NOT NULL DEFAULT '22:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calling_booth_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  incoming_calls_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  call_recording_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_calling_access (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT UNIQUE NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  is_emergency_call BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hostel_call_logs (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT REFERENCES students(id) ON DELETE SET NULL,
  student_name VARCHAR(180),
  registration_no VARCHAR(64),
  class_name VARCHAR(64),
  contact_person VARCHAR(64),
  phone_number VARCHAR(32),
  call_status VARCHAR(32) NOT NULL DEFAULT 'completed',
  call_duration_seconds INTEGER NOT NULL DEFAULT 0,
  max_allowed_seconds INTEGER,
  sim_slot VARCHAR(32),
  gateway_type VARCHAR(64),
  recording_url TEXT,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS call_logs (
  id BIGSERIAL PRIMARY KEY,
  call_sid VARCHAR(120) UNIQUE,
  from_number VARCHAR(64),
  to_number VARCHAR(64),
  caller_id VARCHAR(64),
  student_id BIGINT REFERENCES students(id) ON DELETE SET NULL,
  reg_no VARCHAR(64),
  called_relation VARCHAR(64),
  allowed_talk_time INTEGER,
  duration INTEGER NOT NULL DEFAULT 0,
  call_duration_seconds INTEGER NOT NULL DEFAULT 0,
  max_allowed_seconds INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  context VARCHAR(64) NOT NULL DEFAULT 'booth_call',
  recording_url TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS call_sid VARCHAR(120);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS from_number VARCHAR(64);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS to_number VARCHAR(64);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS caller_id VARCHAR(64);
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 0;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS context VARCHAR(64) NOT NULL DEFAULT 'booth_call';
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_logs_call_sid ON call_logs(call_sid);

CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(120) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_gate_passes (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_no VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'returned',
  departure_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ
);
