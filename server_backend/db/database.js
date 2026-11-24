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
  {
    id: 25,
    name: 'phase16_18_feature_autonomous_engineering_core',
    up: (handle) => {
      handle.exec(`
CREATE TABLE IF NOT EXISTS engineering_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'paused')),
  progress INTEGER NOT NULL DEFAULT 0,
  current_step TEXT,
  checkpoint_data TEXT DEFAULT '{}',
  logs_snippet TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineering_jobs_project ON engineering_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_engineering_jobs_user ON engineering_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_engineering_jobs_status ON engineering_jobs(status);

CREATE TABLE IF NOT EXISTS workspace_branches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL CHECK (status IN ('active', 'merged', 'abandoned', 'conflict')),
  head_commit_hash TEXT,
  worktree_path TEXT,
  diff_summary TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_branches_project ON workspace_branches(project_id);
CREATE INDEX IF NOT EXISTS idx_workspace_branches_name ON workspace_branches(branch_name);

CREATE TABLE IF NOT EXISTS project_code_graphs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  graph_json TEXT NOT NULL DEFAULT '{}',
  symbols_count INTEGER NOT NULL DEFAULT 0,
  dependencies_count INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_graphs_project ON project_code_graphs(project_id);
CREATE INDEX IF NOT EXISTS idx_code_graphs_version ON project_code_graphs(version_hash);

CREATE TABLE IF NOT EXISTS project_build_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  snapshot_label TEXT NOT NULL,
  snapshot_files_json TEXT NOT NULL DEFAULT '{}',
  is_healthy INTEGER NOT NULL DEFAULT 1,
  rollback_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_build_versions_project ON project_build_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_build_versions_num ON project_build_versions(version_number);

CREATE TABLE IF NOT EXISTS engineering_evaluations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  build_version_id TEXT,
  build_time_ms INTEGER NOT NULL DEFAULT 0,
  test_pass_rate REAL NOT NULL DEFAULT 100.0,
  bundle_size_bytes INTEGER NOT NULL DEFAULT 0,
  response_latency_ms INTEGER NOT NULL DEFAULT 0,
  token_cost_usd REAL NOT NULL DEFAULT 0.0,
  pre_metrics_json TEXT DEFAULT '{}',
  post_metrics_json TEXT DEFAULT '{}',
  improvement_ratio REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evaluations_project ON engineering_evaluations(project_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_created ON engineering_evaluations(created_at);
      `);
    },
  },
  {
    id: 26,
    name: 'phase17_dynamic_ui_agent_engine',
    up: (handle) => {
      handle.exec(`
CREATE TABLE IF NOT EXISTS custom_screens (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  view_type TEXT NOT NULL DEFAULT 'FORM',
  ui_schema_json TEXT NOT NULL DEFAULT '{}',
  mock_records_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_screens_project ON custom_screens(project_id);
CREATE INDEX IF NOT EXISTS idx_custom_screens_user ON custom_screens(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_screens_view ON custom_screens(view_type);

CREATE TABLE IF NOT EXISTS dynamic_records (
  id TEXT PRIMARY KEY,
  screen_id TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dynamic_records_screen ON dynamic_records(screen_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_records_created ON dynamic_records(created_at);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_role TEXT NOT NULL DEFAULT 'business_owner',
  prompt TEXT NOT NULL,
  response_json TEXT NOT NULL,
  rating INTEGER NOT NULL,
  notes TEXT,
  is_few_shot_candidate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_rating ON ai_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_role ON ai_feedback(user_role);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_few_shot ON ai_feedback(is_few_shot_candidate);
      `);
    },
  },
  {
    id: 27,
    name: '027_media_studio',
    up: (handle) => {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS media_jobs (
          id              TEXT PRIMARY KEY,
          owner_id        TEXT NOT NULL,
          project_id      TEXT,
          type            TEXT NOT NULL CHECK (type IN ('image','diagram','tts','animation','video','flashcards')),
          state           TEXT NOT NULL DEFAULT 'QUEUED'
                          CHECK (state IN ('DRAFT','QUEUED','RUNNING','READY','FAILED','CANCELLED','EXPIRED')),
          prompt          TEXT NOT NULL DEFAULT '',
          params_json     TEXT NOT NULL DEFAULT '{}',
          provider        TEXT,
          idempotency_key TEXT UNIQUE,
          cost_units      INTEGER NOT NULL DEFAULT 0,
          artifact_path   TEXT,
          artifact_mime   TEXT,
          artifact_bytes  INTEGER,
          error_code      TEXT,
          error_summary   TEXT,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          started_at      TEXT,
          finished_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_media_jobs_owner ON media_jobs(owner_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS media_usage (
          owner_id TEXT NOT NULL,
          day      TEXT NOT NULL,
          type     TEXT NOT NULL,
          units    INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (owner_id, day, type)
        );

        CREATE TABLE IF NOT EXISTS media_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id     TEXT NOT NULL,
          owner_id   TEXT NOT NULL,
          event      TEXT NOT NULL,
          meta_json  TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_media_events_job ON media_events(job_id);
      `);
    },
  },
  {
    id: 28,
    name: '028_flashcards',
    up: (handle) => {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS card_decks (
          id         TEXT PRIMARY KEY,
          owner_id   TEXT NOT NULL,
          title      TEXT NOT NULL,
          source_ref TEXT,
          generated  INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_card_decks_owner ON card_decks(owner_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS cards (
          id           TEXT PRIMARY KEY,
          deck_id      TEXT NOT NULL REFERENCES card_decks(id) ON DELETE CASCADE,
          owner_id     TEXT NOT NULL,
          front        TEXT NOT NULL,
          back         TEXT NOT NULL,
          source_ref   TEXT,
          media_job_id TEXT,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
        CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id);

        CREATE TABLE IF NOT EXISTS card_reviews (
          card_id          TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          owner_id         TEXT NOT NULL,
          easiness         REAL    NOT NULL DEFAULT 2.5,
          interval_days    INTEGER NOT NULL DEFAULT 0,
          repetitions      INTEGER NOT NULL DEFAULT 0,
          due_at           TEXT,
          last_reviewed_at TEXT,
          PRIMARY KEY (card_id, owner_id)
        );
        CREATE INDEX IF NOT EXISTS idx_card_reviews_due ON card_reviews(owner_id, due_at);

        CREATE TABLE IF NOT EXISTS card_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id   TEXT NOT NULL,
          deck_id    TEXT,
          card_id    TEXT,
          event      TEXT NOT NULL,
          meta_json  TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_card_events_deck ON card_events(deck_id);
      `);
    },
  },
  {
    id: 29,
    name: '029_project_semantic_index',
    up: (handle) => {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS project_index_meta (
          project_id   TEXT PRIMARY KEY,
          owner_id     TEXT NOT NULL,
          version      INTEGER NOT NULL DEFAULT 0,
          file_count   INTEGER NOT NULL DEFAULT 0,
          symbol_count INTEGER NOT NULL DEFAULT 0,
          edge_count   INTEGER NOT NULL DEFAULT 0,
          built_at     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_index_files (
          project_id   TEXT NOT NULL,
          file_path    TEXT NOT NULL,
          language     TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          byte_size    INTEGER NOT NULL DEFAULT 0,
          symbol_count INTEGER NOT NULL DEFAULT 0,
          indexed_at   TEXT NOT NULL,
          PRIMARY KEY (project_id, file_path)
        );
        CREATE INDEX IF NOT EXISTS idx_pindex_files_project ON project_index_files(project_id);

        CREATE TABLE IF NOT EXISTS project_index_symbols (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id  TEXT NOT NULL,
          file_path   TEXT NOT NULL,
          name        TEXT NOT NULL,
          kind        TEXT NOT NULL CHECK (kind IN ('function','component','class','method','variable','state','handler','element','selector','route')),
          signature   TEXT,
          parent_name TEXT,
          line_start  INTEGER NOT NULL,
          line_end    INTEGER NOT NULL,
          byte_start  INTEGER NOT NULL,
          byte_end    INTEGER NOT NULL,
          exported    INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_pindex_symbols_name ON project_index_symbols(project_id, name);
        CREATE INDEX IF NOT EXISTS idx_pindex_symbols_file ON project_index_symbols(project_id, file_path);

        CREATE TABLE IF NOT EXISTS project_index_edges (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          from_file  TEXT NOT NULL,
          to_file    TEXT,
          specifier  TEXT,
          edge_type  TEXT NOT NULL CHECK (edge_type IN ('import','includes','dom-handler','calls')),
          symbol     TEXT,
          line       INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_pindex_edges_from ON project_index_edges(project_id, from_file);
        CREATE INDEX IF NOT EXISTS idx_pindex_edges_to ON project_index_edges(project_id, to_file);
      `);
    },
  },
  {
    id: 30,
    name: '030_ai_feature_pack',
    up: (handle) => {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS user_expertise (
          user_id      TEXT PRIMARY KEY,
          level        TEXT NOT NULL DEFAULT 'intermediate'
                       CHECK (level IN ('beginner','intermediate','expert')),
          source       TEXT NOT NULL DEFAULT 'inferred'
                       CHECK (source IN ('explicit','inferred')),
          signals_json TEXT NOT NULL DEFAULT '{}',
          updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS build_plans (
          id         TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          owner_id   TEXT NOT NULL,
          prompt     TEXT NOT NULL DEFAULT '',
          plan_json  TEXT NOT NULL,
          status     TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','superseded','completed')),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_build_plans_project ON build_plans(project_id, created_at DESC);
      `);
    },
  },
  {
    id: 31,
    name: '031_continuous_improvement_engine',
    up: (handle) => {
      // Latent-defect repair: agentMemory.recordLesson writes tech_stack,
      // verification_status, usage_count and updated_at, but no migration ever
      // created them — on a migrated DB the INSERT path would throw. The
      // improvement engine also needs usage_count as directive evidence.
      const cols = handle.prepare("PRAGMA table_info('agent_memory_lessons')").all().map((c) => c.name);
      const ensureLessonCol = (name, def) => {
        if (!cols.includes(name)) handle.exec(`ALTER TABLE agent_memory_lessons ADD COLUMN ${name} ${def}`);
      };
      ensureLessonCol('tech_stack', "TEXT NOT NULL DEFAULT 'universal'");
      ensureLessonCol('verification_status', "TEXT NOT NULL DEFAULT 'verified'");
      ensureLessonCol('usage_count', 'INTEGER NOT NULL DEFAULT 0');
      ensureLessonCol('updated_at', 'TEXT');

      // Same drift class on agent_deployments: deploymentService writes
      // target_platform / endpoint_url / logs_json / completed_at that no
      // migration ever created (legacy columns target_environment / url are
      // kept untouched for old readers).
      const depCols = handle.prepare("PRAGMA table_info('agent_deployments')").all().map((c) => c.name);
      const ensureDepCol = (name, def) => {
        if (!depCols.includes(name)) handle.exec(`ALTER TABLE agent_deployments ADD COLUMN ${name} ${def}`);
      };
      ensureDepCol('target_platform', "TEXT NOT NULL DEFAULT 'local_preview'");
      ensureDepCol('endpoint_url', 'TEXT');
      ensureDepCol('logs_json', "TEXT NOT NULL DEFAULT '[]'");
      ensureDepCol('completed_at', 'TEXT');

      handle.exec(`
        CREATE TABLE IF NOT EXISTS code_patterns (
          id                TEXT PRIMARY KEY,
          pattern_key       TEXT NOT NULL,
          category          TEXT NOT NULL,
          title             TEXT NOT NULL,
          description       TEXT NOT NULL DEFAULT '',
          keywords          TEXT NOT NULL DEFAULT '',
          snippet           TEXT NOT NULL DEFAULT '',
          framework         TEXT NOT NULL DEFAULT 'vanilla-web',
          success_count     INTEGER NOT NULL DEFAULT 1,
          use_count         INTEGER NOT NULL DEFAULT 0,
          last_used_at      TEXT,
          source_project_id TEXT,
          owner_id          TEXT NOT NULL,
          is_verified       INTEGER NOT NULL DEFAULT 1,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          UNIQUE(pattern_key, owner_id)
        );
        CREATE INDEX IF NOT EXISTS idx_code_patterns_owner ON code_patterns(owner_id, success_count DESC);

        CREATE TABLE IF NOT EXISTS improvement_directives (
          id             TEXT PRIMARY KEY,
          directive_key  TEXT NOT NULL,
          owner_id       TEXT NOT NULL,
          kind           TEXT NOT NULL
                         CHECK (kind IN ('recurring_error','preferred_pattern','stability_watch')),
          title          TEXT NOT NULL,
          body           TEXT NOT NULL DEFAULT '',
          boost_keys     TEXT NOT NULL DEFAULT '',
          evidence_json  TEXT NOT NULL DEFAULT '{}',
          confidence     REAL NOT NULL DEFAULT 0.5,
          active         INTEGER NOT NULL DEFAULT 1,
          created_at     TEXT NOT NULL,
          updated_at     TEXT NOT NULL,
          UNIQUE(directive_key, owner_id)
        );
        CREATE INDEX IF NOT EXISTS idx_directives_owner ON improvement_directives(owner_id, active, confidence DESC);

        CREATE TABLE IF NOT EXISTS improvement_dataset_entries (
          id            TEXT PRIMARY KEY,
          kind          TEXT NOT NULL
                        CHECK (kind IN ('successful_build','verified_fix')),
          project_id    TEXT,
          owner_id      TEXT NOT NULL,
          instruction   TEXT NOT NULL,
          input_context TEXT NOT NULL DEFAULT '',
          output        TEXT NOT NULL DEFAULT '',
          quality_score REAL NOT NULL DEFAULT 0,
          approved      INTEGER NOT NULL DEFAULT 0,
          approved_at   TEXT,
          created_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dataset_owner ON improvement_dataset_entries(owner_id, approved, created_at DESC);
      `);
    },
  },
  {
    id: 32,
    name: '032_autonomous_repair_loop',
    up: (handle) => {
      // The autonomous repair loop: every build through the execute pipeline
      // records its outcome (first attempt + final state after any self-repair),
      // and each repair round records exactly which checks failed and whether
      // the round fixed them. These rows are the evidence base for measuring
      // REAL improvement over time (first-pass rate, repair rescue rate, trend).
      handle.exec(`
        CREATE TABLE IF NOT EXISTS build_outcomes (
          id            TEXT PRIMARY KEY,
          request_id    TEXT NOT NULL,
          project_id    TEXT,
          owner_id      TEXT NOT NULL,
          intent        TEXT NOT NULL DEFAULT 'build',
          files_count   INTEGER NOT NULL DEFAULT 0,
          tests_total   INTEGER NOT NULL DEFAULT 0,
          tests_passed  INTEGER NOT NULL DEFAULT 0,
          first_passed  INTEGER NOT NULL DEFAULT 0,
          final_passed  INTEGER NOT NULL DEFAULT 0,
          repair_rounds INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL,
          UNIQUE(request_id, owner_id)
        );
        CREATE INDEX IF NOT EXISTS idx_build_outcomes_owner ON build_outcomes(owner_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS repair_rounds (
          id                TEXT PRIMARY KEY,
          outcome_id        TEXT NOT NULL,
          owner_id          TEXT NOT NULL,
          round_no          INTEGER NOT NULL,
          failed_tests_json TEXT NOT NULL DEFAULT '[]',
          success           INTEGER NOT NULL DEFAULT 0,
          tests_passed      INTEGER NOT NULL DEFAULT 0,
          tests_total       INTEGER NOT NULL DEFAULT 0,
          created_at        TEXT NOT NULL,
          UNIQUE(outcome_id, round_no)
        );
        CREATE INDEX IF NOT EXISTS idx_repair_rounds_owner ON repair_rounds(owner_id, created_at DESC);
      `);
    },
  },
  {
    id: 33,
    name: '033_smart_studio',
    up: (handle) => {
      // Smart Studio Phase 1: generated image assets with their full audit trail
      // (original Arabic message, enhanced English prompt, OCR typography verdict).
      // States: RUNNING -> READY | UNVERIFIED | QUALITY_GATE_FAILED | FAILED.
      // UNVERIFIED = image exists but OCR tooling was unavailable (honest, not faked).
      handle.exec(`
        CREATE TABLE IF NOT EXISTS studio_assets (
          id                 TEXT PRIMARY KEY,
          owner_id           TEXT NOT NULL,
          project_id         TEXT,
          kind               TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image')),
          state              TEXT NOT NULL DEFAULT 'RUNNING'
                             CHECK (state IN ('RUNNING','READY','UNVERIFIED','QUALITY_GATE_FAILED','FAILED')),
          user_message       TEXT NOT NULL DEFAULT '',
          prompt_en          TEXT NOT NULL DEFAULT '',
          negative           TEXT NOT NULL DEFAULT '',
          preset             TEXT,
          sector             TEXT,
          theme              TEXT,
          platform           TEXT,
          aspect             TEXT NOT NULL DEFAULT '1:1',
          overlay_texts_json TEXT NOT NULL DEFAULT '[]',
          ocr_coverage       REAL,
          attempts           INTEGER NOT NULL DEFAULT 0,
          provider           TEXT,
          model              TEXT,
          artifact_path      TEXT,
          artifact_mime      TEXT,
          artifact_bytes     INTEGER,
          error_code         TEXT,
          error_summary      TEXT,
          created_at         TEXT NOT NULL,
          updated_at         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studio_assets_owner ON studio_assets(owner_id, created_at DESC);
      `);
    },
  },
  {
    id: 34,
    name: '034_studio_presets',
    up: (handle) => {
      // Smart Presets subsystem: per-asset preset metadata, user-saved custom
      // presets, and per-project brand locks (visual identity pinned across
      // all future generations until explicitly unlocked).
      handle.exec(`
        ALTER TABLE studio_assets ADD COLUMN palette_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE studio_assets ADD COLUMN style_seed TEXT;
        ALTER TABLE studio_assets ADD COLUMN modifiers_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE studio_assets ADD COLUMN intensity TEXT NOT NULL DEFAULT 'balanced';
        ALTER TABLE studio_assets ADD COLUMN ocr_gate_mode TEXT NOT NULL DEFAULT 'on_text_detected';
        ALTER TABLE studio_assets ADD COLUMN auto_detected INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE IF NOT EXISTS studio_custom_presets (
          id              TEXT PRIMARY KEY,
          owner_id        TEXT NOT NULL,
          name            TEXT NOT NULL,
          base_preset_id  TEXT,
          source_asset_id TEXT,
          wrapper_en      TEXT NOT NULL DEFAULT '{}',
          negative_en     TEXT NOT NULL DEFAULT '',
          aspect          TEXT NOT NULL DEFAULT '1:1',
          ocr_gate        TEXT NOT NULL DEFAULT 'on_text_detected'
                          CHECK (ocr_gate IN ('off','always','on_text_detected')),
          palette_json    TEXT NOT NULL DEFAULT '[]',
          style_seed      TEXT,
          modifiers_json  TEXT NOT NULL DEFAULT '{}',
          intensity       TEXT NOT NULL DEFAULT 'balanced',
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studio_custom_presets_owner ON studio_custom_presets(owner_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS studio_project_brand_lock (
          project_id        TEXT PRIMARY KEY,
          owner_id          TEXT NOT NULL,
          preset_id         TEXT,
          custom_preset_id  TEXT,
          style_seed        TEXT,
          palette_json      TEXT NOT NULL DEFAULT '[]',
          locked_at         TEXT NOT NULL
        );
      `);
    },
  },
  {
    id: 35,
    name: '035_studio_routing',
    up: (handle) => {
      // Smart Intent Router (7 layers): routing telemetry for every decision
      // (intent, confidence, latency, provider, fallback, ambiguity, cost
      // block) plus the 1-Click Override improvement signal.
      handle.exec(`
        CREATE TABLE IF NOT EXISTS studio_routing_telemetry (
          id                TEXT PRIMARY KEY,
          owner_id          TEXT NOT NULL,
          session_id        TEXT,
          intent            TEXT NOT NULL,
          confidence        REAL NOT NULL,
          model_tier        TEXT,
          provider          TEXT NOT NULL,
          fallback_used     INTEGER NOT NULL DEFAULT 0,
          ambiguous         INTEGER NOT NULL DEFAULT 0,
          override_clicked  INTEGER NOT NULL DEFAULT 0,
          corrected_intent  TEXT,
          latency_ms        REAL NOT NULL DEFAULT 0,
          cost_blocked      INTEGER NOT NULL DEFAULT 0,
          created_at        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studio_routing_owner
          ON studio_routing_telemetry(owner_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_studio_routing_session
          ON studio_routing_telemetry(owner_id, session_id, created_at DESC);
      `);
    },
  },
  {
    id: 36,
    name: '036_studio_image_mode',
    up: (handle) => {
      // Image Mode (Phase 1): multi-candidate groups, reference images,
      // local WebP variants, and SHA-256 request-fingerprint caching.
      handle.exec(`
        ALTER TABLE studio_assets ADD COLUMN generation_group TEXT;
        ALTER TABLE studio_assets ADD COLUMN reference_id TEXT;
        ALTER TABLE studio_assets ADD COLUMN webp_path TEXT;
        CREATE INDEX IF NOT EXISTS idx_studio_assets_group
          ON studio_assets(owner_id, generation_group);

        CREATE TABLE IF NOT EXISTS studio_references (
          id          TEXT PRIMARY KEY,
          owner_id    TEXT NOT NULL,
          role        TEXT NOT NULL DEFAULT 'style'
                      CHECK (role IN ('style','product')),
          hash        TEXT NOT NULL,
          path        TEXT NOT NULL,
          mime        TEXT NOT NULL,
          bytes       INTEGER NOT NULL,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studio_references_owner
          ON studio_references(owner_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS studio_generation_cache (
          owner_id     TEXT NOT NULL,
          fingerprint  TEXT NOT NULL,
          asset_id     TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          PRIMARY KEY (owner_id, fingerprint)
        );
      `);
    },
  },
  {
    id: 37,
    name: '037_ui_builder',
    up: (handle) => {
      // UI Builder Mode (Phase 3): one row per generated interface build.
      // version/parent_id form the basic version chain (full tree: Phase 4);
      // audit_json stores static gates + headless audit + WCAG + asset stats.
      handle.exec(`
        CREATE TABLE IF NOT EXISTS studio_ui_builds (
          id            TEXT PRIMARY KEY,
          owner_id      TEXT NOT NULL,
          project_id    TEXT,
          session_id    TEXT,
          routing_id    TEXT,
          domain        TEXT NOT NULL,
          model_tier    TEXT NOT NULL,
          provider      TEXT NOT NULL,
          status        TEXT NOT NULL
                        CHECK (status IN ('READY','UNVERIFIED','FAILED','QUALITY_GATE_FAILED')),
          version       INTEGER NOT NULL DEFAULT 1,
          parent_id     TEXT,
          html_path     TEXT NOT NULL,
          tokens_json   TEXT NOT NULL DEFAULT '{}',
          manifest_json TEXT NOT NULL DEFAULT '[]',
          audit_json    TEXT NOT NULL DEFAULT '{}',
          heal_used     INTEGER NOT NULL DEFAULT 0,
          lang          TEXT NOT NULL DEFAULT 'ar',
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studio_ui_builds_owner
          ON studio_ui_builds(owner_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_studio_ui_builds_project
          ON studio_ui_builds(owner_id, project_id, created_at DESC);

        -- Full router contract replay: POST /ui/build {routing_id} needs the
        -- complete JSON contract, not just the telemetry scalars.
        ALTER TABLE studio_routing_telemetry ADD COLUMN contract_json TEXT;
      `);
    },
  },
  {
    id: 38,
    name: '038_prompt_enhancer',
    up: (handle) => {
      // Prompt Enhancer Engine (Phase 1, 6 layers). Two tables by design:
      //  - studio_prompt_enhancements: append-only TELEMETRY ledger — every
      //    run logged (raw vs enhanced, provider, latency, flags).
      //  - studio_prompt_cache: the SHA-256 zero-cost cache — one pointer row
      //    per UNIQUE(owner_id, fingerprint) -> the enhancement that produced it.
      handle.exec(`
        CREATE TABLE IF NOT EXISTS studio_prompt_enhancements (
          id                        TEXT PRIMARY KEY,
          owner_id                  TEXT NOT NULL,
          session_id                TEXT,
          fingerprint               TEXT NOT NULL,
          raw_message               TEXT NOT NULL,
          contract_json             TEXT NOT NULL,
          track                     TEXT NOT NULL DEFAULT 'image',
          provider_dialect          TEXT NOT NULL DEFAULT 'gemini',
          engine_provider           TEXT NOT NULL DEFAULT 'deterministic'
                                    CHECK (engine_provider IN ('deterministic','local_qwen','gemini_flash')),
          fallback_used             INTEGER NOT NULL DEFAULT 0,
          override_used             INTEGER NOT NULL DEFAULT 0,
          retry_refinement_applied  INTEGER NOT NULL DEFAULT 0,
          cache_hit                 INTEGER NOT NULL DEFAULT 0,
          latency_ms                INTEGER NOT NULL DEFAULT 0,
          created_at                TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_studio_enhance_owner
          ON studio_prompt_enhancements(owner_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_studio_enhance_session
          ON studio_prompt_enhancements(owner_id, session_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS studio_prompt_cache (
          owner_id     TEXT NOT NULL,
          fingerprint  TEXT NOT NULL,
          enhancement_id TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          PRIMARY KEY (owner_id, fingerprint)
        );
      `);
    },
  },
  {
    id: 39,
    name: '039_quick_clarifiers',
    up: (handle) => {
      // Quick Clarifiers Engine (Annex 7, Phase 1). Two tables by design:
      //  - studio_clarifier_sessions: one row per evaluated clarifier card —
      //    the full card payload, the resolution, and the bypass outcome.
      //  - studio_clarifier_cache: SHA-256 zero-cost cache for DYNAMIC
      //    (local-LLM) question sets — one row per unique input hash, so a
      //    repeated ambiguous request costs 0 LLM calls (cache_hit source).
      handle.exec(`
        CREATE TABLE IF NOT EXISTS studio_clarifier_sessions (
          id                    TEXT PRIMARY KEY,
          owner_id              TEXT NOT NULL,
          project_id            TEXT,
          routing_log_id        TEXT,
          stage                 TEXT NOT NULL CHECK (stage IN ('pre_gen','post_gen','micro_edit','hybrid_expand')),
          source                TEXT NOT NULL CHECK (source IN ('deterministic_bank','local_llm','cache_hit','circuit_breaker_skipped')),
          verbosity_mode        TEXT NOT NULL CHECK (verbosity_mode IN ('smart','guided','turbo')),
          questions_json        TEXT NOT NULL,
          suppressed_slots_json TEXT NOT NULL,
          selected_answers_json TEXT,
          custom_text_input     TEXT,
          status                TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','resolved','skipped','auto_proceeded','timeout_bypassed')),
          latency_ms            INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL,
          resolved_at           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_studio_clarifier_routing
          ON studio_clarifier_sessions(routing_log_id);
        CREATE INDEX IF NOT EXISTS idx_studio_clarifier_owner_status
          ON studio_clarifier_sessions(owner_id, status, created_at DESC);

        CREATE TABLE IF NOT EXISTS studio_clarifier_cache (
          input_hash         TEXT PRIMARY KEY,
          intent             TEXT NOT NULL,
          missing_slots_json TEXT NOT NULL,
          questions_json     TEXT NOT NULL,
          hit_count          INTEGER NOT NULL DEFAULT 0,
          latency_ms         INTEGER NOT NULL DEFAULT 0,
          created_at         TEXT NOT NULL,
          last_used_at       TEXT NOT NULL
        );
      `);
    },
  },
  {
    id: 40,
    name: '040_smart_presets_v2',
    up: (handle) => {
      // Smart Presets Engine v2 (updated official annex, Phase 1).
      // DB-backed preset registry replacing the abbreviated smart_presets
      // definition: immutable versioning, hierarchical parentage, pinning,
      // budget tiers, optical physics, OCR gate modes, conflict rules,
      // 4-level intensity weights, provider dialects, post-process hooks,
      // theme variants and share slugs — seeded idempotently with the 7
      // built-in system presets (INSERT OR IGNORE: safe to run twice).
      // Platform extension: owner_id column (tenant isolation rule — every
      // query is owner-scoped; system presets carry '').
      handle.exec(`
        CREATE TABLE IF NOT EXISTS smart_presets (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL DEFAULT 1,
          parent_preset_id TEXT REFERENCES smart_presets(id) ON DELETE SET NULL,
          project_id TEXT,
          owner_id TEXT NOT NULL DEFAULT '',
          is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
          category TEXT NOT NULL CHECK (category IN (
            'photo', 'commercial', 'product', 'ui_asset', 'fintech', 'marketing', 'heritage', 'edit_profile'
          )),
          budget_tier TEXT NOT NULL DEFAULT 'photo_paid' CHECK (budget_tier IN ('photo_paid', 'svg_free', 'css_free')),
          i18n_label_key TEXT NOT NULL,
          i18n_description_key TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          positive_prompt_wrapper TEXT NOT NULL,
          negative_prompt_rules TEXT NOT NULL,
          optical_physics_json TEXT NOT NULL DEFAULT '{}',
          default_aspect_ratio TEXT NOT NULL DEFAULT '16:9',
          ocr_gate_mode TEXT NOT NULL DEFAULT 'off' CHECK (ocr_gate_mode IN ('off', 'always', 'on_text_detected')),
          modifiers_schema_json TEXT NOT NULL DEFAULT '{}',
          conflict_rules_json TEXT NOT NULL DEFAULT '[]',
          intensity_weights_json TEXT NOT NULL DEFAULT '{"subtle":0.4,"balanced":0.7,"strong":0.9,"strict":1.0}',
          provider_dialects_json TEXT NOT NULL DEFAULT '{}',
          post_process_hooks_json TEXT NOT NULL DEFAULT '{"webp":true,"rembg":false,"upscale_4k":false,"svg":false}',
          palette_json TEXT NOT NULL DEFAULT '[]',
          theme_variants_json TEXT NOT NULL DEFAULT '{}',
          style_seed INTEGER,
          thumbnail_url TEXT,
          share_slug TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_presets_project_active ON smart_presets(project_id, is_active, is_pinned DESC);
        CREATE INDEX IF NOT EXISTS idx_presets_category ON smart_presets(category, is_active);
        CREATE INDEX IF NOT EXISTS idx_presets_parent ON smart_presets(parent_preset_id);
        CREATE INDEX IF NOT EXISTS idx_presets_owner ON smart_presets(owner_id, is_active);

        INSERT OR IGNORE INTO smart_presets (
          id, version, project_id, is_system, category, budget_tier,
          i18n_label_key, i18n_description_key, tags_json,
          positive_prompt_wrapper, negative_prompt_rules, optical_physics_json,
          default_aspect_ratio, ocr_gate_mode, modifiers_schema_json, conflict_rules_json, post_process_hooks_json,
          palette_json
        ) VALUES
        (
          'cinematic_photo', 1, NULL, 1, 'photo', 'photo_paid',
          'presets.cinematic_photo.label', 'presets.cinematic_photo.desc', '["nature","desert","city","realistic"]',
          'Photorealistic cinematic photography, natural lighting, ultra-detailed textures, balanced film color grading',
          'random text, watermark, cartoon, plastic skin, distorted anatomy, overexposed highlights, low resolution',
          '{"lens":"35mm","dof":"shallow","angle":"eye_level"}',
          '16:9', 'off',
          '{"lighting":["day","golden_hour","night"],"lens":["wide","portrait"]}',
          '[]',
          '{"webp":true,"rembg":false,"upscale_4k":false,"svg":false}',
          '["#1a2634","#c98a3d","#e8d9b8","#3d5a6c"]'
        ),
        (
          'commercial_storefront', 1, NULL, 1, 'commercial', 'photo_paid',
          'presets.commercial_storefront.label', 'presets.commercial_storefront.desc', '["shop","cafe","interior","signage"]',
          'High-end architectural commercial photography of a storefront facade, crisp legible illuminated signage, clean structural lines, inviting ambiance',
          'garbled letters, misspelled signage, distorted perspective, visual clutter, watermark, low resolution',
          '{"lens":"35mm","dof":"medium","angle":"eye_level"}',
          '16:9', 'always',
          '{"time":["day","illuminated_night"],"style":["modern","luxury","classic"]}',
          '[]',
          '{"webp":true,"rembg":false,"upscale_4k":false,"svg":false}',
          '["#2b2118","#d4a24e","#f5ead6","#7a5c3e"]'
        ),
        (
          'product_studio', 1, NULL, 1, 'product', 'photo_paid',
          'presets.product_studio.label', 'presets.product_studio.desc', '["ecommerce","perfume","food","packaging"]',
          'Commercial studio product photography, softbox lighting, realistic soft shadows, crisp surface reflections, centered hero composition',
          'floating artifacts, warped packaging, harsh glare, cluttered background, watermark, blurry edges',
          '{"lens":"85mm","dof":"shallow","angle":"three_quarter"}',
          '1:1', 'on_text_detected',
          '{"surface":["marble","wood","dark_luxury","pure_white"],"angle":["eye_level","top_down","three_quarter"],"lighting":["soft_studio","dramatic_neon"]}',
          '[{"if":{"surface":"pure_white"},"forbid":{"lighting":"dramatic_neon"}}]',
          '{"webp":true,"rembg":false,"upscale_4k":false,"svg":false}',
          '["#f5f2ee","#c9b48a","#3a3a3a","#8a6d4b"]'
        ),
        (
          'ui_assets', 1, NULL, 1, 'ui_asset', 'svg_free',
          'presets.ui_assets.label', 'presets.ui_assets.desc', '["icons","3d","glassmorphism","flat","hero"]',
          'Clean modern application UI visual asset, refined minimalist geometry, soft lighting, uncluttered composition suitable for digital interfaces',
          'random text, noisy grain, photographic clutter, watermark, jagged edges, low contrast',
          '{"lens":"50mm","dof":"deep","angle":"isometric"}',
          '1:1', 'off',
          '{"style":["3d","glassmorphism","flat"],"background":["transparent","dark","light"]}',
          '[{"if":{"style":"glassmorphism"},"forbid":{"background":"pure_white"}}]',
          '{"webp":true,"rembg":true,"upscale_4k":false,"svg":true}',
          '["#0f172a","#38bdf8","#e2e8f0","#818cf8"]'
        ),
        (
          'fintech_tech', 1, NULL, 1, 'fintech', 'photo_paid',
          'presets.fintech_tech.label', 'presets.fintech_tech.desc', '["trading","dashboard","dark","crypto"]',
          'Sleek futuristic fintech and enterprise tech visual, deep dark ambient backdrop, subtle glassmorphic depth, crisp geometric highlights',
          'cartoonish graphics, cluttered text, bright neon mess, watermark, blurry elements',
          '{"lens":"35mm","dof":"medium","angle":"eye_level"}',
          '16:9', 'on_text_detected',
          '{"theme":["dark_neon","corporate_blue","glassmorphic"]}',
          '[]',
          '{"webp":true,"rembg":false,"upscale_4k":false,"svg":false}',
          '["#090d18","#22d3ee","#10b981","#f8fafc"]'
        ),
        (
          'marketing_banner', 1, NULL, 1, 'marketing', 'photo_paid',
          'presets.marketing_banner.label', 'presets.marketing_banner.desc', '["ads","social","banner","cta"]',
          'High-converting commercial hero banner composition, strong visual hierarchy, clean low-contrast negative space reserved for headline and CTA overlay',
          'cluttered text zone, unreadable typography, watermark, stretched proportions, low resolution',
          '{"lens":"35mm","dof":"shallow","angle":"wide"}',
          '16:9', 'always',
          '{"negative_space_side":["right","left","center"]}',
          '[]',
          '{"webp":true,"rembg":false,"upscale_4k":false,"svg":false}',
          '["#1e293b","#f59e0b","#f8fafc","#ef4444"]'
        ),
        (
          'regional_heritage', 1, NULL, 1, 'heritage', 'photo_paid',
          'presets.regional_heritage.label', 'presets.regional_heritage.desc', '["arabian","gulf","architecture","culture"]',
          'Authentic Arabian and Gulf architectural heritage photography, warm golden desert sunlight, refined sandstone textures, timeless cultural elegance',
          'anachronistic neon clutter, distorted geometric patterns, random text, watermark, artificial HDR look',
          '{"lens":"35mm","dof":"medium","angle":"eye_level"}',
          '16:9', 'on_text_detected',
          '{"lighting":["day","golden_hour","warm_lantern_night"],"style":["authentic_traditional","modern_heritage","royal_luxury"]}',
          '[]',
          '{"webp":true,"rembg":false,"upscale_4k":false,"svg":false}',
          '["#7c5a3a","#d4a24e","#f5ead6","#4a3728"]'
        );
      `);
    },
  },
  {
    id: 41,
    name: '041_bilingual_typography',
    up: (handle) => {
      // Bilingual In-Image Typography Engine (8th annex, Phase 1). Two tables:
      //  - typography_fonts: curated AR/EN/bilingual commercial font vault with
      //    automatic AR-EN pairing, plus custom Brand Kit uploads (Phase 4).
      //  - image_text_layers: non-destructive text layers + OCR verification
      //    records (strategy, material, layout, scores, retry budget).
      // Adaptation (documented): the annex references image_assets(id); this
      // codebase's asset table is studio_assets(id) — the FK points there.
      handle.exec(`
        CREATE TABLE IF NOT EXISTS typography_fonts (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          is_system INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0, 1)),
          family_name TEXT NOT NULL,
          script_support TEXT NOT NULL CHECK (script_support IN ('ar', 'en', 'bilingual')),
          style_category TEXT NOT NULL CHECK (style_category IN (
            'modern_sans', 'classic_serif', 'calligraphy_heritage', 'display_bold', 'fintech_mono'
          )),
          paired_font_id TEXT REFERENCES typography_fonts(id) ON DELETE SET NULL,
          font_file_path TEXT NOT NULL,
          weights_json TEXT NOT NULL DEFAULT '[400,600,700]',
          license_type TEXT NOT NULL DEFAULT 'SIL_OFL',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS image_text_layers (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES studio_assets(id) ON DELETE CASCADE,
          owner_id TEXT NOT NULL DEFAULT '',
          clean_plate_url TEXT,
          layer_role TEXT NOT NULL DEFAULT 'headline' CHECK (layer_role IN ('headline', 'subheadline', 'tagline', 'badge', 'signage')),
          script_mode TEXT NOT NULL CHECK (script_mode IN ('ar', 'en', 'mixed')),
          direction TEXT NOT NULL DEFAULT 'rtl' CHECK (direction IN ('rtl', 'ltr', 'auto')),
          literal_text TEXT NOT NULL,
          render_strategy TEXT NOT NULL CHECK (render_strategy IN (
            'native_generative', 'deterministic_compositor', 'two_pass_hybrid', 'fallback_compositor'
          )),
          primary_font_id TEXT REFERENCES typography_fonts(id) ON DELETE SET NULL,
          paired_font_id TEXT REFERENCES typography_fonts(id) ON DELETE SET NULL,
          material_style TEXT NOT NULL DEFAULT 'flat_clean' CHECK (material_style IN (
            'flat_clean', 'gold_embossed', 'neon_glow', 'acrylic_3d', 'wood_engraved', 'marble_carved', 'ink_print'
          )),
          layout_box_json TEXT NOT NULL DEFAULT '{}',
          homography_matrix_json TEXT DEFAULT '[]',
          lighting_params_json TEXT DEFAULT '{}',
          ocr_engine_used TEXT DEFAULT 'none',
          ocr_detected_text TEXT,
          ocr_similarity_score REAL,
          wcag_contrast_ratio REAL,
          hallucinated_text_found INTEGER NOT NULL DEFAULT 0 CHECK (hallucinated_text_found IN (0, 1)),
          retry_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
            'planned', 'passed', 'retry_scheduled', 'fallback_recovered', 'failed_unverified', 'skipped'
          )),
          diagnosis_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_fonts_script_cat ON typography_fonts(script_support, style_category);
        CREATE INDEX IF NOT EXISTS idx_text_layers_asset ON image_text_layers(asset_id, layer_role);
        CREATE INDEX IF NOT EXISTS idx_text_layers_script_ocr ON image_text_layers(script_mode, ocr_similarity_score);
        CREATE INDEX IF NOT EXISTS idx_text_layers_owner ON image_text_layers(owner_id, created_at DESC);

        INSERT OR IGNORE INTO typography_fonts (
          id, project_id, is_system, family_name, script_support, style_category, paired_font_id, font_file_path, weights_json
        ) VALUES
        ('inter_sans', NULL, 1, 'Inter', 'en', 'modern_sans', NULL, '/assets/fonts/Inter-Variable.ttf', '[400,600,700,800]'),
        ('playfair_serif', NULL, 1, 'Playfair Display', 'en', 'classic_serif', NULL, '/assets/fonts/PlayfairDisplay-Variable.ttf', '[500,700]'),
        ('montserrat_bold', NULL, 1, 'Montserrat', 'en', 'display_bold', NULL, '/assets/fonts/Montserrat-Variable.ttf', '[600,700,800]'),
        ('jetbrains_mono', NULL, 1, 'JetBrains Mono', 'en', 'fintech_mono', NULL, '/assets/fonts/JetBrainsMono-Variable.ttf', '[400,600,700]'),
        ('ibm_plex_sans_ar', NULL, 1, 'IBM Plex Sans Arabic', 'bilingual', 'modern_sans', 'inter_sans', '/assets/fonts/IBMPlexSansArabic-Bold.ttf', '[400,600,700]'),
        ('cairo_display', NULL, 1, 'Cairo', 'bilingual', 'display_bold', 'montserrat_bold', '/assets/fonts/Cairo-Variable.ttf', '[600,700,800]'),
        ('amiri_heritage', NULL, 1, 'Amiri', 'ar', 'calligraphy_heritage', 'playfair_serif', '/assets/fonts/Amiri-Bold.ttf', '[400,700]');
      `);
    },
  },
  {
    id: 42,
    name: '042_phase1_cost_ledger',
    up: (handle) => {
      // Phase-1 Feature Freeze (execution order): provider_cost_ledger — the
      // single honest cost book for the frozen E2E slice. One row per paid
      // provider call (cost_usd > 0) AND one row per cache-hit saving
      // (saved_usd > 0), so "Zero Duplicate Spend" is provable from data.
      // Prices are estimates from a deterministic local table — flagged as
      // such, never presented as billed invoices.
      handle.exec(`
        CREATE TABLE IF NOT EXISTS provider_cost_ledger (
          id            TEXT PRIMARY KEY,
          owner_id      TEXT NOT NULL,
          provider      TEXT NOT NULL,
          operation     TEXT NOT NULL CHECK (operation IN (
            'image_generate', 'prompt_enhance', 'clarify_dynamic', 'ocr_verify'
          )),
          pricing_model TEXT NOT NULL DEFAULT 'estimated'
                        CHECK (pricing_model IN ('estimated')),
          unit_cost_usd REAL NOT NULL DEFAULT 0,
          units         INTEGER NOT NULL DEFAULT 1,
          cost_usd      REAL NOT NULL DEFAULT 0,
          saved_usd     REAL NOT NULL DEFAULT 0,
          cache_source  TEXT CHECK (cache_source IN (
            'prompt_cache_hit', 'generation_cache_hit'
          ) OR cache_source IS NULL),
          ref_id        TEXT,
          created_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cost_ledger_owner
          ON provider_cost_ledger(owner_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cost_ledger_operation
          ON provider_cost_ledger(operation, created_at DESC);
      `);
    },
  },
];

function attachTransactionHelper(handle) {
  if (handle && typeof handle.transaction !== 'function') {
    handle.transaction = function (fn) {
      return function (...args) {
        handle.exec('BEGIN IMMEDIATE');
        try {
          const res = fn(...args);
          handle.exec('COMMIT');
          return res;
        } catch (err) {
          try { handle.exec('ROLLBACK'); } catch (_) {}
          throw err;
        }
      };
    };
  }
}

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
  attachTransactionHelper(db);
  runMigrations(db);
  return db;
}

function runMigrations(handle) {
  attachTransactionHelper(handle);
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

module.exports = { getDb, openDb: getDb, closeDb, tx, get, all, run, MIGRATIONS, runMigrations };
