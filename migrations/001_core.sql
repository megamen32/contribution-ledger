-- Fresh v2 application schema; not a migration of an already deployed v1 database.
-- Connection initialization (not this file): foreign_keys=ON; synchronous=FULL;
-- journal_mode=DELETE; busy_timeout=5000. Keep the database on a local filesystem.
CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT INTO schema_version VALUES (1, 'set_by_deployment');
CREATE TABLE members (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, timezone TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)), active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE credentials (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK(kind IN ('login_code','browser_session','device')),
  secret_hash TEXT NOT NULL UNIQUE, device_id TEXT, expires_at INTEGER, revoked_at INTEGER
);
CREATE TABLE policies (
  id TEXT PRIMARY KEY, body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  accepted_by_json TEXT NOT NULL CHECK(json_valid(accepted_by_json)), effective_at INTEGER NOT NULL
);
CREATE TABLE agreed_rates (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
  policy_id TEXT NOT NULL REFERENCES policies(id), role TEXT NOT NULL,
  currency TEXT NOT NULL, hourly_minor INTEGER NOT NULL CHECK(hourly_minor >= 0),
  effective_at INTEGER NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json))
);
CREATE TABLE labor_buckets (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), project_key TEXT NOT NULL,
  work_date TEXT NOT NULL, rate_id TEXT NOT NULL REFERENCES agreed_rates(id),
  policy_id TEXT NOT NULL REFERENCES policies(id), current_revision INTEGER NOT NULL CHECK(current_revision>=1),
  UNIQUE(member_id,project_key,work_date,rate_id,policy_id)
);
CREATE TABLE labor_bucket_versions (
  bucket_id TEXT NOT NULL REFERENCES labor_buckets(id), revision INTEGER NOT NULL CHECK(revision>=1),
  confirmed_seconds INTEGER NOT NULL CHECK(confirmed_seconds>=0), gross_minor INTEGER NOT NULL CHECK(gross_minor>=0),
  source_manifest_json TEXT NOT NULL CHECK(json_valid(source_manifest_json)),
  state TEXT NOT NULL CHECK(state IN ('draft','posted','superseded')),
  PRIMARY KEY(bucket_id,revision)
);
CREATE TABLE market_cards (
  id TEXT PRIMARY KEY, body_json TEXT NOT NULL CHECK(json_valid(body_json)), sha256 TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), device_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL CHECK(current_revision>=1),
  ingest_state TEXT NOT NULL CHECK(ingest_state IN ('metadata','uploading','accepted'))
);
CREATE TABLE session_versions (
  session_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL CHECK(revision>=1),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)), sha256 TEXT NOT NULL,
  confirmed_seconds INTEGER NOT NULL CHECK(confirmed_seconds>=0), accepted_at INTEGER,
  PRIMARY KEY(session_id,revision)
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
  session_id TEXT REFERENCES sessions(id), sha256 TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>0),
  mime TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('declared','stored','expired','missing')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  held INTEGER NOT NULL DEFAULT 0 CHECK(held IN (0,1)), created_at INTEGER NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES members(id),
  revision INTEGER NOT NULL CHECK(revision>=1), body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  active_report_id TEXT, active_round_id TEXT
);
CREATE TABLE allocations (
  session_id TEXT NOT NULL, session_revision INTEGER NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id),
  seconds INTEGER NOT NULL CHECK(seconds>=0),
  PRIMARY KEY(session_id,session_revision,task_id),
  FOREIGN KEY(session_id,session_revision) REFERENCES session_versions(session_id,revision)
);
CREATE TABLE reports (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), revision INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES members(id), state TEXT NOT NULL CHECK(state IN ('draft','approved')),
  body_json TEXT NOT NULL CHECK(json_valid(body_json)), sha256 TEXT NOT NULL,
  approved_at INTEGER, UNIQUE(task_id,revision)
);
CREATE TABLE packets (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), report_id TEXT NOT NULL REFERENCES reports(id),
  storage_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, rate_card_id TEXT NOT NULL REFERENCES market_cards(id),
  redaction_reviewed_by TEXT NOT NULL REFERENCES members(id), created_at INTEGER NOT NULL
);
CREATE TABLE rounds (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), packet_id TEXT NOT NULL REFERENCES packets(id),
  round_number INTEGER NOT NULL, model_profile_json TEXT NOT NULL CHECK(json_valid(model_profile_json)),
  rubric_hash TEXT NOT NULL, schema_hash TEXT NOT NULL, status TEXT NOT NULL,
  aggregate_json TEXT CHECK(aggregate_json IS NULL OR json_valid(aggregate_json)),
  UNIQUE(task_id,round_number)
);
CREATE TABLE judge_slots (
  round_id TEXT NOT NULL REFERENCES rounds(id), model_key TEXT NOT NULL,
  sample_index INTEGER NOT NULL CHECK(sample_index BETWEEN 1 AND 3),
  finalized_attempt_id TEXT, finalized_answer_hash TEXT,
  PRIMARY KEY(round_id,model_key,sample_index)
);
CREATE TABLE judge_attempts (
  id TEXT PRIMARY KEY, round_id TEXT NOT NULL, model_key TEXT NOT NULL, sample_index INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number>=1), status TEXT NOT NULL,
  request_key TEXT NOT NULL, response_key TEXT, error_json TEXT, usage_json TEXT,
  FOREIGN KEY(round_id,model_key,sample_index) REFERENCES judge_slots(round_id,model_key,sample_index),
  UNIQUE(round_id,model_key,sample_index,attempt_number)
);
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK(kind IN ('cash','expense','labor','bonus','settlement','reversal')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor<>0), currency TEXT NOT NULL,
  business_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, source_id TEXT NOT NULL,
  policy_id TEXT NOT NULL REFERENCES policies(id), target_entry_id TEXT REFERENCES ledger_entries(id),
  reason TEXT NOT NULL, created_at INTEGER NOT NULL,
  CHECK((kind IN ('cash','expense','labor','bonus') AND amount_minor>0 AND target_entry_id IS NULL)
    OR (kind='settlement' AND amount_minor<0 AND target_entry_id IS NOT NULL)
    OR (kind='reversal' AND target_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX ledger_one_reversal ON ledger_entries(target_entry_id) WHERE kind='reversal';
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN
  SELECT RAISE(ABORT, 'posted entries are immutable: use a correcting entry');
END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN
  SELECT RAISE(ABORT, 'posted entries cannot be deleted');
END;
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, business_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','retry_wait','done','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at INTEGER NOT NULL, lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER, result_json TEXT, last_error TEXT
);
CREATE INDEX jobs_claim ON jobs(state,available_at,lease_until);
CREATE TABLE idempotency (
  actor_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  PRIMARY KEY(actor_id,operation,key)
);
CREATE TABLE changes (
  id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)), created_at INTEGER NOT NULL
);
