export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('operator', 'renter')),
  display_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  glyph TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT '',
  photo_data_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  active_model_id TEXT,
  active_terms_id TEXT
);

CREATE TABLE IF NOT EXISTS calibration_takes (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (label IN ('idle', 'active', 'negative', 'transition')),
  frames_json TEXT NOT NULL,
  frame_flags_json TEXT NOT NULL,
  frame_count INTEGER NOT NULL CHECK (frame_count > 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  feature_spec_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'import', 'synthetic')),
  device_label TEXT,
  notes TEXT,
  dataset_hash TEXT NOT NULL,
  quality_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_takes_object ON calibration_takes(object_id, created_at);

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  model_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY', 'LIMITED', 'REJECTED')),
  dataset_hash TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_at TEXT,
  UNIQUE (object_id, version),
  UNIQUE (object_id, model_hash)
);

CREATE INDEX IF NOT EXISTS idx_models_object ON model_versions(object_id, created_at);

CREATE TABLE IF NOT EXISTS price_terms (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id),
  version INTEGER NOT NULL,
  terms_json TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  currency TEXT NOT NULL,
  minor_per_minute INTEGER NOT NULL CHECK (minor_per_minute > 0),
  cap_minor INTEGER NOT NULL CHECK (cap_minor > 0),
  rounding TEXT NOT NULL,
  uncertain_policy TEXT NOT NULL,
  billing_policy TEXT NOT NULL,
  model_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_at TEXT,
  UNIQUE (object_id, version),
  UNIQUE (object_id, terms_hash)
);

CREATE INDEX IF NOT EXISTS idx_terms_object ON price_terms(object_id, version);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  renter_id TEXT NOT NULL REFERENCES users(id),
  terms_id TEXT NOT NULL REFERENCES price_terms(id),
  terms_hash TEXT NOT NULL,
  model_version_id TEXT NOT NULL REFERENCES model_versions(id),
  model_hash TEXT NOT NULL,
  model_status TEXT NOT NULL,
  currency TEXT NOT NULL,
  minor_per_minute INTEGER NOT NULL,
  cap_minor INTEGER NOT NULL,
  state TEXT NOT NULL,
  payment_state TEXT NOT NULL DEFAULT 'NONE',
  review_mode TEXT NOT NULL DEFAULT 'AUTO',
  sensor_mode TEXT NOT NULL DEFAULT 'LIVE' CHECK (sensor_mode IN ('LIVE', 'REPLAY')),
  created_at TEXT NOT NULL,
  consented_at TEXT,
  started_at TEXT,
  stopped_at TEXT,
  paused_at TEXT,
  paused_total_ms INTEGER NOT NULL DEFAULT 0,
  last_client_seq INTEGER NOT NULL DEFAULT 0,
  last_interval_end_ms INTEGER NOT NULL DEFAULT 0,
  observed_ms INTEGER NOT NULL DEFAULT 0,
  billable_ms INTEGER NOT NULL DEFAULT 0,
  excluded_ms INTEGER NOT NULL DEFAULT 0,
  idle_ms INTEGER NOT NULL DEFAULT 0,
  disconnected_ms INTEGER NOT NULL DEFAULT 0,
  base_quote_minor INTEGER NOT NULL DEFAULT 0,
  credit_minor INTEGER NOT NULL DEFAULT 0,
  quote_minor INTEGER NOT NULL DEFAULT 0,
  quote_hash TEXT,
  reviewed_at TEXT,
  reviewed_quote_hash TEXT,
  operator_approved_at TEXT,
  finalized_at TEXT,
  paypal_order_id TEXT,
  paypal_approve_url TEXT,
  paypal_authorization_id TEXT,
  paypal_capture_id TEXT,
  paypal_refund_id TEXT,
  provider_status TEXT,
  provider_reconciled_at TEXT,
  captured_minor INTEGER,
  evidence_hash TEXT,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_object ON sessions(object_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_sessions_renter ON sessions(renter_id, created_at);

CREATE TABLE IF NOT EXISTS session_consents (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  renter_id TEXT NOT NULL REFERENCES users(id),
  terms_hash TEXT NOT NULL,
  model_hash TEXT NOT NULL,
  terms_snapshot_json TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observed_intervals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
  state TEXT NOT NULL CHECK (state IN ('ACTIVE_CONFIDENT', 'IDLE', 'UNCERTAIN', 'DISCONNECTED')),
  model_version TEXT NOT NULL,
  confidence REAL NOT NULL,
  quality_flags_json TEXT NOT NULL,
  explanation_json TEXT,
  evidence_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_intervals_session ON observed_intervals(session_id, start_ms);

CREATE TABLE IF NOT EXISTS session_pauses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  paused_at TEXT NOT NULL,
  resumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pauses_session ON session_pauses(session_id);

CREATE TABLE IF NOT EXISTS payment_operations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('CREATE_ORDER', 'AUTHORIZE', 'CAPTURE', 'VOID', 'REFUND')),
  request_id TEXT NOT NULL,
  state TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT,
  request_hash TEXT NOT NULL,
  provider_ref TEXT,
  response_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, operation_type)
);

CREATE TABLE IF NOT EXISTS paypal_resources (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  kind TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_resources_session ON paypal_resources(session_id);

CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  transmission_id TEXT,
  payload_sha256 TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  result TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlement_receipts (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  receipt_json TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  renter_id TEXT NOT NULL REFERENCES users(id),
  interval_ids_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  reason_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'REJECTED')),
  resolution TEXT,
  credit_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_disputes_session ON disputes(session_id);

CREATE TABLE IF NOT EXISTS signing_keys (
  key_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE TABLE IF NOT EXISTS take_roles (
  take_id TEXT PRIMARY KEY REFERENCES calibration_takes(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('TRAINING', 'VALIDATION')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_reports (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_validation_object ON validation_reports(object_id, created_at);

CREATE TABLE IF NOT EXISTS passport_versions (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  key_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (object_id, version)
);

CREATE INDEX IF NOT EXISTS idx_passport_object ON passport_versions(object_id, version);

CREATE TABLE IF NOT EXISTS session_preflights (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_sensor_reports (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  report_json TEXT NOT NULL,
  mismatch_ratio REAL NOT NULL,
  uncertain_ratio REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS object_holds (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  renter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_session_id TEXT REFERENCES sessions(id),
  UNIQUE (object_id, renter_id)
);

CREATE INDEX IF NOT EXISTS idx_holds_object ON object_holds(object_id, expires_at);

CREATE TABLE IF NOT EXISTS receipt_proofs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fairness_credits (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shelf_listings (
  object_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  listed INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signing_keys_created ON signing_keys(created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  processed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(processed_at, next_attempt_at);
`;
