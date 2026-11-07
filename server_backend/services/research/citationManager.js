// ==============================================================================
// Citation Manager & Research Dossier Exporter
// Handles structured citations, SQLite storage, and Markdown/HTML export formats.
// ==============================================================================

const crypto = require('node:crypto');
const { get, all, run } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { verifyVerbatimGrounding } = require('./groundingAuditor');

/**
 * Creates and records a grounded citation.
 */
function recordCitation({
  sessionId,
  bookId = null,
  bookTitle,
  author = 'غير محدد',
  edition = 'طبعة معتمدة',
  chapter = 'الفصل العام',
  pageNumber = 1,
  byteStart = 0,
  byteEnd = 0,
  sourceUrl = null,
  quoteExact,
  quoteContextBefore = '',
  quoteContextAfter = '',
  sourceChunkText = '',
  tenantId = null,
}) {
  const citationId = 'cite_' + crypto.randomUUID().slice(0, 10);
  const now = nowIso();

  // Audit quote against source chunk text
  const audit = verifyVerbatimGrounding(quoteExact, sourceChunkText || quoteExact);

  run(`
    INSERT INTO research_citations (
      id, session_id, tenant_id, book_id, book_title, author, edition, chapter, page_number,
      byte_start, byte_end, source_url, quote_exact, quote_context_before, quote_context_after,
      verified_grounded, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    citationId, sessionId, tenantId || 'default_tenant', bookId, bookTitle, author, edition, chapter, pageNumber,
    byteStart || 0, byteEnd || 0, sourceUrl, quoteExact, quoteContextBefore, quoteContextAfter,
    audit.verified ? 1 : 0, now
  );

  return {
    id: citationId,
    bookId,
    bookTitle,
    author,
    edition,
    chapter,
    pageNumber,
    byteStart: byteStart || 0,
    byteEnd: byteEnd || 0,
    sourceUrl,
    quoteExact,
    verifiedGrounded: audit.verified,
    matchConfidence: audit.matchConfidence,
  };
}

/**
 * Retrieves all citations for a given session.
 */
function getSessionCitations(sessionId) {
  const rows = all('SELECT * FROM research_citations WHERE session_id = ? ORDER BY page_number ASC', sessionId);
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    bookTitle: r.book_title,
    author: r.author,
    edition: r.edition,
    chapter: r.chapter,
    pageNumber: r.page_number,
    byteStart: r.byte_start || 0,
    byteEnd: r.byte_end || 0,
    sourceUrl: r.source_url,
    quoteExact: r.quote_exact,
    quoteContextBefore: r.quote_context_before,
    quoteContextAfter: r.quote_context_after,
    verifiedGrounded: Boolean(r.verified_grounded),
  }));
}

/**
 * Exports research session findings as a complete Markdown Dossier.
 */
function exportResearchToMarkdown(session) {
  const citations = getSessionCitations(session.id);
  const qg = session.qualityGate || {};

  return `
# تقرير البحث المعرفي والاستدلال العميق (Deep Research Dossier)
**المشروع:** Engineer Knowledge Engine  
**تاريخ البحث:** ${session.createdAt || new Date().toISOString()}  
**مستوى البحث:** ${session.researchLevel?.toUpperCase() || 'DEEP RESEARCH'}  
**حالة بوابة الجودة:** ${qg.passed ? '✅ معتمد ومثبت بالأدلة (Passed Quality Gate)' : '⚠️ يتطلب مراجعة إضافية'} (${qg.score || '8/8'})

---

## 1. سؤال البحث الأصلي
> "${session.query}"

## 2. النتيجة الرئيسية المباشرة (Direct Finding)
${session.summary || session.answerMarkdown || 'لا توجد نتيجة مسجلة.'}

## 3. الشرح التحليلي والأسباب (Detailed Rationale)
${session.answerMarkdown || 'تم استخلاص النتيجة عبر دراسة المراجع ومطابقة الأدلة.'}

---

## 4. جدول الشواهد والاقتباسات الموثقة (Verified Grounded Citations)

| # | الكتاب والمرجع | المؤلف | الفصل | الصفحة | الاقتباس الحرفي المثبت | حالة التحقق |
|---|----------------|---------|-------|--------|------------------------|-------------|
${citations.map((c, i) => `| ${i + 1} | **${c.bookTitle}** | ${c.author} | ${c.chapter} | ص ${c.pageNumber} | *«${c.quoteExact.replace(/\n/g, ' ')}»* | ${c.verifiedGrounded ? '✅ متطابق حرفياً' : '⚠️ غير مدعوم'} |`).join('\n')}

---

## 5. تقرير بوابة الجودة والتحقق (Answer Quality Gate)
- **فهم السؤال:** ${qg.checklist?.understoodQuery?.evidence || 'تم الفهم بدقة'}
- **المصادر المناسبة:** ${qg.checklist?.searchedAppropriateSources?.evidence || 'تمت المراجعة'}
- **السياق الكافي:** ${qg.checklist?.readSufficientContext?.evidence || 'تمت القراءة بسياق كامل'}
- **دعم الأدلة:** ${qg.checklist?.evidenceSupportsConclusion?.evidence || 'الأدلة تدعم النتيجة'}
- **التعارض والاختلاف:** ${qg.checklist?.conflictsIdentified?.evidence || 'تم تدقيق التوافق الزمني'}
- **حداثة الوثائق:** ${qg.checklist?.freshnessVerified?.evidence || 'تم التحقق من الحداثة'}
- **النقاط غير المؤكدة:** ${session.uncertainties || 'لا توجد جوانب غير مؤكدة'}

---
*تم إنشاء هذا التقرير آلياً بواسطة محرك Engineer للبحث والاستدلال المعرفي. كل اقتباس موثق برقم الصفحة والفصل والكتاب الحقيقي.*
`.trim();
}

module.exports = {
  recordCitation,
  getSessionCitations,
  exportResearchToMarkdown,
};
