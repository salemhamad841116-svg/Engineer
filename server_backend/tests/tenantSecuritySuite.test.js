// ==============================================================================
// Automated Cross-Tenant Penetration & Security Test Suite
// Verifies Application-Level Row-Level Security (RLS) via TenantGuard & KnowledgeDAL.
// Criteria: Unauthorized cross-tenant queries MUST fail with HTTP 403 / AccessDeniedError.
// ==============================================================================

const assert = require('node:assert');
const { knowledgeDal, AccessDeniedError } = require('../dal/knowledgeDal');
const { getDb } = require('../db/database');
const { extractTenantContext } = require('../auth/tenantGuard');

async function runTenantSecuritySuite() {
  console.log('================================================================');
  console.log('🛡️ RUNNING CROSS-TENANT PENETRATION & RLS TEST SUITE');
  console.log('================================================================\n');

  // Initialize DB
  getDb();

  let passedTests = 0;
  let totalTests = 0;

  function runTest(testName, fn) {
    totalTests++;
    try {
      fn();
      passedTests++;
      console.log(`  ✅ [PASS] ${testName}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${testName}: ${err.message}`);
      throw err;
    }
  }

  // Define isolated tenant contexts
  const tenantAlpha = {
    tenantId: 'tenant_alpha_enterprise',
    userId: 'user_alpha_01',
    role: 'member',
  };

  const tenantBeta = {
    tenantId: 'tenant_beta_corporation',
    userId: 'user_beta_01',
    role: 'member',
  };

  // 1. Setup Isolated Books for Each Tenant
  console.log('[Phase 1] Seeding Isolated Tenant Books...');
  const bookAlpha = knowledgeDal.registerBook({
    id: 'book_alpha_confidential_2026',
    title: 'أسرار المعمارية الداخلية لشركة ألفا',
    author: 'فريق ألفا التقني',
    edition: 'نسخة داخلية سرية',
    publicationYear: 2026,
    isSharedLibrary: false,
    chapters: [
      {
        title: 'الفصل الأول: البنية السحابية والمفاتيح',
        pageStart: 1,
        content: 'معمارية ألفا تعتمد على خوادم معزولة كلياً ومفتاح التشفير هو: ALPHA_INTERNAL_SECRET_99.',
      },
    ],
    fullText: 'أسرار المعمارية الداخلية لشركة ألفا 2026.',
  }, tenantAlpha);

  const bookBeta = knowledgeDal.registerBook({
    id: 'book_beta_proprietary_2026',
    title: 'الخطة المالية والصفقات السرية لشركة بيتا',
    author: 'إدارة بيتا التنفيذية',
    edition: 'سري للغاية',
    publicationYear: 2026,
    isSharedLibrary: false,
    chapters: [
      {
        title: 'الفصل الأول: موازنة الاندماج والاستحواذ',
        pageStart: 1,
        content: 'صفقة بيتا المقررة تبلغ قيمتها 50 مليون دولار وتفاصيل الحسابات محفوظة في بنك الرياض.',
      },
    ],
    fullText: 'الخطة المالية لشركة بيتا 2026.',
  }, tenantBeta);

  console.log('  -> Tenant Alpha Book created:', bookAlpha.id);
  console.log('  -> Tenant Beta Book created:', bookBeta.id);
  console.log('');

  // ----------------------------------------------------------------------------
  // TEST 1: Tenant Alpha reads own book -> Success
  // ----------------------------------------------------------------------------
  runTest('Tenant Alpha can successfully read its own book details', () => {
    const details = knowledgeDal.getBookDetails(bookAlpha.id, tenantAlpha);
    assert(details !== null, 'Details should exist');
    assert.strictEqual(details.id, bookAlpha.id);
    assert.strictEqual(details.tenantId, tenantAlpha.tenantId);
  });

  // ----------------------------------------------------------------------------
  // TEST 2: Tenant Alpha tries to read Tenant Beta's book -> MUST REJECT WITH 403
  // ----------------------------------------------------------------------------
  runTest('Tenant Alpha reading Tenant Beta book throws AccessDeniedError with 403', () => {
    let rejected = false;
    try {
      knowledgeDal.getBookDetails(bookBeta.id, tenantAlpha);
    } catch (err) {
      if (err instanceof AccessDeniedError || err.statusCode === 403) {
        rejected = true;
        assert(err.message.includes('Forbidden') || err.statusCode === 403);
      }
    }
    assert.strictEqual(rejected, true, 'Access to Tenant Beta book must be forbidden with 403');
  });

  // ----------------------------------------------------------------------------
  // TEST 3: Tenant Beta tries to read Tenant Alpha's book -> MUST REJECT WITH 403
  // ----------------------------------------------------------------------------
  runTest('Tenant Beta reading Tenant Alpha book throws AccessDeniedError with 403', () => {
    let rejected = false;
    try {
      knowledgeDal.getBookDetails(bookAlpha.id, tenantBeta);
    } catch (err) {
      if (err instanceof AccessDeniedError || err.statusCode === 403) {
        rejected = true;
      }
    }
    assert.strictEqual(rejected, true, 'Access to Tenant Alpha book must be forbidden with 403');
  });

  // ----------------------------------------------------------------------------
  // TEST 4: listBooks() respects tenant boundary
  // ----------------------------------------------------------------------------
  runTest('listBooks strictly filters out books of other tenants', () => {
    const alphaBooks = knowledgeDal.listBooks(tenantAlpha);
    const betaBooks = knowledgeDal.listBooks(tenantBeta);

    const alphaHasBeta = alphaBooks.some((b) => b.id === bookBeta.id);
    const betaHasAlpha = betaBooks.some((b) => b.id === bookAlpha.id);

    assert.strictEqual(alphaHasBeta, false, 'Tenant Alpha book list MUST NOT contain Tenant Beta book');
    assert.strictEqual(betaHasAlpha, false, 'Tenant Beta book list MUST NOT contain Tenant Alpha book');
  });

  // ----------------------------------------------------------------------------
  // TEST 5: Search Injection Attack (Tenant Alpha searches specifying Beta's bookId)
  // ----------------------------------------------------------------------------
  runTest('Tenant Alpha search injecting bookIds=[bookBeta.id] throws 403 AccessDeniedError', () => {
    let rejected = false;
    try {
      knowledgeDal.searchBookKnowledge('استحواذ', {
        bookIds: [bookBeta.id],
      }, tenantAlpha);
    } catch (err) {
      if (err instanceof AccessDeniedError || err.statusCode === 403) {
        rejected = true;
      }
    }
    assert.strictEqual(rejected, true, 'Cross-tenant search injection must throw 403');
  });

  // ----------------------------------------------------------------------------
  // TEST 6: Tenant Alpha searching general keywords never returns Beta chunks
  // ----------------------------------------------------------------------------
  runTest('Tenant Alpha broad search never exposes Tenant Beta text chunks', () => {
    const hits = knowledgeDal.searchBookKnowledge('صفقة', {}, tenantAlpha);
    const containsBetaData = hits.some((h) => h.text.includes('50 مليون') || h.bookId === bookBeta.id);
    assert.strictEqual(containsBetaData, false, 'Tenant Alpha search must never leak Tenant Beta contents');
  });

  // ----------------------------------------------------------------------------
  // TEST 7: TenantGuard middleware header validation
  // ----------------------------------------------------------------------------
  runTest('TenantGuard rejects mismatched tenant header and body with 403', () => {
    const mockReq = {
      headers: { 'x-tenant-id': 'tenant_alpha' },
      body: { tenantId: 'tenant_beta' },
    };
    let rejected = false;
    try {
      extractTenantContext(mockReq);
    } catch (err) {
      if (err instanceof AccessDeniedError || err.statusCode === 403) {
        rejected = true;
      }
    }
    assert.strictEqual(rejected, true, 'Mismatched header/body must fail');
  });

  // ----------------------------------------------------------------------------
  // TEST 8: Tenant Alpha tries to delete Tenant Beta book -> MUST REJECT WITH 403
  // ----------------------------------------------------------------------------
  runTest('Tenant Alpha deleting Tenant Beta book is rejected with 403', () => {
    let rejected = false;
    try {
      knowledgeDal.deleteBook(bookBeta.id, tenantAlpha);
    } catch (err) {
      if (err instanceof AccessDeniedError || err.statusCode === 403) {
        rejected = true;
      }
    }
    assert.strictEqual(rejected, true, 'Unauthorized deletion must be rejected with 403');
  });

  console.log('\n================================================================');
  console.log(`📊 Cross-Tenant Test Suite Completed: ${passedTests}/${totalTests} Tests Passed (100%)`);
  console.log('================================================================\n');

  return { passedTests, totalTests, success: true };
}

if (require.main === module) {
  runTenantSecuritySuite().catch((err) => {
    console.error('Fatal Test Failure:', err);
    process.exit(1);
  });
}

module.exports = { runTenantSecuritySuite };
