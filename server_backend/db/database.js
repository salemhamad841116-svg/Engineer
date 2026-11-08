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
