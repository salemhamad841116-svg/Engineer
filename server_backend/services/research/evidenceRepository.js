// ==============================================================================
// Evidence Repository (مستودع الأدلة الإلزامية)
// Stores extracted facts and verified exact quotes with byte-accurate coordinates.
// Mandates that all answers synthesized by the reasoning engine originate strictly
// from recorded evidence items.
// ==============================================================================

const crypto = require('node:crypto');
const { get, all, run } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { verifyVerbatimGrounding } = require('./groundingAuditor');

/**
 * Records an extracted evidence unit into the repository.
 * Enforces verbatim validation against source chunk before recording.
 */
function recordEvidence({
  sessionId,
  tenantId = 'default_tenant',
  bookId,
  bookTitle,
  author = 'غير محدد',
  chapter = 'الفصل العام',
  pageNumber = 1,
  byteStart = 0,
  byteEnd = 0,
  keyFact,
  exactQuote,
  sourceChunkText = '',
}) {
  const evidenceId = 'ev_' + crypto.randomUUID();
  const now = nowIso();

  // Audit against verbatim source text
  const audit = verifyVerbatimGrounding(exactQuote, sourceChunkText || exactQuote, 0.95);

  run(`
    INSERT INTO research_evidence (
      id, session_id, tenant_id, book_id, book_title, author, chapter,
      page_number, byte_start, byte_end, key_fact, exact_quote,
      quote_confidence, is_verified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    evidenceId, sessionId, tenantId, bookId, bookTitle, author, chapter,
    pageNumber, byteStart || 0, byteEnd || 0, keyFact, exactQuote,
    audit.matchConfidence, audit.verified ? 1 : 0, now
  );

  return {
    id: evidenceId,
    sessionId,
    bookId,
    bookTitle,
    author,
    chapter,
    pageNumber,
    byteStart,
    byteEnd,
    keyFact,
    exactQuote,
    quoteConfidence: audit.matchConfidence,
    isVerified: audit.verified,
    matchType: audit.matchType,
  };
}

/**
 * Retrieves all evidence items for a given research session.
 */
function getSessionEvidence(sessionId) {
  const rows = all('SELECT * FROM research_evidence WHERE session_id = ? ORDER BY page_number ASC', sessionId);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    tenantId: r.tenant_id,
    bookId: r.book_id,
    bookTitle: r.book_title,
    author: r.author,
    chapter: r.chapter,
    pageNumber: r.page_number,
    byteStart: r.byte_start,
    byteEnd: r.byte_end,
    keyFact: r.key_fact,
    exactQuote: r.exact_quote,
    quoteConfidence: r.quote_confidence,
    isVerified: Boolean(r.is_verified),
    createdAt: r.created_at,
  }));
}

/**
 * Purges evidence for a session (e.g. on clean restart).
 */
function purgeSessionEvidence(sessionId) {
  run('DELETE FROM research_evidence WHERE session_id = ?', sessionId);
}

module.exports = {
  recordEvidence,
  getSessionEvidence,
  purgeSessionEvidence,
};
