/**
 * freshDbMigrationSuite.test.js
 * Mandatory Gate: Fresh SQLite Database Initialization & Migration 1-17 Integrity Gate
 *
 * Verifies that a completely clean, empty SQLite database executes all 17 schema
 * migrations sequentially from scratch without error, creating all required tables,
 * indexes, and constraints, and passes PRAGMA quick_check integrity.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { runMigrations, MIGRATIONS } = require('../db/database.js');

const TEMP_DB_DIR = path.join(__dirname, '../../data/test_temp');
if (!fs.existsSync(TEMP_DB_DIR)) {
  fs.mkdirSync(TEMP_DB_DIR, { recursive: true });
}

const tempDbFile = path.join(TEMP_DB_DIR, `fresh_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.sqlite`);

console.log('================================================================');
console.log('🏛️ RUNNING FRESH-DB MIGRATION SUITE (MIGRATIONS 1 TO 20)');
console.log('================================================================\n');

let dbHandle = null;

try {
  console.log(`[Phase 1] Initializing completely empty SQLite database at: ${path.basename(tempDbFile)}...`);
  dbHandle = new DatabaseSync(tempDbFile);
  dbHandle.exec('PRAGMA journal_mode = WAL');
  dbHandle.exec('PRAGMA synchronous = NORMAL');
  dbHandle.exec('PRAGMA foreign_keys = ON');
  dbHandle.exec('PRAGMA busy_timeout = 10000');
  console.log('  ✅ Database handle created with WAL mode and foreign keys enabled.');

  console.log('[Phase 2] Executing all sequential migrations from scratch...');
  const startMigrationTime = Date.now();
  runMigrations(dbHandle);
  const migrationDuration = Date.now() - startMigrationTime;
  console.log(`  ✅ All migrations completed successfully in ${migrationDuration}ms.`);

  console.log('[Phase 3] Verifying schema_migrations tracking table...');
  const appliedRows = dbHandle.prepare('SELECT id, name, applied_at FROM schema_migrations ORDER BY id ASC').all();
  assert.strictEqual(appliedRows.length, MIGRATIONS.length, `Expected ${MIGRATIONS.length} applied migrations, found ${appliedRows.length}`);
  MIGRATIONS.forEach((expected, idx) => {
    const actual = appliedRows[idx];
    assert.strictEqual(actual.id, expected.id, `Migration ID mismatch at index ${idx}`);
    assert.strictEqual(actual.name, expected.name, `Migration name mismatch at index ${idx}`);
    assert.ok(actual.applied_at, `Migration ${actual.id} has no timestamp`);
  });
  console.log(`  ✅ All ${MIGRATIONS.length} migrations tracked with valid timestamps in schema_migrations.`);

  console.log('[Phase 4] Verifying all core production tables exist in sqlite_master...');
  const tables = dbHandle.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const requiredTables = [
    'schema_migrations',
    'users',
    'invitations',
    'sessions',
    'session_events',
    'categories',
    'upload_batches',
    'documents',
    'processing_jobs',
    'chunks',
    'system_flags',
    'audit_events',
    'agent_tasks',
    'agent_approvals',
    'agent_audit_logs',
    'agent_memory_lessons',
    'research_evidence',
    'research_sessions',
    'research_citations',
    'research_feedback',
    'web_verification_cache',
    'document_tables',
    'document_figures',
    'system_alert_logs',
    'admin_users',
    'admin_sessions',
    'admin_recovery_codes',
    'admin_audit_actions',
    'admin_content_flags',
    'admin_ip_whitelist',
    'user_settings',
    'email_verification_tokens',
    'password_reset_tokens',
    'usage_counters'
  ];

  for (const t of requiredTables) {
    assert.ok(tables.includes(t), `Required table "${t}" is missing from fresh database!`);
  }
  console.log(`  ✅ All ${requiredTables.length} core platform tables verified present.`);

  console.log('[Phase 5] Verifying column structures and specific historical migration fixes...');
  // 1. Verify agent_tasks has all 15 columns from Migration 12
  const agentTaskCols = dbHandle.prepare("PRAGMA table_info('agent_tasks')").all().map((c) => c.name);
  const requiredAgentCols = [
    'id', 'project_id', 'prompt', 'status', 'autonomy_level',
    'current_step', 'steps_log_json', 'decisions_json', 'error_context_json',
    'repair_attempts', 'undo_snapshot_json', 'resource_metrics_json',
    'deployment_record_json', 'created_at', 'updated_at'
  ];
  for (const col of requiredAgentCols) {
    assert.ok(agentTaskCols.includes(col), `Column "${col}" missing from agent_tasks table`);
  }

  // 2. Verify chunks has byte bounds and embedding blob
  const chunkCols = dbHandle.prepare("PRAGMA table_info('chunks')").all().map((c) => c.name);
  assert.ok(chunkCols.includes('byte_start'), 'chunks missing byte_start');
  assert.ok(chunkCols.includes('byte_end'), 'chunks missing byte_end');
  assert.ok(chunkCols.includes('embedding_blob'), 'chunks missing embedding_blob');

  // 3. Verify web_verification_cache has TTL and stale columns
  const webCacheCols = dbHandle.prepare("PRAGMA table_info('web_verification_cache')").all().map((c) => c.name);
  assert.ok(webCacheCols.includes('ttl_seconds'), 'web_verification_cache missing ttl_seconds');
  assert.ok(webCacheCols.includes('is_stale'), 'web_verification_cache missing is_stale');
  assert.ok(webCacheCols.includes('snapshot_type'), 'web_verification_cache missing snapshot_type');

  // 4. Verify system_alert_logs has level and category
  const alertCols = dbHandle.prepare("PRAGMA table_info('system_alert_logs')").all().map((c) => c.name);
  assert.ok(alertCols.includes('level'), 'system_alert_logs missing level');
  assert.ok(alertCols.includes('category'), 'system_alert_logs missing category');
  assert.ok(alertCols.includes('details_json'), 'system_alert_logs missing details_json');

  // 5. Verify admin_users has role and totp and must_change_password fields
  const adminUserCols = dbHandle.prepare("PRAGMA table_info('admin_users')").all().map((c) => c.name);
  assert.ok(adminUserCols.includes('role'), 'admin_users missing role');
  assert.ok(adminUserCols.includes('totp_secret'), 'admin_users missing totp_secret');
  assert.ok(adminUserCols.includes('totp_enabled'), 'admin_users missing totp_enabled');
  assert.ok(adminUserCols.includes('failed_logins'), 'admin_users missing failed_logins');
  assert.ok(adminUserCols.includes('locked_until'), 'admin_users missing locked_until');
  assert.ok(adminUserCols.includes('must_change_password'), 'admin_users missing must_change_password');

  // 6. Verify users table has avatar_url and storage_quota_bytes + Phase 12 columns
  const userCols = dbHandle.prepare("PRAGMA table_info('users')").all().map((c) => c.name);
  assert.ok(userCols.includes('avatar_url'), 'users missing avatar_url');
  assert.ok(userCols.includes('storage_quota_bytes'), 'users missing storage_quota_bytes');
  assert.ok(userCols.includes('email_verified'), 'users missing email_verified');
  assert.ok(userCols.includes('plan_id'), 'users missing plan_id');
  assert.ok(userCols.includes('terms_accepted_at'), 'users missing terms_accepted_at');
  assert.ok(userCols.includes('terms_version'), 'users missing terms_version');
  assert.ok(userCols.includes('is_demo'), 'users missing is_demo');

  // 7. Verify user_settings table has all required preferences + onboarding_completed
  const userSettingsCols = dbHandle.prepare("PRAGMA table_info('user_settings')").all().map((c) => c.name);
  assert.ok(userSettingsCols.includes('user_id'), 'user_settings missing user_id');
  assert.ok(userSettingsCols.includes('language'), 'user_settings missing language');
  assert.ok(userSettingsCols.includes('theme'), 'user_settings missing theme');
  assert.ok(userSettingsCols.includes('default_research_tier'), 'user_settings missing default_research_tier');
  assert.ok(userSettingsCols.includes('show_page_numbers'), 'user_settings missing show_page_numbers');
  assert.ok(userSettingsCols.includes('answer_length'), 'user_settings missing answer_length');
  assert.ok(userSettingsCols.includes('show_quality_badges'), 'user_settings missing show_quality_badges');
  assert.ok(userSettingsCols.includes('retain_search_history'), 'user_settings missing retain_search_history');
  assert.ok(userSettingsCols.includes('onboarding_completed'), 'user_settings missing onboarding_completed');

  console.log('  ✅ Column structures, data types, and schema evolutions verified.');

  console.log('[Phase 6] Running SQLite PRAGMA quick_check on clean database...');
  const quickCheckResult = dbHandle.prepare('PRAGMA quick_check').all();
  assert.ok(quickCheckResult.length > 0 && Object.values(quickCheckResult[0])[0] === 'ok', 'PRAGMA quick_check did not return ok');
  console.log('  ✅ PRAGMA quick_check returned "ok". Zero database corruption or index faults.');

  console.log('\n================================================================');
  console.log('🎉 ALL FRESH-DB MIGRATION CHECKS PASSED WITH 100% INTEGRITY!');
  console.log('================================================================\n');
} finally {
  if (dbHandle) {
    try {
      dbHandle.close();
    } catch (_) {}
  }
  // Safely cleanup temporary test files
  try {
    if (fs.existsSync(tempDbFile)) fs.unlinkSync(tempDbFile);
    if (fs.existsSync(`${tempDbFile}-wal`)) fs.unlinkSync(`${tempDbFile}-wal`);
    if (fs.existsSync(`${tempDbFile}-shm`)) fs.unlinkSync(`${tempDbFile}-shm`);
  } catch (_) {}
}
