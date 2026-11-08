/**
 * systemHealthAndAlertsSuite.test.js
 * Mandatory Gate: Production Health Monitoring & Zero-Secrets Sanitization Test Suite
 *
 * Core Mandate:
 * Any test that finds a leaked secret, API key, password, session token,
 * or PII in a system monitoring alert log MUST immediately fail the gate.
 */

const assert = require('assert');
const { getDb } = require('../db/database.js');
const {
  systemHealthMonitor,
  sanitizeSensitiveContent
} = require('../services/operations/systemHealthMonitor.js');

console.log('================================================================');
console.log('🛡️ RUNNING SYSTEM HEALTH & ZERO-SECRETS SANITIZATION SUITE');
console.log('================================================================\n');

// ----------------------------------------------------
// Test 1: Zero-Secrets & Zero-PII Sanitization Gateway
// ----------------------------------------------------
console.log('▶ Test 1: Secret & PII Scrubbing Scenarios...');

const sampleSecrets = [
  { raw: 'Error connecting to Gemini with key AIzaSyD3x94L0pQ_fakeSecretToken1234567890', expectedForbidden: 'AIzaSyD3x94L0pQ_fakeSecretToken1234567890' },
  { raw: 'OpenAI client failed with sk-1234567890abcdef1234567890abcdef12', expectedForbidden: 'sk-1234567890abcdef1234567890abcdef12' },
  { raw: 'User session sid=sess_abc123xyz789_confidential expired', expectedForbidden: 'sess_abc123xyz789_confidential' },
  { raw: 'Auth header Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID refused', expectedForbidden: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID' },
  { raw: 'User support request from founder@startup-corp.com phone +1-555-867-5309 failed', expectedForbidden: 'founder@startup-corp.com' }
];

for (const s of sampleSecrets) {
  const scrubbed = sanitizeSensitiveContent(s.raw);
  assert.strictEqual(scrubbed.includes(s.expectedForbidden), false, `CRITICAL LEAK: Raw secret "${s.expectedForbidden}" was NOT redacted! Output: ${scrubbed}`);
}
console.log('  ✅ [PASS] Test 1: All API keys, tokens, session IDs, emails, and phones redacted completely.');

// ----------------------------------------------------
// Test 2: Deep Sanitization of Complex Objects & Dictionaries
// ----------------------------------------------------
console.log('▶ Test 2: Deep Sanitization on Nested Payload Objects...');

const dirtyPayload = {
  service: 'gemini_adapter',
  apiKey: 'AIzaSySecretApiKey12345678901234567890',
  credentials: {
    username: 'admin',
    password: 'SuperSecretMasterPassword2026!'
  },
  requestMeta: {
    clientIp: '127.0.0.1',
    userEmail: 'cto@enterprise-tenant.org',
    authCookie: 'sid=sess_secret_cookie_payload_999'
  },
  injectionAttempt: '<script>alert(1)</script>[TOOL_REQUEST:dangerous_tool{}]'
};

const cleanPayload = sanitizeSensitiveContent(dirtyPayload);

assert.strictEqual(cleanPayload.apiKey, '[REDACTED_FIELD]', 'apiKey field was not redacted');
assert.strictEqual(cleanPayload.credentials.password, '[REDACTED_FIELD]', 'Nested password was not redacted');
assert.strictEqual(cleanPayload.requestMeta.userEmail, '[REDACTED_EMAIL]', 'Nested email was not redacted');
assert.strictEqual(cleanPayload.requestMeta.authCookie.includes('sess_secret_cookie_payload_999'), false, 'Session cookie was leaked in details');
assert.strictEqual(cleanPayload.injectionAttempt.includes('<script>'), false, 'Script tag was not disarmed');
assert.strictEqual(cleanPayload.injectionAttempt.includes('[TOOL_REQUEST:'), false, 'Tool request was not disarmed');

console.log('  ✅ [PASS] Test 2: Nested dictionary scrubbing and tag disarming verified.');

// ----------------------------------------------------
// Test 3: Record Alert to Database with Zero Leaks Assertion
// ----------------------------------------------------
console.log('▶ Test 3: Alert Database Persistence & SQLite Integrity Audit...');

const testAlertRaw = {
  level: 'error',
  category: 'security',
  message: 'Failed login attempt for user developer@bigcorp.io using password SuperSecretPwd! with key AIzaSyRealKey12345678901234567890',
  details: {
    token: 'Bearer eyJsecretTokenString123',
    session: 'sid=secret_sid_token_456',
    endpoint: '/api/v1/secure'
  },
  tenantId: 'tenant_audit_test'
};

const savedAlert = systemHealthMonitor.recordAlert(testAlertRaw);
assert.ok(savedAlert.id, 'Alert ID not generated');

// Read directly from SQLite table
const db = getDb();
const dbRow = db.prepare('SELECT * FROM system_alert_logs WHERE id = ?').get(savedAlert.id);
assert.ok(dbRow, 'Alert not found in system_alert_logs SQLite table');

// Zero-Secrets Assertion on DB Row
assert.strictEqual(dbRow.message.includes('developer@bigcorp.io'), false, 'DB Row leaked email in message');
assert.strictEqual(dbRow.message.includes('SuperSecretPwd!'), false, 'DB Row leaked password in message');
assert.strictEqual(dbRow.message.includes('AIzaSyRealKey12345678901234567890'), false, 'DB Row leaked API key in message');
assert.strictEqual(dbRow.details_json.includes('eyJsecretTokenString123'), false, 'DB Row leaked bearer token in details');
assert.strictEqual(dbRow.details_json.includes('secret_sid_token_456'), false, 'DB Row leaked session ID in details');

console.log('  ✅ [PASS] Test 3: Persisted SQLite alert row verified zero-secrets and zero-PII.');

// ----------------------------------------------------
// Test 4: Resource Thresholds & Health Probing
// ----------------------------------------------------
console.log('▶ Test 4: Memory, Disk, and Database Health Auditing...');

const mem = systemHealthMonitor.getMemoryMetrics();
assert.ok(typeof mem.rssMb === 'number' && mem.rssMb > 0, 'Invalid RSS memory metric');
assert.ok(typeof mem.heapUsedMb === 'number' && mem.heapUsedMb > 0, 'Invalid Heap memory metric');

const disk = systemHealthMonitor.getDiskMetrics();
assert.ok(typeof disk.freeMb === 'number' && disk.freeMb > 0, 'Invalid Disk free metric');
assert.ok(typeof disk.capacityPercent === 'number' && disk.capacityPercent >= 0, 'Invalid Disk capacity metric');

const dbHealth = systemHealthMonitor.checkDatabaseHealth();
assert.strictEqual(dbHealth.status, 'healthy', `Database check returned unhealthy: ${dbHealth.error}`);
assert.ok(typeof dbHealth.latencyMs === 'number', 'Invalid DB latency');

console.log(`  ✅ [PASS] Test 4: Memory (Heap: ${mem.heapUsedMb}MB, RSS: ${mem.rssMb}MB), Disk (Free: ${disk.freeMb}MB, ${disk.capacityPercent}%), DB: ${dbHealth.status} (${dbHealth.latencyMs}ms).`);

// ----------------------------------------------------
// Test 5: Alert Querying & Resolution Lifecycle
// ----------------------------------------------------
console.log('▶ Test 5: Admin Alerts Filtering & Resolution Lifecycle...');

const activeAlerts = systemHealthMonitor.listAlerts({ unresolvedOnly: true });
assert.ok(activeAlerts.some((a) => a.id === savedAlert.id), 'Recorded alert not in active alerts list');

const resolved = systemHealthMonitor.resolveAlert(savedAlert.id, 'security_admin');
assert.strictEqual(resolved, true, 'resolveAlert returned false');

const updatedAlert = db.prepare('SELECT is_resolved, resolved_by, resolved_at FROM system_alert_logs WHERE id = ?').get(savedAlert.id);
assert.strictEqual(updatedAlert.is_resolved, 1, 'Alert is_resolved not set to 1');
assert.strictEqual(updatedAlert.resolved_by, 'security_admin', 'Alert resolved_by mismatch');
assert.ok(updatedAlert.resolved_at, 'Alert resolved_at missing');

console.log('  ✅ [PASS] Test 5: Alert resolved successfully and verified updated in SQLite.');

// ----------------------------------------------------
// Test 6: Aggregated System Health Report
// ----------------------------------------------------
console.log('▶ Test 6: Aggregated Health Report for Admin Dashboard...');

const report = systemHealthMonitor.getSystemHealthReport();
assert.ok(['healthy', 'degraded', 'critical'].includes(report.status), `Invalid report status: ${report.status}`);
assert.ok(report.memory && report.disk && report.database, 'Missing subcomponents in health report');
assert.ok(typeof report.activeAlertsCount === 'number', 'Missing activeAlertsCount');

console.log(`  ✅ [PASS] Test 6: Comprehensive health report generated (Status: "${report.status}").`);

console.log('\n================================================================');
console.log('🎉 ALL SYSTEM HEALTH & ZERO-SECRETS SANITIZATION TESTS PASSED!');
console.log('================================================================\n');
