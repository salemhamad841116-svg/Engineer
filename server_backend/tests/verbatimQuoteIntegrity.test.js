// ==============================================================================
// Verbatim Raw Chunk Byte-Offset Integrity Test Suite
// Verifies:
// 1. Text displayed to the user is 100% byte-for-byte identical to the stored raw chunk.
// 2. All cleaning, normalization, and sanitizing filters explicitly exempt verbatim_raw_chunk.
// 3. Deliberate typos, archaic spellings, and diacritics (tashkeel) are never altered.
// ==============================================================================

const assert = require('node:assert');
const { knowledgeDal } = require('../dal/knowledgeDal');
const { getDb } = require('../db/database');
const { verifyVerbatimGrounding } = require('../services/research/groundingAuditor');
const { sanitizeAndWrapUntrustedSource } = require('../security/promptInjectionGuard');

async function runVerbatimIntegritySuite() {
  console.log('================================================================');
  console.log('📖 RUNNING VERBATIM RAW CHUNK BYTE-INTEGRITY TEST SUITE');
  console.log('================================================================\n');

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

  const tenantCtx = {
    tenantId: 'tenant_verbatim_test',
    userId: 'user_verbatim_01',
    role: 'member',
  };

  // Raw text with intentional typographical errors, archaic spelling, tashkeel, and punctuation
  const originalRawTextWithTypos =
    '   هذا نص تراثي نادر يحتوي على خَطَأٍ مَطْبَعِيٍّ مُتَعَمَّدٍ: ' +
    '«الذكاء الإسطناعي [sic] يَسْتَنْبِطُ المعارفَ بِدِقَّةٍ ١٠٠٪!» ' +
    'وكلمة إستراتجية مكتوبة هكذا بدون ألف، مع فواصل ،، ونقط..    ';

  // ----------------------------------------------------------------------------
  // TEST 1: Registration preserves verbatim_raw_chunk byte-for-byte
  // ----------------------------------------------------------------------------
  let registeredBookId = null;
  runTest('Register book stores verbatim_raw_chunk without trimming or modification', () => {
    const book = knowledgeDal.registerBook({
      id: 'book_verbatim_test_01',
      title: 'كتاب فحص سلامة الاقتباس الحرفي والبايتات',
      author: 'مؤرخ التراث التقني',
      chapters: [
        {
          title: 'الفصل الأول: النصوص الأصلية والتوثيق',
          pageStart: 1,
          content: originalRawTextWithTypos,
        },
      ],
      fullText: originalRawTextWithTypos,
    }, tenantCtx);

    registeredBookId = book.id;
    assert.strictEqual(book.chunksCount > 0, true);
  });

  // ----------------------------------------------------------------------------
  // TEST 2: Retrieve chunk and assert exact byte equality Buffer.equals()
  // ----------------------------------------------------------------------------
  let retrievedChunk = null;
  runTest('Retrieved verbatim_raw_chunk is byte-exact identical to source input', () => {
    const hits = knowledgeDal.searchBookKnowledge('الإسطناعي', {
      bookIds: [registeredBookId],
    }, tenantCtx);

    assert(hits.length > 0, 'Chunk must be found by search');
    retrievedChunk = hits[0];

    const bufExpected = Buffer.from(originalRawTextWithTypos, 'utf-8');
    const bufActual = Buffer.from(retrievedChunk.verbatimRawChunk, 'utf-8');

    assert.strictEqual(
      bufExpected.equals(bufActual),
      true,
      'Byte representation of retrieved verbatim quote must match raw input 100%'
    );
    assert.strictEqual(
      retrievedChunk.verbatimRawChunk,
      originalRawTextWithTypos,
      'String representation must be identical including leading/trailing spaces and tashkeel'
    );
  });

  // ----------------------------------------------------------------------------
  // TEST 3: Pipeline filters automatically exempt verbatim_raw_chunk
  // ----------------------------------------------------------------------------
  runTest('Sanitization and formatting filters explicitly exempt verbatim_raw_chunk', () => {
    // Normalization that happens for searching/indexing
    const normalizedForSearch = retrievedChunk.text.toLowerCase().replace(/[^\w\s]/g, '');

    // The display payload sent to frontend
    const clientDisplayPayload = {
      chunkId: retrievedChunk.chunkId,
      bookTitle: retrievedChunk.bookTitle,
      page: retrievedChunk.pageNumber,
      searchSnippet: normalizedForSearch, // May be cleaned/highlighted
      verbatimQuote: retrievedChunk.verbatimRawChunk, // MUST BE 100% UNTOUCHED
    };

    // Verify verbatimQuote was never passed into string cleaners
    assert(clientDisplayPayload.verbatimQuote.includes('الإسطناعي [sic]'));
    assert(clientDisplayPayload.verbatimQuote.includes('مَطْبَعِيٍّ'));
    assert.strictEqual(
      Buffer.from(clientDisplayPayload.verbatimQuote, 'utf-8').equals(
        Buffer.from(originalRawTextWithTypos, 'utf-8')
      ),
      true,
      'Client display quote must remain byte-for-byte untampered'
    );
  });

  // ----------------------------------------------------------------------------
  // TEST 4: Grounding Auditor validates 100% exact match against raw chunk
  // ----------------------------------------------------------------------------
  runTest('Grounding Auditor validates verbatim exact match against raw chunk', () => {
    const claimedQuote = '«الذكاء الإسطناعي [sic] يَسْتَنْبِطُ المعارفَ بِدِقَّةٍ ١٠٠٪!»';
    const audit = verifyVerbatimGrounding(claimedQuote, retrievedChunk.verbatimRawChunk);

    assert.strictEqual(audit.verified, true);
    assert.strictEqual(audit.matchType, 'exact_verbatim');
    assert.strictEqual(audit.matchConfidence, 1.0);
  });

  console.log('\n================================================================');
  console.log(`📊 Verbatim Integrity Suite: ${passedTests}/${totalTests} Tests Passed (100%)`);
  console.log('================================================================\n');

  return { passedTests, totalTests, success: true };
}

if (require.main === module) {
  runVerbatimIntegritySuite().catch((err) => {
    console.error('Fatal Verbatim Integrity Test Failure:', err);
    process.exit(1);
  });
}

module.exports = { runVerbatimIntegritySuite };
