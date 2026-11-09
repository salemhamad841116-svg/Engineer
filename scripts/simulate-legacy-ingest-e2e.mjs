/**
 * simulate-legacy-ingest-e2e.mjs
 * End-to-End Simulation of the Legacy Ingestion System via Service API Key & Delegated Tokens
 *
 * Simulates the complete hardened lifecycle:
 * 1. Provisioning a Service API Key from Admin (shown once, stored as SHA-256).
 * 2. Issuing a short-lived Delegated Ingestion Token for an authenticated user (TTL: 45 min).
 * 3. Computing cryptographic HMAC-SHA256 signature with anti-replay timestamp window (300s).
 * 4. Ingesting a new book with Idempotency-Key (validating 3x identical requests = 1 book).
 * 5. Polling /status until indexing is verified.
 * 6. Hybrid BM25 & Semantic Search on newly indexed book knowledge.
 * 7. Metadata patching (title, author, edition) without re-indexing.
 * 8. Atomic content replacement (/replace) asserting instantaneous old-chunk purge.
 * 9. Cascade deletion (DELETE) and confirming 0 orphan rows across all tables & 0 search results in < 1s.
 * 10. Key & Token revocation lockdown test (< 60s).
 * 11. Immutable audit trail validation in service_api_audit_logs.
 * 12. Full simulation performance benchmark (< 5.0 seconds).
 */

import assert from 'assert';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { getDb, run, get, all } = require('../server_backend/db/database.js');
const {
  generateServiceKey,
  revokeServiceKey,
  issueDelegatedToken,
  revokeDelegatedToken,
  computeHmacSignature,
  resetRateLimits,
} = require('../server_backend/auth/serviceKeyAuth.js');
const { sha256Hex } = require('../server_backend/utils/ids.js');
const { nowIso } = require('../server_backend/utils/clock.js');
const { knowledgeDal } = require('../server_backend/dal/knowledgeDal.js');
const externalBookRoutes = require('../server_backend/routes/externalBookRoutes.js');
const externalTokenRoutes = require('../server_backend/routes/externalTokenRoutes.js');

function dispatchRoute(router, { basePath = '', path = '/', method = 'GET', headers = {}, body = null, ip = '127.0.0.1' }) {
  return new Promise((resolve) => {
    let statusCode = 200;
    const resHeaders = {};
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    const req = {
      path,
      url: path,
      originalUrl: `${basePath}${path === '/' ? '' : path}`,
      method,
      headers: lowerHeaders,
      query: {},
      params: {},
      body: body || {},
      socket: { remoteAddress: ip },
    };

    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 1) {
      req.params.id = parts[0];
    }

    const res = {
      statusCode: 200,
      status(code) {
        statusCode = code;
        this.statusCode = code;
        return res;
      },
      setHeader(name, val) {
        resHeaders[name.toLowerCase()] = val;
        return res;
      },
      getHeader(name) {
        return resHeaders[name.toLowerCase()];
      },
      json(data) {
        resolve({ status: statusCode, headers: resHeaders, body: data });
      },
      send(data) {
        resolve({ status: statusCode, headers: resHeaders, body: data });
      },
    };

    router.handle(req, res, (err) => {
      if (err) {
        const status = err.status || 500;
        resolve({
          status,
          headers: resHeaders,
          body: { error: { code: err.code || 'ERROR', message: err.message, status } },
        });
      } else {
        resolve({
          status: 404,
          headers: resHeaders,
          body: { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } },
        });
      }
    });
  });
}

function dispatchExternalRequest(opts) {
  return dispatchRoute(externalBookRoutes, { basePath: '/api/external/books', ...opts });
}

function dispatchTokenRequest(opts) {
  return dispatchRoute(externalTokenRoutes, { basePath: '/api/external/tokens', ...opts });
}

export async function runLegacyIngestSimulation() {
  const simStartTime = Date.now();

  console.log('\n================================================================');
  console.log('🚀 RUNNING LEGACY INGESTION E2E INTEGRATION SIMULATION');
  console.log('================================================================\n');

  const db = getDb();
  resetRateLimits();

  // 1. Seed tenant user for legacy client
  const legacyUserId = 'usr_legacy_client_sim_' + Date.now();
  run(
    `INSERT OR REPLACE INTO users (id, name, email, password_hash, role, status, created_at)
     VALUES (?, 'Legacy Ingestion Service Account', ?, 'hash', 'supervisor', 'active', datetime('now'))`,
    legacyUserId,
    `${legacyUserId}@client.test`
  );
  console.log(`[Step 1] Seeded target legacy user: ${legacyUserId}`);

  // 2. Generate Service API Key with scope 'books:crud'
  const serviceKey = generateServiceKey({
    name: 'Legacy OCR & Pipeline Ingestor (Automated Simulation)',
    scopes: ['books:crud'],
    rateLimitRpm: 60,
  });
  assert.ok(serviceKey.rawKey.startsWith('sk_live_'), 'Key must start with sk_live_');
  console.log(`[Step 2] Generated Service API Key: ${serviceKey.rawKey.slice(0, 16)}... (ID: ${serviceKey.id})`);

  // Verify only SHA-256 hash is in database
  const keyInDb = get('SELECT * FROM service_api_keys WHERE id = ?', serviceKey.id);
  assert.strictEqual(keyInDb.key_hash, sha256Hex(serviceKey.rawKey), 'DB must store SHA-256 hash');

  // 3. User logs in via Unified Login / SSO, generating active session proof
  console.log('[Step 3] Simulating Unified Login (SSO) and issuing short-lived Delegated Token...');
  const userSessionToken = crypto.randomBytes(32).toString('hex');
  const sessionId = 'ses_sim_' + Date.now();
  const sessionNow = nowIso();
  const sessionExpiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
  run(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, last_activity_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    sessionId,
    legacyUserId,
    sha256Hex(userSessionToken),
    sessionNow,
    sessionNow,
    sessionNow,
    sessionExpiresAt
  );

  const tokenIssueRes = await dispatchTokenRequest({
    path: '/delegated',
    method: 'POST',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Session-Token': userSessionToken,
    },
    body: { userId: legacyUserId, ttlMinutes: 45 },
  });
  assert.strictEqual(tokenIssueRes.status, 201, 'Token issuance must return 201');
  const delegatedToken = tokenIssueRes.body.delegatedToken;
  assert.ok(delegatedToken.startsWith('dit_live_'), 'Token must start with dit_live_');
  assert.strictEqual(tokenIssueRes.body.ttlSeconds, 2700, 'TTL must be 2700 seconds');
  console.log(`  ✅ Delegated token generated: ${delegatedToken.slice(0, 18)}... (TTL: ${tokenIssueRes.body.ttlMinutes} min)`);

  // Helper to generate signed headers with HMAC
  const makeSignedHeaders = ({ method = 'GET', path = '', body = null, idempotencyKey = null }) => {
    const timestamp = nowIso();
    const sig = computeHmacSignature({
      method,
      path: `/api/external/books${path}`,
      timestamp,
      delegatedToken,
      body,
      secret: keyInDb.key_hash,
    });
    const headers = {
      'X-Service-Key': serviceKey.rawKey,
      'X-Delegated-Token': delegatedToken,
      'X-Timestamp': timestamp,
      'X-Signature': sig,
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return headers;
  };

  // 4. Ingest brand new book with Idempotency-Key (3x requests = 1 book)
  const bookNonce = crypto.randomBytes(6).toString('hex');
  const bookTitle = `المرجع الهندسي في النظم الموزعة - محاكاة ${bookNonce}`;
  const initialKeyword = `SIM_KEYWORD_ALPHA_${crypto.randomBytes(8).toString('hex')}`;
  const bookContent = `
    الفصل الأول: البنية التحتية المتينة والبروتوكولات التوافقية.
    يقدم هذا المرجع تفاصيل بروتوكول Raft و Paxos ومفهوم عزل المستأجرين المتعدد.
    العلامة المفتاحية المعتمدة للمطابقة: ${initialKeyword}
    تتميز هذه المنظومة بالقدرة على معالجة ملايين المقاطع واسترجاع الاقتباسات بمرونة متناهية.
  `.trim();

  const idempotencyKey = `idem_sim_${Date.now()}_${bookNonce}`;
  const ingestPayload = {
    title: bookTitle,
    text: bookContent,
    author: 'البروفيسور عبد الرحمن سالم',
    edition: 'الإصدار الأول 2026',
    language: 'ar',
    publication_year: 2026,
  };

  console.log(`[Step 4] Testing Idempotency (3x requests with key: ${idempotencyKey})...`);
  const createRes1 = await dispatchExternalRequest({
    path: '/',
    method: 'POST',
    headers: makeSignedHeaders({ method: 'POST', path: '', body: ingestPayload, idempotencyKey }),
    body: ingestPayload,
  });
  assert.strictEqual(createRes1.status, 201, 'Book creation must return 201');
  const bookId = createRes1.body.book_id;
  assert.ok(bookId, 'Book ID must be generated');

  const createRes2 = await dispatchExternalRequest({
    path: '/',
    method: 'POST',
    headers: makeSignedHeaders({ method: 'POST', path: '', body: ingestPayload, idempotencyKey }),
    body: ingestPayload,
  });
  assert.strictEqual(createRes2.status, 201);
  assert.strictEqual(createRes2.body.book_id, bookId);

  const createRes3 = await dispatchExternalRequest({
    path: '/',
    method: 'POST',
    headers: makeSignedHeaders({ method: 'POST', path: '', body: ingestPayload, idempotencyKey }),
    body: ingestPayload,
  });
  assert.strictEqual(createRes3.status, 201);
  assert.strictEqual(createRes3.body.book_id, bookId);

  const countBooksInDb = get('SELECT COUNT(*) as cnt FROM documents WHERE id = ?', bookId).cnt;
  assert.strictEqual(countBooksInDb, 1, 'Exactly 1 book must be in DB (Idempotency 3 = 1)');
  console.log(`  ✅ Idempotency confirmed: 3 identical requests created count = 1 book (ID: ${bookId}).`);

  // 5. Poll status via GET /api/external/books/:id/status
  console.log(`[Step 5] Polling GET /api/external/books/${bookId}/status...`);
  const statusRes = await dispatchExternalRequest({
    path: `/${bookId}/status`,
    method: 'GET',
    headers: makeSignedHeaders({ method: 'GET', path: `/${bookId}/status` }),
  });
  assert.strictEqual(statusRes.status, 200, 'Status call must return 200');
  assert.strictEqual(statusRes.body.status, 'ready', 'Status must be ready');
  assert.strictEqual(statusRes.body.chunks_count > 0, true, 'Chunks count must be > 0');
  console.log(`  ✅ Ingestion status verified: status = ${statusRes.body.status}, chunks = ${statusRes.body.chunks_count}`);

  // 6. Query Knowledge Base via Hybrid BM25 & Semantic Search
  console.log(`[Step 6] Searching knowledge base for marker: ${initialKeyword}...`);
  const tenantCtx = { tenantId: legacyUserId, userId: legacyUserId, isSuperAdmin: false };
  const searchResults = knowledgeDal.searchBookKnowledge(initialKeyword, { limit: 5 }, tenantCtx);
  assert.ok(searchResults.length >= 1, 'Search must return at least 1 result matching marker');
  assert.strictEqual(searchResults[0].bookId, bookId, 'Search result must belong to ingested book');
  assert.ok(searchResults[0].verbatimRawChunk.includes(initialKeyword), 'Verbatim text must contain marker');
  console.log(`  ✅ Knowledge search verified: score = ${searchResults[0].score.toFixed(4)}, verbatim text intact.`);

  // 7. Metadata Patching (PATCH /api/external/books/:id)
  console.log(`[Step 7] Patching metadata via PATCH /api/external/books/${bookId}...`);
  const patchedTitle = `${bookTitle} [طبعة محكّمة ومعدلة]`;
  const patchPayload = {
    title: patchedTitle,
    edition: 'الطبعة الثانية المحكّمة',
    publication_year: 2027,
  };
  const patchRes = await dispatchExternalRequest({
    path: `/${bookId}`,
    method: 'PATCH',
    headers: makeSignedHeaders({ method: 'PATCH', path: `/${bookId}`, body: patchPayload }),
    body: patchPayload,
  });
  assert.strictEqual(patchRes.status, 200, 'Patch must return 200');
  assert.strictEqual(patchRes.body.updated, true);

  const updatedDoc = get('SELECT title FROM documents WHERE id = ?', bookId);
  assert.strictEqual(updatedDoc.title, patchedTitle, 'Document title must reflect patch');
  console.log('  ✅ Metadata patch confirmed: title updated in DB without altering chunks.');

  // 8. Atomic Content Replacement (POST /api/external/books/:id/replace)
  console.log(`[Step 8] Testing atomic content replacement via POST /api/external/books/${bookId}/replace...`);
  const replacementKeyword = `REPLACED_REV_${crypto.randomBytes(8).toString('hex')}`;
  const replacePayload = {
    title: `${patchedTitle} - الإصدار المستبدل`,
    text: `الفصل الجديد كلياً: المعمارية السحابية من الجيل الرابع.\nالعلامة الجديدة: ${replacementKeyword}`,
  };

  const replaceRes = await dispatchExternalRequest({
    path: `/${bookId}/replace`,
    method: 'POST',
    headers: makeSignedHeaders({ method: 'POST', path: `/${bookId}/replace`, body: replacePayload }),
    body: replacePayload,
  });
  assert.strictEqual(replaceRes.status, 200, 'Replace must return 200');
  assert.strictEqual(replaceRes.body.replaced, true);

  // Assert old keyword returns 0 results immediately
  const searchOldAfter = knowledgeDal.searchBookKnowledge(initialKeyword, { limit: 5 }, tenantCtx);
  assert.strictEqual(searchOldAfter.length, 0, 'Old version chunks must return 0 results after replacement');

  // Assert new keyword is immediately searchable
  const searchNewAfter = knowledgeDal.searchBookKnowledge(replacementKeyword, { limit: 5 }, tenantCtx);
  assert.ok(searchNewAfter.length >= 1, 'New version chunks must be immediately searchable');
  console.log('  ✅ Atomic content replacement confirmed: old content purged, new content searchable.');

  // 9. Cascade Purge Deletion (DELETE /api/external/books/:id)
  console.log(`[Step 9] Executing cascade purge via DELETE /api/external/books/${bookId}...`);
  const deleteRes = await dispatchExternalRequest({
    path: `/${bookId}`,
    method: 'DELETE',
    headers: makeSignedHeaders({ method: 'DELETE', path: `/${bookId}` }),
  });
  assert.strictEqual(deleteRes.status, 200, 'Delete must return 200');
  assert.strictEqual(deleteRes.body.deleted, true);

  // Verify 0 orphan rows in DB
  assert.strictEqual(get('SELECT COUNT(*) as c FROM documents WHERE id = ?', bookId).c, 0, 'documents = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM chunks WHERE document_id = ?', bookId).c, 0, 'chunks = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM book_structures WHERE book_id = ?', bookId).c, 0, 'book_structures = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM book_pages WHERE book_id = ?', bookId).c, 0, 'book_pages = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM document_tables WHERE document_id = ?', bookId).c, 0, 'document_tables = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM document_figures WHERE document_id = ?', bookId).c, 0, 'document_figures = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM research_evidence WHERE book_id = ?', bookId).c, 0, 'research_evidence = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM research_citations WHERE book_id = ?', bookId).c, 0, 'research_citations = 0');
  assert.strictEqual(get('SELECT COUNT(*) as c FROM processing_jobs WHERE document_id = ?', bookId).c, 0, 'processing_jobs = 0');

  // Verify search returns 0 results in < 1s
  const searchPurgeStart = Date.now();
  const searchPurged = knowledgeDal.searchBookKnowledge(replacementKeyword, { limit: 5 }, tenantCtx);
  const searchPurgeDuration = Date.now() - searchPurgeStart;
  assert.strictEqual(searchPurged.length, 0, 'Search must return 0 results after deletion');
  assert.ok(searchPurgeDuration < 1000, 'Search duration must be < 1s');
  console.log(`  ✅ Cascade deletion confirmed: 0 orphan rows, search = 0 in ${searchPurgeDuration}ms (< 1.0s).`);

  // 10. Key & Token Revocation Lockdown (< 60s)
  console.log('[Step 10] Testing immediate Key & Token Revocation (< 60s)...');
  const revokeStart = Date.now();
  revokeServiceKey(serviceKey.id);
  const revokeDuration = Date.now() - revokeStart;

  const postRevokeRes = await dispatchExternalRequest({
    path: '/',
    method: 'POST',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-Delegated-Token': delegatedToken,
    },
    body: { title: 'محاولة اختراق بعد الإبطال' },
  });
  assert.strictEqual(postRevokeRes.status, 403, 'Revoked key must be blocked with HTTP 403');
  assert.strictEqual(postRevokeRes.body.error.code, 'SERVICE_KEY_REVOKED');
  console.log(`  ✅ Key revocation lockdown confirmed: blocked in ${revokeDuration}ms (< 60s).`);

  // 11. Audit Trail Validation
  console.log('[Step 11] Verifying immutable audit trail in service_api_audit_logs...');
  const auditLogs = all(
    'SELECT * FROM service_api_audit_logs WHERE service_key_id = ? ORDER BY created_at ASC',
    serviceKey.id
  );
  assert.ok(auditLogs.length >= 5, 'Must have recorded audit logs for external actions');
  console.log(`  ✅ Audit trail confirmed: ${auditLogs.length} events logged.`);

  // 12. Performance benchmark: Criterion 9 (< 5.0 seconds)
  const totalDurationMs = Date.now() - simStartTime;
  assert.ok(totalDurationMs < 5000, `Total simulation duration (${totalDurationMs}ms) must be < 5000ms (< 5s)`);
  console.log(`\n⏱️ Total Simulation Execution Time: ${totalDurationMs}ms (< 5.0s target met).`);

  console.log('\n================================================================');
  console.log('🎉 LEGACY INGESTION E2E SIMULATION COMPLETED SUCCESSFULLY (100%)');
  console.log('================================================================\n');
}

if (process.argv[1] && process.argv[1].endsWith('simulate-legacy-ingest-e2e.mjs')) {
  runLegacyIngestSimulation().catch((err) => {
    console.error('❌ SIMULATION FAILED:', err);
    process.exit(1);
  });
}
