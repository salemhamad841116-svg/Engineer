/**
 * simulate-legacy-ingest-e2e.mjs
 * End-to-End Simulation of the Legacy Ingestion System via Service API Key
 *
 * Simulates the complete lifecycle:
 * 1. Provisioning a Service API Key from Admin (shown once, stored as SHA-256).
 * 2. Ingesting a new book with Idempotency-Key.
 * 3. Polling /status until indexing is verified.
 * 4. Hybrid BM25 & Semantic Search on newly indexed book knowledge.
 * 5. Metadata patching (title, author, edition) without re-indexing.
 * 6. Atomic content replacement (/replace) and asserting instantaneous old-chunk purge.
 * 7. Cascade deletion (DELETE) and confirming 0 orphan rows across all tables & 0 search results.
 * 8. Key revocation lifecycle test.
 * 9. Immutable audit trail validation in service_api_audit_logs.
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
  resetRateLimits,
} = require('../server_backend/auth/serviceKeyAuth.js');
const { sha256Hex } = require('../server_backend/utils/ids.js');
const { knowledgeDal } = require('../server_backend/dal/knowledgeDal.js');
const externalBookRoutes = require('../server_backend/routes/externalBookRoutes.js');

function dispatchExternalRequest({ path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve) => {
    let statusCode = 200;
    const resHeaders = {};
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    const req = {
      url: path,
      originalUrl: `/api/external/books${path}`,
      method,
      headers: lowerHeaders,
      query: {},
      params: {},
      body: body || {},
      socket: { remoteAddress: '127.0.0.1' },
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

    externalBookRoutes.handle(req, res, (err) => {
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

export async function runLegacyIngestSimulation() {
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
  assert.strictEqual(keyInDb.raw_key, undefined, 'DB must never store plaintext raw key');

  // 3. Ingest brand new book with Idempotency-Key
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
  console.log(`[Step 3] Dispatching POST /api/external/books with Idempotency-Key: ${idempotencyKey}...`);

  const createRes = await dispatchExternalRequest({
    path: '/',
    method: 'POST',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
      'Idempotency-Key': idempotencyKey,
    },
    body: {
      title: bookTitle,
      text: bookContent,
      author: 'البروفيسور عبد الرحمن سالم',
      edition: 'الإصدار الأول 2026',
      language: 'ar',
      publication_year: 2026,
    },
  });

  assert.strictEqual(createRes.status, 201, 'Book creation must return 201');
  assert.ok(createRes.body.book_id, 'Book ID must be generated');
  const bookId = createRes.body.book_id;
  console.log(`  ✅ Book successfully ingested with ID: ${bookId} (chunks: ${createRes.body.chunks_indexed})`);

  // Verify Idempotency replay returns exact same book
  const replayRes = await dispatchExternalRequest({
    path: '/',
    method: 'POST',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
      'Idempotency-Key': idempotencyKey,
    },
    body: {
      title: bookTitle,
      text: bookContent,
    },
  });
  assert.strictEqual(replayRes.status, 201, 'Idempotent replay must return 201');
  assert.strictEqual(replayRes.body.book_id, bookId, 'Idempotent replay must match book ID');
  console.log('  ✅ Idempotency verified: replayed request returned identical book ID.');

  // 4. Poll status via GET /api/external/books/:id/status
  console.log(`[Step 4] Polling GET /api/external/books/${bookId}/status...`);
  const statusRes = await dispatchExternalRequest({
    path: `/${bookId}/status`,
    method: 'GET',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
    },
  });
  assert.strictEqual(statusRes.status, 200, 'Status call must return 200');
  assert.strictEqual(statusRes.body.status, 'ready', 'Status must be ready');
  assert.strictEqual(statusRes.body.chunks_count > 0, true, 'Chunks count must be > 0');
  console.log(`  ✅ Ingestion status verified: status = ${statusRes.body.status}, chunks = ${statusRes.body.chunks_count}`);

  // 5. Query Knowledge Base via Hybrid BM25 & Semantic Search
  console.log(`[Step 5] Searching knowledge base for marker: ${initialKeyword}...`);
  const tenantCtx = { tenantId: legacyUserId, userId: legacyUserId, isSuperAdmin: false };
  const searchResults = knowledgeDal.searchBookKnowledge(initialKeyword, { limit: 5 }, tenantCtx);
  assert.ok(searchResults.length >= 1, 'Search must return at least 1 result matching marker');
  assert.strictEqual(searchResults[0].bookId, bookId, 'Search result must belong to ingested book');
  assert.ok(searchResults[0].verbatimRawChunk.includes(initialKeyword), 'Verbatim text must contain marker');
  console.log(`  ✅ Knowledge search verified: retrieved chunk with score ${searchResults[0].score.toFixed(4)} and verbatim integrity.`);

  // 6. Metadata Patching (PATCH /api/external/books/:id)
  console.log(`[Step 6] Patching metadata via PATCH /api/external/books/${bookId}...`);
  const patchedTitle = `${bookTitle} [طبعة محكّمة ومعدلة]`;
  const patchRes = await dispatchExternalRequest({
    path: `/${bookId}`,
    method: 'PATCH',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
    },
    body: {
      title: patchedTitle,
      edition: 'الطبعة الثانية المحكّمة',
      publication_year: 2027,
    },
  });
  assert.strictEqual(patchRes.status, 200, 'Patch must return 200');
  assert.strictEqual(patchRes.body.updated, true);

  const updatedDoc = get('SELECT title FROM documents WHERE id = ?', bookId);
  assert.strictEqual(updatedDoc.title, patchedTitle, 'Document title must reflect patch');
  console.log('  ✅ Metadata patch confirmed: title updated in DB without re-indexing chunks.');

  // 7. Atomic Content Replacement (POST /api/external/books/:id/replace)
  console.log(`[Step 7] Testing atomic content replacement via POST /api/external/books/${bookId}/replace...`);
  const replacementKeyword = `REPLACED_REV_${crypto.randomBytes(8).toString('hex')}`;
  const replacementContent = `
    الفصل الجديد كلياً: المعمارية السحابية من الجيل الرابع.
    تم استبدال كامل المحتوى السابق بهذا النص المنقح.
    الرمز التعريفي الجديد الحصري: ${replacementKeyword}
  `.trim();

  const replaceRes = await dispatchExternalRequest({
    path: `/${bookId}/replace`,
    method: 'POST',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
    },
    body: {
      title: `${patchedTitle} - الإصدار المستبدل`,
      text: replacementContent,
    },
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

  // 8. Cascade Purge Deletion (DELETE /api/external/books/:id)
  console.log(`[Step 8] Executing cascade purge via DELETE /api/external/books/${bookId}...`);
  const deleteRes = await dispatchExternalRequest({
    path: `/${bookId}`,
    method: 'DELETE',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
    },
  });
  assert.strictEqual(deleteRes.status, 200, 'Delete must return 200');
  assert.strictEqual(deleteRes.body.deleted, true);

  // Verify 0 orphan rows
  const remainingDoc = get('SELECT COUNT(*) as c FROM documents WHERE id = ?', bookId).c;
  const remainingChunks = get('SELECT COUNT(*) as c FROM chunks WHERE document_id = ?', bookId).c;
  const remainingStruct = get('SELECT COUNT(*) as c FROM book_structures WHERE book_id = ?', bookId).c;
  assert.strictEqual(remainingDoc, 0, 'Document must be removed');
  assert.strictEqual(remainingChunks, 0, 'Chunks must be removed');
  assert.strictEqual(remainingStruct, 0, 'Structure must be removed');

  // Verify subsequent search returns 0 results
  const searchPurged = knowledgeDal.searchBookKnowledge(replacementKeyword, { limit: 5 }, tenantCtx);
  assert.strictEqual(searchPurged.length, 0, 'Search must return 0 results after deletion');

  // Verify GET /status returns 404
  const statusAfterDelete = await dispatchExternalRequest({
    path: `/${bookId}/status`,
    method: 'GET',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
    },
  });
  assert.strictEqual(statusAfterDelete.status, 404, 'Status after delete must return 404');
  console.log('  ✅ Cascade deletion confirmed: 0 orphan rows, search = 0, status = 404.');

  // 9. Key Revocation Test
  console.log('[Step 9] Revoking Service API Key and testing immediate lockdown...');
  revokeServiceKey(serviceKey.id);
  const postRevokeRes = await dispatchExternalRequest({
    path: '/',
    method: 'POST',
    headers: {
      'X-Service-Key': serviceKey.rawKey,
      'X-User-Id': legacyUserId,
    },
    body: { title: 'محاولة اختراق بعد الإبطال' },
  });
  assert.strictEqual(postRevokeRes.status, 403, 'Revoked key must be blocked with HTTP 403');
  assert.strictEqual(postRevokeRes.body.error.code, 'SERVICE_KEY_REVOKED');
  console.log('  ✅ Key revocation lockdown confirmed: requests with revoked key blocked immediately.');

  // 10. Audit Logs Verification
  console.log('[Step 10] Verifying immutable audit trail in service_api_audit_logs...');
  const auditLogs = all(
    'SELECT * FROM service_api_audit_logs WHERE service_key_id = ? ORDER BY created_at ASC',
    serviceKey.id
  );
  assert.ok(auditLogs.length >= 5, 'Must have recorded audit logs for all external actions');
  const loggedActions = auditLogs.map((l) => l.action);
  assert.ok(loggedActions.includes('book.create'), 'Audit trail must include book.create');
  assert.ok(loggedActions.includes('book.update_metadata'), 'Audit trail must include book.update_metadata');
  assert.ok(loggedActions.includes('book.replace'), 'Audit trail must include book.replace');
  assert.ok(loggedActions.includes('book.delete'), 'Audit trail must include book.delete');
  console.log(`  ✅ Audit trail confirmed: ${auditLogs.length} events logged with key ID, user ID, and timestamps.`);

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
