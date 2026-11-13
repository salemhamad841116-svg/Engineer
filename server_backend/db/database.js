const fs = require('fs');
const path = require('path');
const config = require('../config');

let db = null;
let DatabaseSync = null;

const MIGRATIONS = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','supervisor')),
  password_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('invited','active','disabled')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  last_login_at TEXT,
  last_logout_at TEXT,
  disabled_at TEXT,
  is_legacy_placeholder INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'invite',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT,
  connection_lost_noted INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  client TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id, ended_at);

CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  event TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX idx_session_events_user ON session_events(user_id, at);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  created_by TEXT
);

CREATE TABLE upload_batches (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  actor_id TEXT REFERENCES users(id),
  declared_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES upload_batches(id),
  owner_id TEXT REFERENCES users(id),
  actor_id TEXT REFERENCES users(id),
  title TEXT NOT NULL,
  original_filename TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('document','image','raw_text','media','url')),
  file_type TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  category_id TEXT REFERENCES categories(id),
  language TEXT NOT NULL DEFAULT 'Arabic',
  vault_path TEXT,
  storage_reference TEXT,
  source_url TEXT,
  upload_status TEXT NOT NULL DEFAULT 'stored',
  ocr_status TEXT NOT NULL DEFAULT 'not_applicable',
  index_status TEXT NOT NULL DEFAULT 'pending',
  pages_kind TEXT NOT NULL DEFAULT 'none',
  pages_total INTEGER,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  pages_estimated INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'upload',
  attribution TEXT NOT NULL DEFAULT 'verified',
  legacy_uploader TEXT,
  uploaded_at TEXT,
  processing_started_at TEXT,
  completed_at TEXT,
  lifetime_counted INTEGER NOT NULL DEFAULT 0,
  duplicate_of TEXT
);
CREATE INDEX idx_documents_owner ON documents(owner_id);
CREATE INDEX idx_documents_category ON documents(category_id);
CREATE INDEX idx_documents_batch ON documents(batch_id);
CREATE INDEX idx_documents_sha ON documents(sha256);
CREATE INDEX idx_documents_status ON documents(index_status);

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  attempt INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE UNIQUE INDEX idx_jobs_active_doc ON processing_jobs(document_id) WHERE status IN ('queued','running');

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  page INTEGER,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chunks_doc ON chunks(document_id);

CREATE TABLE system_flags (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  supervisor_id TEXT,
  supervisor_name TEXT,
  document_id TEXT,
  batch_id TEXT,
  title TEXT,
  filename TEXT,
  kind TEXT,
  file_type TEXT,
  size_bytes INTEGER,
  category_id TEXT,
  category_name TEXT,
  pages_total INTEGER,
  pages_processed INTEGER,
  pages_failed INTEGER,
  upload_status TEXT,
  ocr_status TEXT,
  index_status TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  failure_reason TEXT,
  completed_at TEXT,
  counts_lifetime INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  ip TEXT
);
CREATE INDEX idx_audit_at ON audit_events(at);
CREATE INDEX idx_audit_supervisor ON audit_events(supervisor_id, at);
CREATE INDEX idx_audit_action ON audit_events(action);
CREATE INDEX idx_audit_doc ON audit_events(document_id);
CREATE INDEX idx_audit_batch ON audit_events(batch_id);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
WHEN COALESCE((SELECT value FROM system_flags WHERE key = 'audit_purge'), '0') != '1'
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TRIGGER session_events_no_update BEFORE UPDATE ON session_events
BEGIN SELECT RAISE(ABORT, 'session_events is append-only'); END;

CREATE TRIGGER session_events_no_delete BEFORE DELETE ON session_events
BEGIN SELECT RAISE(ABORT, 'session_events is append-only'); END;
`,
  },
  {
    id: 2,
    name: 'phase3_dms_schema',
    sql: `
ALTER TABLE categories ADD COLUMN name_key TEXT;
ALTER TABLE documents ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN raw_text TEXT;

CREATE TABLE IF NOT EXISTS book_pages (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  vault_path TEXT NOT NULL,
  ocr_text TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_pages_book ON book_pages(book_id, page_number);

UPDATE documents SET page_count = COALESCE(pages_total, pages_processed, 1) WHERE page_count = 0;
`,
  },
  {
    id: 3,
    name: 'phase4_system_settings',
    sql: `
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_enc TEXT,
  is_secret INTEGER NOT NULL DEFAULT 1,
  meta TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id)
);
`,
  },
  {
    // Phase 5 (open-source AI): every chunk records the embedding model that produced it.
    // Vectors from different models are not comparable, so search only uses chunks whose
    // model matches the active one. Existing chunks were produced by Gemini.
    id: 4,
    name: 'phase5_embedding_model_tag',
    sql: `
ALTER TABLE chunks ADD COLUMN embed_model TEXT;
UPDATE chunks SET embed_model = 'gemini-embedding-001' WHERE embed_model IS NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_embed_model ON chunks(embed_model);
`,
  },
  {
    // High-priority job queue: fresh user uploads jump ahead of background batch retries.
    id: 5,
    name: 'processing_jobs_priority',
    sql: `
ALTER TABLE processing_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_jobs_priority_queued ON processing_jobs(status, priority, queued_at);
UPDATE processing_jobs SET priority = 10 WHERE status = 'queued' AND document_id IN (SELECT id FROM documents WHERE uploaded_at >= datetime('now', '-1 day'));
`,
    up(handle) {
      const cols = handle.prepare("PRAGMA table_info('processing_jobs')").all();
      const hasPriority = cols.some((c) => c.name === 'priority');
      if (!hasPriority) {
        handle.exec('ALTER TABLE processing_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
      }
      handle.exec('CREATE INDEX IF NOT EXISTS idx_jobs_priority_queued ON processing_jobs(status, priority, queued_at)');
      handle.exec("UPDATE processing_jobs SET priority = 10 WHERE status = 'queued' AND document_id IN (SELECT id FROM documents WHERE uploaded_at >= datetime('now', '-1 day'))");
    },
  },
  {
    // Phase 6: Sanea App Builder integration (projects, requests, files, app_source client separation)
    id: 6,
    name: 'sanea_builder_integration',
    sql: `
ALTER TABLE users ADD COLUMN app_source TEXT NOT NULL DEFAULT 'chathsm';
CREATE INDEX IF NOT EXISTS idx_users_app_source ON users(app_source);

CREATE TABLE IF NOT EXISTS app_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT,
  slug TEXT UNIQUE,
  html TEXT,
  quality_status TEXT NOT NULL DEFAULT 'draft',
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'in_progress', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_projects_user ON app_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_app_projects_status ON app_projects(status);

CREATE TABLE IF NOT EXISTS app_project_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES app_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'feature',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'in_progress', 'completed', 'cancelled')),
  admin_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_requests_project ON app_project_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_app_requests_user ON app_project_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_app_requests_status ON app_project_requests(status);

CREATE TABLE IF NOT EXISTS app_project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT,
  vault_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_files_project ON app_project_files(project_id);
`,
    up(handle) {
      const userCols = handle.prepare("PRAGMA table_info('users')").all();
      const hasAppSource = userCols.some((c) => c.name === 'app_source');
      if (!hasAppSource) {
        handle.exec("ALTER TABLE users ADD COLUMN app_source TEXT NOT NULL DEFAULT 'chathsm'");
      }
      handle.exec('CREATE INDEX IF NOT EXISTS idx_users_app_source ON users(app_source)');

      handle.exec(`
CREATE TABLE IF NOT EXISTS app_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT,
  slug TEXT UNIQUE,
  html TEXT,
  quality_status TEXT NOT NULL DEFAULT 'draft',
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'in_progress', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_projects_user ON app_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_app_projects_status ON app_projects(status);

CREATE TABLE IF NOT EXISTS app_project_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES app_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'feature',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'in_progress', 'completed', 'cancelled')),
  admin_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_requests_project ON app_project_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_app_requests_user ON app_project_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_app_requests_status ON app_project_requests(status);

CREATE TABLE IF NOT EXISTS app_project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT,
  vault_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_files_project ON app_project_files(project_id);
      `);
    },
  },
  {
    // Phase 7: Engineer Advanced Intelligence & Continuous Improvement
    id: 7,
    name: 'engineer_intelligence_v2',
    sql: `
CREATE TABLE IF NOT EXISTS app_project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  plan_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'verified', 'failed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_versions_project ON app_project_versions(project_id, version_number);

CREATE TABLE IF NOT EXISTS app_project_files_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES app_project_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  requirement_ids TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_files_v2_version ON app_project_files_v2(version_id);
CREATE INDEX IF NOT EXISTS idx_app_files_v2_project ON app_project_files_v2(project_id);

CREATE TABLE IF NOT EXISTS app_project_memory (
  project_id TEXT PRIMARY KEY REFERENCES app_projects(id) ON DELETE CASCADE,
  tech_stack TEXT NOT NULL DEFAULT '{}',
  decisions TEXT NOT NULL DEFAULT '[]',
  learned_fixes TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_project_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES app_project_versions(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL DEFAULT 'build_and_test' CHECK (run_type IN ('build_and_test', 'repair', 'manual_test')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed', 'repaired')),
  test_report_json TEXT,
  logs_json TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  repair_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_runs_project ON app_project_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_app_runs_status ON app_project_runs(status);

CREATE TABLE IF NOT EXISTS app_benchmark_results (
  id TEXT PRIMARY KEY,
  benchmark_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'running')),
  pass_rate REAL NOT NULL DEFAULT 0.0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL NOT NULL DEFAULT 0.0,
  report_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benchmarks_name ON app_benchmark_results(benchmark_name);
`,
    up(handle) {
      handle.exec(`
CREATE TABLE IF NOT EXISTS app_project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  plan_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'verified', 'failed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_versions_project ON app_project_versions(project_id, version_number);

CREATE TABLE IF NOT EXISTS app_project_files_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES app_project_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  requirement_ids TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_files_v2_version ON app_project_files_v2(version_id);
CREATE INDEX IF NOT EXISTS idx_app_files_v2_project ON app_project_files_v2(project_id);

CREATE TABLE IF NOT EXISTS app_project_memory (
  project_id TEXT PRIMARY KEY REFERENCES app_projects(id) ON DELETE CASCADE,
  tech_stack TEXT NOT NULL DEFAULT '{}',
  decisions TEXT NOT NULL DEFAULT '[]',
  learned_fixes TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_project_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES app_projects(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES app_project_versions(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL DEFAULT 'build_and_test' CHECK (run_type IN ('build_and_test', 'repair', 'manual_test')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed', 'repaired')),
  test_report_json TEXT,
  logs_json TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  repair_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_runs_project ON app_project_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_app_runs_status ON app_project_runs(status);

CREATE TABLE IF NOT EXISTS app_benchmark_results (
  id TEXT PRIMARY KEY,
  benchmark_name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'running')),
  pass_rate REAL NOT NULL DEFAULT 0.0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL NOT NULL DEFAULT 0.0,
  report_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benchmarks_name ON app_benchmark_results(benchmark_name);
      `);
    },
  },
  {
    id: 8,
    name: 'voice_library',
    up(handle) {
      handle.exec(`
CREATE TABLE IF NOT EXISTS voice_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  speaker_gender TEXT DEFAULT 'unspecified',
  language TEXT DEFAULT 'ar',
  description TEXT,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  duration_seconds REAL NOT NULL DEFAULT 0.0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_voice_library_active ON voice_library(is_active);
CREATE INDEX IF NOT EXISTS idx_voice_library_created ON voice_library(created_at);
      `);
    },
  },
  {
    id: 9,
    name: 'autonomous_agent_core',
    up(handle) {
      handle.exec(`
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  autonomy_level TEXT NOT NULL DEFAULT 'autonomous',
  status TEXT NOT NULL DEFAULT 'running',
  steps_log_json TEXT NOT NULL DEFAULT '[]',
  undo_snapshot_json TEXT NOT NULL DEFAULT '{}',
  resource_metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_project ON agent_tasks(project_id);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  command TEXT,
  file_path TEXT,
  risk_level TEXT NOT NULL DEFAULT 'high',
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_task ON agent_approvals(task_id);

CREATE TABLE IF NOT EXISTS agent_memory_lessons (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'general',
  project_id TEXT,
  error_signature TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  verified_solution TEXT NOT NULL,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_lessons_sig ON agent_memory_lessons(error_signature);

CREATE TABLE IF NOT EXISTS agent_deployments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'deploying',
  health_status TEXT NOT NULL DEFAULT 'pending',
  url TEXT,
  rollback_snapshot_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_deployments_project ON agent_deployments(project_id);
      `);
    },
  },
  {
    id: 10,
    name: 'security_tenant_guard_and_verbatim_chunks',
    up(handle) {
      const ensureCol = (table, col, def) => {
        try {
          const cols = handle.prepare("PRAGMA table_info('" + table + "')").all();
          if (!cols.some((c) => c.name === col)) {
            handle.exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + def);
          }
        } catch (_) {}
      };

      handle.exec(`
CREATE TABLE IF NOT EXISTS book_structures (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  toc_json TEXT NOT NULL DEFAULT '[]',
  chapters_json TEXT NOT NULL DEFAULT '[]',
  author TEXT DEFAULT 'غير محدد',
  edition TEXT DEFAULT 'طبعة معتمدة',
  publication_year INTEGER DEFAULT 2024,
  language TEXT DEFAULT 'Arabic',
  total_pages INTEGER DEFAULT 1,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  tenant_id TEXT,
  title TEXT NOT NULL,
  query TEXT NOT NULL,
  research_level TEXT NOT NULL DEFAULT 'deep',
  status TEXT NOT NULL DEFAULT 'running',
  current_stage TEXT NOT NULL DEFAULT '1_understanding',
  stages_json TEXT NOT NULL DEFAULT '[]',
  plan_json TEXT NOT NULL DEFAULT '{}',
  findings_json TEXT NOT NULL DEFAULT '[]',
  quality_gate_json TEXT NOT NULL DEFAULT '{}',
  answer_markdown TEXT,
  summary TEXT,
  uncertainties TEXT,
  token_count INTEGER DEFAULT 0,
  cost_estimate REAL DEFAULT 0.0,
  is_offline INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_citations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT,
  book_id TEXT,
  book_title TEXT NOT NULL,
  author TEXT,
  edition TEXT,
  chapter TEXT,
  page_number INTEGER DEFAULT 1,
  source_url TEXT,
  quote_exact TEXT NOT NULL,
  quote_context_before TEXT,
  quote_context_after TEXT,
  verified_grounded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
      `);

      ensureCol('book_structures', 'tenant_id', 'TEXT');
      ensureCol('research_sessions', 'tenant_id', 'TEXT');
      ensureCol('research_citations', 'tenant_id', 'TEXT');
      ensureCol('documents', 'tenant_id', 'TEXT');
      ensureCol('documents', 'is_shared_library', 'INTEGER NOT NULL DEFAULT 0');
      ensureCol('chunks', 'verbatim_raw_chunk', 'TEXT');

      handle.exec('CREATE INDEX IF NOT EXISTS idx_book_structures_book ON book_structures(book_id)');
      handle.exec('CREATE INDEX IF NOT EXISTS idx_book_structures_tenant ON book_structures(tenant_id)');
      handle.exec('CREATE INDEX IF NOT EXISTS idx_research_sessions_user ON research_sessions(user_id)');
      handle.exec('CREATE INDEX IF NOT EXISTS idx_research_sessions_tenant ON research_sessions(tenant_id)');
      handle.exec('CREATE INDEX IF NOT EXISTS idx_research_citations_session ON research_citations(session_id)');
      handle.exec('CREATE INDEX IF NOT EXISTS idx_research_citations_tenant ON research_citations(tenant_id)');
      handle.exec('CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id)');
      handle.exec('CREATE INDEX IF NOT EXISTS idx_documents_shared ON documents(is_shared_library)');
    },
  },
  {
    id: 11,
    name: 'adversarial_hardening_audit_and_memory',
    up(handle) {
      const ensureCol = (table, col, def) => {
        try {
          const cols = handle.prepare("PRAGMA table_info('" + table + "')").all();
          if (!cols.some((c) => c.name === col)) {
            handle.exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + def);
          }
        } catch (_) {}
      };

      handle.exec(`
CREATE TABLE IF NOT EXISTS agent_audit_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  timestamp TEXT NOT NULL,
  action_type TEXT NOT NULL,
  task_prompt TEXT,
  affected_files_json TEXT NOT NULL DEFAULT '[]',
  safety_decision TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  actor_id TEXT DEFAULT 'autonomous_agent'
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_task ON agent_audit_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_action ON agent_audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_agent_audit_time ON agent_audit_logs(timestamp);
      `);

      ensureCol('agent_memory_lessons', 'has_conflict', 'INTEGER NOT NULL DEFAULT 0');
      ensureCol('agent_memory_lessons', 'conflict_notes', 'TEXT');
      ensureCol('agent_memory_lessons', 'last_recalled_at', 'TEXT');
      ensureCol('agent_memory_lessons', 'is_cold', 'INTEGER NOT NULL DEFAULT 0');
      ensureCol('agent_memory_lessons', 'proven_fix', 'TEXT');
      ensureCol('agent_memory_lessons', 'code_after', 'TEXT');
      ensureCol('agent_memory_lessons', 'code_before', 'TEXT');
    },
  },
  {
    id: 12,
    name: 'agent_tasks_suspended_resources_status',
    up(handle) {
      handle.exec(`
        PRAGMA foreign_keys=OFF;
        CREATE TABLE IF NOT EXISTS agent_tasks_new (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'self_healing', 'waiting_approval', 'completed', 'failed', 'rolled_back', 'suspended_resources')),
          autonomy_level TEXT NOT NULL DEFAULT 'autonomous' CHECK (autonomy_level IN ('autonomous', 'supervised', 'step_by_step')),
          current_step TEXT NOT NULL DEFAULT 'initializing',
          steps_log_json TEXT NOT NULL DEFAULT '[]',
          decisions_json TEXT NOT NULL DEFAULT '[]',
          error_context_json TEXT NOT NULL DEFAULT '{}',
          repair_attempts INTEGER NOT NULL DEFAULT 0,
          undo_snapshot_json TEXT,
          resource_metrics_json TEXT NOT NULL DEFAULT '{}',
          deployment_record_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      const oldCols = handle.prepare("PRAGMA table_info('agent_tasks')").all().map((c) => c.name);
      const newCols = handle.prepare("PRAGMA table_info('agent_tasks_new')").all().map((c) => c.name);
      const sharedCols = oldCols.filter((col) => newCols.includes(col)).join(', ');
      if (sharedCols.length > 0) {
        handle.exec(`INSERT OR IGNORE INTO agent_tasks_new (${sharedCols}) SELECT ${sharedCols} FROM agent_tasks;`);
      }

      handle.exec(`
        DROP TABLE agent_tasks;
        ALTER TABLE agent_tasks_new RENAME TO agent_tasks;
        CREATE INDEX IF NOT EXISTS idx_agent_tasks_project ON agent_tasks(project_id);
        PRAGMA foreign_keys=ON;
      `);
    },
  },
  {
    id: 13,
    name: 'phase6_deep_research_and_hybrid_knowledge',
    up(handle) {
      const ensureCol = (table, col, def) => {
        try {
          const cols = handle.prepare("PRAGMA table_info('" + table + "')").all();
          if (!cols.some((c) => c.name === col)) {
            handle.exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + def);
          }
        } catch (_) {}
      };

      ensureCol('chunks', 'byte_start', 'INTEGER DEFAULT 0');
      ensureCol('chunks', 'byte_end', 'INTEGER DEFAULT 0');
      ensureCol('chunks', 'embedding_blob', 'BLOB');
      ensureCol('documents', 'is_latest_edition', 'INTEGER DEFAULT 1');
      ensureCol('documents', 'edition_notes', 'TEXT');
      ensureCol('research_sessions', 'budget_limit', 'REAL DEFAULT 0.01');
      ensureCol('research_sessions', 'loop_count', 'INTEGER DEFAULT 1');
      ensureCol('research_sessions', 'max_loops', 'INTEGER DEFAULT 3');
      ensureCol('research_sessions', 'cross_lingual', 'INTEGER DEFAULT 0');
      ensureCol('research_citations', 'byte_start', 'INTEGER DEFAULT 0');
      ensureCol('research_citations', 'byte_end', 'INTEGER DEFAULT 0');

      handle.exec(`
CREATE TABLE IF NOT EXISTS research_evidence (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  book_title TEXT NOT NULL,
  author TEXT DEFAULT 'غير محدد',
  chapter TEXT DEFAULT 'الفصل العام',
  page_number INTEGER DEFAULT 1,
  byte_start INTEGER DEFAULT 0,
  byte_end INTEGER DEFAULT 0,
  key_fact TEXT NOT NULL,
  exact_quote TEXT NOT NULL,
  quote_confidence REAL NOT NULL DEFAULT 1.0,
  is_verified INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_evidence_session ON research_evidence(session_id);
CREATE INDEX IF NOT EXISTS idx_research_evidence_tenant ON research_evidence(tenant_id);
CREATE INDEX IF NOT EXISTS idx_research_evidence_book ON research_evidence(book_id);

CREATE TABLE IF NOT EXISTS golden_evaluation_dataset (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  category TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  expected_books_json TEXT NOT NULL DEFAULT '[]',
  expected_quotes_json TEXT NOT NULL DEFAULT '[]',
  min_quality_score REAL NOT NULL DEFAULT 7.0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_golden_dataset_category ON golden_evaluation_dataset(category);

CREATE TABLE IF NOT EXISTS research_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT,
  citation_id TEXT,
  feedback_type TEXT NOT NULL,
  user_comment TEXT,
  quality_gate_passed INTEGER NOT NULL DEFAULT 1,
  quality_gate_score TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_feedback_session ON research_feedback(session_id);

UPDATE documents SET is_shared_library = 1 WHERE (tenant_id IS NULL OR tenant_id = 'system_library') AND (id LIKE 'book_%' OR id LIKE 'spec_%') AND id NOT IN ('book_alpha_confidential_2026', 'book_beta_proprietary_2026', 'book_verbatim_test_01');
      `);
    },
  },
  {
    id: 14,
    name: 'research_citations_byte_offsets',
    up(handle) {
      const ensureCol = (table, col, def) => {
        try {
          const cols = handle.prepare("PRAGMA table_info('" + table + "')").all();
          if (!cols.some((c) => c.name === col)) {
            handle.exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + def);
          }
        } catch (_) {}
      };

      ensureCol('research_citations', 'byte_start', 'INTEGER DEFAULT 0');
      ensureCol('research_citations', 'byte_end', 'INTEGER DEFAULT 0');
    },
  },
  {
    id: 15,
    name: 'research_feedback_tenant_and_quality_gate',
    up(handle) {
      const ensureCol = (table, col, def) => {
        try {
          const cols = handle.prepare("PRAGMA table_info('" + table + "')").all();
          if (!cols.some((c) => c.name === col)) {
            handle.exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + def);
          }
        } catch (_) {}
      };

      ensureCol('research_feedback', 'tenant_id', 'TEXT');
      ensureCol('research_feedback', 'quality_gate_passed', 'INTEGER NOT NULL DEFAULT 1');
      ensureCol('research_feedback', 'quality_gate_score', 'TEXT');
    },
  },
  {
    id: 16,
    name: 'phase7_web_verification_and_pdf_extracts',
    up(handle) {
      handle.exec(`
CREATE TABLE IF NOT EXISTS web_verification_cache (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  title TEXT,
  clean_content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('standard_spec', 'software_release', 'general')),
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  http_status INTEGER NOT NULL DEFAULT 200,
  is_stale INTEGER NOT NULL DEFAULT 0,
  source_metadata_json TEXT DEFAULT '{}',
  tenant_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_cache_url ON web_verification_cache(url);
CREATE INDEX IF NOT EXISTS idx_web_cache_domain ON web_verification_cache(domain);
CREATE INDEX IF NOT EXISTS idx_web_cache_expires ON web_verification_cache(expires_at);

CREATE TABLE IF NOT EXISTS document_tables (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  table_idx INTEGER NOT NULL DEFAULT 1,
  caption TEXT,
  markdown_table TEXT NOT NULL,
  csv_content TEXT,
  json_data TEXT NOT NULL DEFAULT '[]',
  byte_start INTEGER DEFAULT 0,
  byte_end INTEGER DEFAULT 0,
  tenant_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_tables_doc ON document_tables(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_tables_page ON document_tables(document_id, page_number);

CREATE TABLE IF NOT EXISTS document_figures (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  figure_idx INTEGER NOT NULL DEFAULT 1,
  figure_number TEXT,
  caption TEXT NOT NULL,
  figure_type TEXT DEFAULT 'diagram',
  byte_offset INTEGER DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',
  tenant_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_figures_doc ON document_figures(document_id);
      `);
    },
  },
  {
    id: 17,
    name: 'phase8_operations_and_sanitized_alerts',
    up(handle) {
      handle.exec(`
CREATE TABLE IF NOT EXISTS system_alert_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('info', 'warning', 'error', 'critical')),
  category TEXT NOT NULL CHECK(category IN ('memory', 'disk', 'health', 'security', 'backup', 'general')),
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  is_resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT,
  tenant_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_logs_time ON system_alert_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_alert_logs_level ON system_alert_logs(level);
CREATE INDEX IF NOT EXISTS idx_alert_logs_cat ON system_alert_logs(category);
      `);
    },
  },
  {
    id: 18,
    name: 'phase9_admin_subdomain_and_rbac',
    up(handle) {
      handle.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'support_agent')),
  password_hash TEXT NOT NULL,
  totp_secret TEXT NOT NULL,
  totp_enabled INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')) DEFAULT 'active',
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(admin_user_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id),
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_user ON admin_recovery_codes(admin_user_id, used_at);

CREATE TABLE IF NOT EXISTS admin_audit_actions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  justification TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user ON admin_audit_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_actions(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit_actions(created_at);

CREATE TABLE IF NOT EXISTS admin_content_flags (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  reporter_user_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'in_review', 'resolved', 'dismissed')) DEFAULT 'new',
  assigned_to TEXT REFERENCES admin_users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_flags_status ON admin_content_flags(status);
CREATE INDEX IF NOT EXISTS idx_admin_flags_content ON admin_content_flags(content_type, content_id);

CREATE TABLE IF NOT EXISTS admin_ip_whitelist (
  id TEXT PRIMARY KEY,
  ip_or_cidr TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL
);
      `);
    },
  },
  {
    id: 19,
    name: 'user_profile_and_settings',
    up: (handle) => {
      function ensureCol(table, colName, colDef) {
        const cols = handle.prepare(`PRAGMA table_info('${table}')`).all();
        if (!cols.some((c) => c.name === colName)) {
          handle.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
        }
      }

      ensureCol('users', 'avatar_url', 'TEXT DEFAULT NULL');
      ensureCol('users', 'storage_quota_bytes', 'INTEGER NOT NULL DEFAULT 104857600');
      ensureCol('admin_users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
      handle.exec("UPDATE admin_users SET must_change_password = 1 WHERE created_by = 'system_bootstrap'");

      handle.exec(`
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'en')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  default_research_tier TEXT NOT NULL DEFAULT 'deep' CHECK (default_research_tier IN ('quick', 'deep', 'expert')),
  show_page_numbers INTEGER NOT NULL DEFAULT 1 CHECK (show_page_numbers IN (0, 1)),
  answer_length TEXT NOT NULL DEFAULT 'detailed' CHECK (answer_length IN ('concise', 'detailed')),
  show_quality_badges INTEGER NOT NULL DEFAULT 1 CHECK (show_quality_badges IN (0, 1)),
  retain_search_history INTEGER NOT NULL DEFAULT 1 CHECK (retain_search_history IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
      `);
    },
  },
  {
    id: 20,
    name: 'phase12_launch_trust_quotas_and_onboarding',
    up: (handle) => {
      function ensureCol(table, colName, colDef) {
        const cols = handle.prepare(`PRAGMA table_info('${table}')`).all();
        if (!cols.some((c) => c.name === colName)) {
          handle.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
        }
      }

      // 1. User verification, legal consent, demo and abuse tracking
      ensureCol('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
      ensureCol('users', 'email_verified_at', 'TEXT DEFAULT NULL');
      ensureCol('users', 'terms_accepted_at', 'TEXT DEFAULT NULL');
      ensureCol('users', 'terms_version', 'TEXT DEFAULT NULL');
      ensureCol('users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
      ensureCol('users', 'plan_id', "TEXT NOT NULL DEFAULT 'free'");
      ensureCol('users', 'registration_ip', 'TEXT DEFAULT NULL');
      ensureCol('users', 'device_fingerprint', 'TEXT DEFAULT NULL');

      // 2. Email verification tokens (24h TTL)
      handle.exec(`
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verify_token_hash ON email_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_verify_token_user ON email_verification_tokens(user_id);
      `);

      // 3. Password reset tokens (15-minute TTL, single-use)
      handle.exec(`
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_token_user ON password_reset_tokens(user_id);
      `);

      // 4. Usage counters table (10 points/day free tier, resets at UTC midnight)
      handle.exec(`
CREATE TABLE IF NOT EXISTS usage_counters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'free',
  period_date TEXT NOT NULL,
  points_allocated INTEGER NOT NULL DEFAULT 10,
  points_used INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, period_date)
);
CREATE INDEX IF NOT EXISTS idx_usage_user_period ON usage_counters(user_id, period_date);
      `);

      // 5. Onboarding tour completion in user_settings
      ensureCol('user_settings', 'onboarding_completed', 'INTEGER NOT NULL DEFAULT 0');
      ensureCol('user_settings', 'onboarding_step', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    id: 21,
    name: 'phase13_service_api_keys_and_external_ingest',
    up: (handle) => {
      handle.exec(`
CREATE TABLE IF NOT EXISTS service_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["books:crud"]',
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT DEFAULT NULL,
  created_by TEXT REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  last_used_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_key_hash ON service_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_service_key_revoked ON service_api_keys(is_revoked);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  service_key_id TEXT NOT NULL REFERENCES service_api_keys(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys(idempotency_key, service_key_id);

CREATE TABLE IF NOT EXISTS service_api_audit_logs (
  id TEXT PRIMARY KEY,
  service_key_id TEXT,
  action TEXT NOT NULL,
  user_id TEXT,
  book_id TEXT,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_audit_key ON service_api_audit_logs(service_key_id);
CREATE INDEX IF NOT EXISTS idx_service_audit_action ON service_api_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_service_audit_user ON service_api_audit_logs(user_id);
      `);
    },
  },
  {
    id: 22,
    name: 'phase13_delegated_tokens_and_security_hardening',
    up: (handle) => {
      handle.exec(`
CREATE TABLE IF NOT EXISTS delegated_ingest_tokens (
  id TEXT PRIMARY KEY,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  service_key_id TEXT REFERENCES service_api_keys(id),
  scopes_json TEXT NOT NULL DEFAULT '["books:ingest"]',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT DEFAULT NULL,
  last_used_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegated_token_hash ON delegated_ingest_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_delegated_token_user ON delegated_ingest_tokens(user_id);
      `);
    },
  },
  {
    id: 23,
    name: 'phase14_subscriptions_and_payment_webhooks',
    up: (handle) => {
      handle.exec(`
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  daily_points INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'aed',
  stripe_price_id TEXT DEFAULT NULL,
  stripe_product_id TEXT DEFAULT NULL,
  features_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO subscription_plans (id, name_ar, name_en, daily_points, price_cents, currency, stripe_price_id, stripe_product_id, features_json, is_active, created_at, updated_at)
VALUES
  ('free', 'الخطة الأساسية المجانية', 'Free Starter', 10, 0, 'aed', NULL, NULL, '["10 نقاط بحث يومية","محرك Deep متوازن","فهرسة الكتب حتى 100MB"]', 1, datetime('now'), datetime('now')),
  ('pro', 'خطة المحترفين', 'Pro Professional', 100, 7900, 'aed', 'price_pro_aed_monthly', 'prod_pro_tier', '["100 نقطة بحث يومية","أولوية معالجة في نموذج Expert","تجربة مجانية 7 أيام","فهرسة كتب موسعة حتى 2GB","دعم فني مباشر"]', 1, datetime('now'), datetime('now')),
  ('enterprise', 'خطة المؤسسات والشركات', 'Enterprise Tier', 1000, 29900, 'aed', 'price_ent_aed_monthly', 'prod_enterprise_tier', '["1000 نقطة بحث يومية","أولوية قصوى ونماذج غير محدودة","مفاتيح ربط API متعددة","ضمان مستوى الخدمة SLA 99.9%"]', 1, datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at TEXT DEFAULT NULL,
  trial_start TEXT DEFAULT NULL,
  trial_end TEXT DEFAULT NULL,
  grace_period_end TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'stripe',
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed'
);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_type ON payment_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_provider ON payment_webhook_events(provider);

CREATE TABLE IF NOT EXISTS payment_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  subscription_id TEXT,
  provider TEXT NOT NULL DEFAULT 'stripe',
  action TEXT NOT NULL,
  amount_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'aed',
  status TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_audit_user ON payment_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_action ON payment_audit_logs(action);
      `);
    },
  },
  {
    id: 24,
    name: 'phase15_enterprise_super_admin_control_center',
    up: (handle) => {
      handle.exec(`
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  api_endpoint TEXT NOT NULL,
  key_ciphertext TEXT,
  key_iv TEXT,
  key_tag TEXT,
  key_prefix TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error', 'rate_limited')),
  priority INTEGER NOT NULL DEFAULT 1,
  fallback_provider_id TEXT REFERENCES ai_providers(id),
  daily_budget_usd REAL NOT NULL DEFAULT 50.0,
  monthly_budget_usd REAL NOT NULL DEFAULT 1000.0,
  cost_incurred_today_usd REAL NOT NULL DEFAULT 0.0,
  cost_incurred_month_usd REAL NOT NULL DEFAULT 0.0,
  total_tokens_consumed INTEGER NOT NULL DEFAULT 0,
  total_requests_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  supported_models_json TEXT NOT NULL DEFAULT '[]',
  default_model_coding TEXT,
  default_model_chat TEXT,
  default_model_research TEXT,
  last_tested_at TEXT DEFAULT NULL,
  last_test_latency_ms INTEGER DEFAULT 0,
  last_test_status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_status ON ai_providers(status);
CREATE INDEX IF NOT EXISTS idx_ai_providers_priority ON ai_providers(priority);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES ai_providers(id),
  model TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  project_id TEXT,
  request_type TEXT NOT NULL DEFAULT 'chat',
  tokens_prompt INTEGER NOT NULL DEFAULT 0,
  tokens_completion INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'rate_limited')),
  error_message TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_events(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_events(created_at);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT DEFAULT NULL,
  bio TEXT DEFAULT NULL,
  company TEXT DEFAULT NULL,
  country_code TEXT DEFAULT 'AE',
  country_name TEXT DEFAULT 'United Arab Emirates',
  city TEXT DEFAULT 'Dubai',
  device_type TEXT DEFAULT 'desktop',
  os TEXT DEFAULT 'macOS',
  browser TEXT DEFAULT 'Chrome',
  last_ip TEXT DEFAULT '127.0.0.1',
  is_banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT DEFAULT NULL,
  suspended_until TEXT DEFAULT NULL,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_usage_seconds INTEGER NOT NULL DEFAULT 0,
  active_work_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  total_ai_requests INTEGER NOT NULL DEFAULT 0,
  total_ai_cost_usd REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_country ON user_profiles(country_code);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  ip TEXT NOT NULL,
  country_code TEXT DEFAULT 'AE',
  country_name TEXT DEFAULT 'United Arab Emirates',
  device_type TEXT DEFAULT 'desktop',
  os TEXT DEFAULT 'macOS',
  browser TEXT DEFAULT 'Chrome',
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  ended_at TEXT DEFAULT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  page_views INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_token ON guest_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_started ON guest_sessions(started_at);

CREATE TABLE IF NOT EXISTS presence_heartbeats (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0,
  current_page TEXT NOT NULL DEFAULT '/',
  current_project_id TEXT DEFAULT NULL,
  state TEXT NOT NULL CHECK (state IN ('online', 'idle', 'offline')),
  ip TEXT NOT NULL,
  user_agent TEXT DEFAULT NULL,
  client_timestamp TEXT NOT NULL,
  server_timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_user ON presence_heartbeats(user_id);
CREATE INDEX IF NOT EXISTS idx_presence_session ON presence_heartbeats(session_id);
CREATE INDEX IF NOT EXISTS idx_presence_server_time ON presence_heartbeats(server_timestamp);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  project_type TEXT DEFAULT 'web',
  template TEXT DEFAULT 'react-vite',
  build_status TEXT DEFAULT 'success' CHECK (build_status IN ('idle', 'building', 'success', 'failed')),
  test_status TEXT DEFAULT 'passed' CHECK (test_status IN ('idle', 'running', 'passed', 'failed')),
  last_deployment_status TEXT DEFAULT 'live',
  last_deployed_at TEXT DEFAULT NULL,
  total_work_seconds INTEGER NOT NULL DEFAULT 0,
  code_generations_count INTEGER NOT NULL DEFAULT 0,
  fixes_count INTEGER NOT NULL DEFAULT 0,
  primary_model TEXT DEFAULT 'qwen2.5:7b',
  ai_cost_usd REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(build_status);

CREATE TABLE IF NOT EXISTS project_activity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  details_json TEXT DEFAULT '{}',
  duration_seconds INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_activity_project ON project_activity(project_id);

CREATE TABLE IF NOT EXISTS user_search_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  query_type TEXT NOT NULL DEFAULT 'code',
  model_used TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  cost_usd REAL NOT NULL DEFAULT 0.0,
  prompt_preview TEXT NOT NULL,
  full_prompt_encrypted TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_events_user ON user_search_events(user_id);
CREATE INDEX IF NOT EXISTS idx_search_events_created ON user_search_events(created_at);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  environment TEXT NOT NULL DEFAULT 'production',
  status TEXT NOT NULL CHECK (status IN ('pending', 'deploying', 'live', 'failed', 'rolled_back')),
  commit_hash TEXT DEFAULT NULL,
  build_logs_snippet TEXT DEFAULT NULL,
  deployed_url TEXT DEFAULT NULL,
  duration_seconds INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);

CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  suite_name TEXT NOT NULL,
  total_tests INTEGER NOT NULL DEFAULT 0,
  passed_tests INTEGER NOT NULL DEFAULT 0,
  failed_tests INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  logs_snippet TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_runs_project ON test_runs(project_id);

CREATE TABLE IF NOT EXISTS system_notifications (
  id TEXT PRIMARY KEY,
  target_role TEXT NOT NULL DEFAULT 'all',
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_by TEXT DEFAULT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_system_notifications_read ON system_notifications(is_read);
      `);

      // Seed initial 9 AI providers
      const seedProviders = [
        { id: 'prov_openai', name: 'OpenAI', type: 'openai', endpoint: 'https://api.openai.com/v1', priority: 1, models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o3-mini'], defaultCoding: 'gpt-4o', defaultChat: 'gpt-4o-mini', defaultResearch: 'o1-preview' },
        { id: 'prov_anthropic', name: 'Anthropic Claude', type: 'anthropic', endpoint: 'https://api.anthropic.com/v1', priority: 2, models: ['claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'], defaultCoding: 'claude-3-7-sonnet-20250219', defaultChat: 'claude-3-5-haiku-20241022', defaultResearch: 'claude-3-7-sonnet-20250219' },
        { id: 'prov_gemini', name: 'Google Gemini / Vertex AI', type: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', priority: 3, models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'], defaultCoding: 'gemini-2.0-flash', defaultChat: 'gemini-2.0-flash', defaultResearch: 'gemini-1.5-pro' },
        { id: 'prov_xai', name: 'xAI Grok', type: 'xai', endpoint: 'https://api.x.ai/v1', priority: 4, models: ['grok-2', 'grok-2-mini', 'grok-beta'], defaultCoding: 'grok-2', defaultChat: 'grok-2-mini', defaultResearch: 'grok-2' },
        { id: 'prov_mistral', name: 'Mistral AI', type: 'mistral', endpoint: 'https://api.mistral.ai/v1', priority: 5, models: ['mistral-large-latest', 'codestral-latest', 'mistral-small-latest'], defaultCoding: 'codestral-latest', defaultChat: 'mistral-small-latest', defaultResearch: 'mistral-large-latest' },
        { id: 'prov_cohere', name: 'Cohere', type: 'cohere', endpoint: 'https://api.cohere.com/v2', priority: 6, models: ['command-r-plus', 'command-r', 'embed-multilingual-v3.0'], defaultCoding: 'command-r-plus', defaultChat: 'command-r', defaultResearch: 'command-r-plus' },
        { id: 'prov_deepseek', name: 'DeepSeek', type: 'deepseek', endpoint: 'https://api.deepseek.com/v1', priority: 7, models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'], defaultCoding: 'deepseek-coder', defaultChat: 'deepseek-chat', defaultResearch: 'deepseek-reasoner' },
        { id: 'prov_openrouter', name: 'OpenRouter', type: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', priority: 8, models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'deepseek/deepseek-r1'], defaultCoding: 'anthropic/claude-3.5-sonnet', defaultChat: 'openai/gpt-4o', defaultResearch: 'deepseek/deepseek-r1' },
        { id: 'prov_custom', name: 'Custom Compatible API', type: 'custom', endpoint: 'http://localhost:8000/v1', priority: 9, models: ['custom-local-model'], defaultCoding: 'custom-local-model', defaultChat: 'custom-local-model', defaultResearch: 'custom-local-model' }
      ];

      const stmt = handle.prepare(`
        INSERT OR IGNORE INTO ai_providers (
          id, name, provider_type, api_endpoint, key_prefix, status, priority,
          daily_budget_usd, monthly_budget_usd, supported_models_json,
          default_model_coding, default_model_chat, default_model_research,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, 50.0, 1000.0, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      for (const p of seedProviders) {
        stmt.run(
          p.id,
          p.name,
          p.type,
          p.endpoint,
          'sk-seed-...mock',
          p.priority,
          JSON.stringify(p.models),
          p.defaultCoding,
          p.defaultChat,
          p.defaultResearch
        );
      }
    },
  },
];

function openDb() {
  if (db) return db;
  ({ DatabaseSync } = require('node:sqlite'));
  const dbPath = config.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 10000');
  runMigrations(db);
  return db;
}

function runMigrations(handle) {
  handle.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
  );
  const applied = new Set(handle.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    handle.exec('BEGIN');
    try {
      if (typeof m.up === 'function') {
        m.up(handle);
      } else {
        handle.exec(m.sql);
      }
      handle
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(m.id, m.name, new Date().toISOString());
      handle.exec('COMMIT');
    } catch (err) {
      handle.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} (${m.name}) failed: ${err.message}`);
    }
  }
}

function getDb() {
  return db || openDb();
}

function closeDb() {
  if (db) {
    try {
      db.close();
    } catch (_) {
      /* ignore */
    }
    db = null;
  }
}

let inTx = false;

/** Runs fn inside an IMMEDIATE transaction. Safe against nesting and lock contention. */
function tx(fn) {
  const handle = getDb();
  if (inTx) {
    return fn(handle);
  }
  handle.exec('BEGIN IMMEDIATE');
  inTx = true;
  try {
    const result = fn(handle);
    handle.exec('COMMIT');
    inTx = false;
    return result;
  } catch (err) {
    inTx = false;
    try {
      handle.exec('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw err;
  }
}

function get(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}

function all(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}

function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}

module.exports = { getDb, closeDb, tx, get, all, run, MIGRATIONS, runMigrations };
