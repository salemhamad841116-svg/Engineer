// ==============================================================================
// High-Fidelity PDF & Document Diagram / Figure Extraction Engine (Phase 7)
// Identifies, indexes, and structures architectural diagrams, flowcharts,
// and state machine figures with page numbers, captions, and context.
// ==============================================================================

const crypto = require('node:crypto');
const { getDb } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

/**
 * Classifies figure type based on caption and contextual keywords.
 */
function classifyFigureType(captionText, contextText = '') {
  const combined = (captionText + ' ' + contextText).toLowerCase();
  if (/تسلسل|sequence|تفاعل\s+بين|تبادل\s+رسائل|two-phase\s+commit|2pc|مراحل\s+التصويت/i.test(combined)) {
    return 'sequence_diagram';
  }
  if (/دورة\s+حياة|state\s*machine|حالات|انتقال/i.test(combined)) {
    return 'state_machine';
  }
  if (/تدفق|مخطط\s+انسيابي|flowchart|خطوات|مسار/i.test(combined)) {
    return 'flowchart';
  }
  if (/مصفوفة|matrix|جدول\s+مقارنة/i.test(combined)) {
    return 'matrix';
  }
  return 'architecture_diagram';
}

/**
 * Extracts diagrams and figures from document text.
 */
function extractDiagramsFromText(text, { documentId = 'doc_general', defaultPage = 1, tenantId = 'system_shared' } = {}) {
  if (!text || typeof text !== 'string') return [];

  const figures = [];
  const lines = text.split(/\r?\n/);
  let runningByteOffset = 0;
  let figureIdx = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, 'utf-8') + 1;

    // Detect figure indicators: e.g. "الشكل 2-1: ...", "Figure 3.1: ...", "[مخطط معماري: ...]"
    const match = line.match(/^(?:الشكل\s+([0-9.-]+)[:\s]|Figure\s+([0-9.]+[:\s])|\[مخطط\s+معماري[:\s]|\[رسم\s+توضيحي[:\s])(.*)/i);
    if (match) {
      const figureNumber = match[1] || match[2] || `${figureIdx}`;
      const caption = line.trim();
      // Extract surrounding context (next 3 lines if available)
      const contextLines = lines.slice(i + 1, i + 4).filter((l) => l.trim().length > 0);
      const contextText = contextLines.join(' ');
      const figureType = classifyFigureType(caption, contextText);

      const id = 'fig_' + crypto.createHash('md5').update(`${documentId}_${figureIdx}_${runningByteOffset}`).digest('hex').slice(0, 16);
      figures.push({
        id,
        documentId,
        pageNumber: defaultPage,
        figureIdx: figureIdx++,
        figureNumber: String(figureNumber).trim(),
        caption,
        figureType,
        byteOffset: runningByteOffset,
        metadataJson: JSON.stringify({
          contextSnippet: contextText.slice(0, 300),
          extractedAt: nowIso(),
        }),
        tenantId,
      });
    }

    runningByteOffset += lineBytes;
  }

  return figures;
}

/**
 * Saves extracted figure into SQLite database.
 */
function saveDocumentFigure(figureRecord) {
  const db = getDb();
  const id = figureRecord.id || ('fig_' + crypto.randomUUID().slice(0, 16));
  const now = nowIso();

  db.prepare(`
    INSERT OR REPLACE INTO document_figures (
      id, document_id, page_number, figure_idx, figure_number,
      caption, figure_type, byte_offset, metadata_json,
      tenant_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    figureRecord.documentId,
    figureRecord.pageNumber || 1,
    figureRecord.figureIdx || 1,
    figureRecord.figureNumber || '1',
    figureRecord.caption,
    figureRecord.figureType || 'architecture_diagram',
    figureRecord.byteOffset || 0,
    figureRecord.metadataJson || '{}',
    figureRecord.tenantId || 'system_shared',
    now
  );

  return {
    ...figureRecord,
    id,
    createdAt: now,
  };
}

/**
 * Retrieves all diagrams and figures for a given document.
 */
function findFiguresForDocument(documentId, tenantContext = null) {
  const db = getDb();
  let rows;
  if (!tenantContext || tenantContext.isSuperAdmin) {
    rows = db.prepare('SELECT * FROM document_figures WHERE document_id = ? ORDER BY page_number, figure_idx').all(documentId);
  } else {
    const tenantId = tenantContext.tenantId || 'system_shared';
    rows = db.prepare(`
      SELECT * FROM document_figures
      WHERE document_id = ? AND (tenant_id = ? OR tenant_id = 'system_shared')
      ORDER BY page_number, figure_idx
    `).all(documentId, tenantId);
  }

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    pageNumber: r.page_number,
    figureIdx: r.figure_idx,
    figureNumber: r.figure_number,
    caption: r.caption,
    figureType: r.figure_type,
    byteOffset: r.byte_offset,
    metadata: JSON.parse(r.metadata_json || '{}'),
    tenantId: r.tenant_id,
    createdAt: r.created_at,
  }));
}

/**
 * Reference Figures Seeding for System Library Books
 */
const SEEDED_REFERENCE_FIGURES = [
  {
    documentId: 'book_db_systems_2025',
    pageNumber: 38,
    figureIdx: 1,
    figureNumber: '2-1',
    caption: 'الشكل 2-1: مخطط دورة حياة معاملة Two-Phase Commit (2PC) ومراحل التصويت والالتزام بين المنسق والعقد',
    figureType: 'sequence_diagram',
    contextText: 'يوضح المخطط كيفية إرسال رسالة Prepare من العقدة المنسقة وانتظار أصوات جميع المشاركين قبل إصدار أمر Commit النهائي.',
  },
  {
    documentId: 'book_sw_arch_2026',
    pageNumber: 84,
    figureIdx: 1,
    figureNumber: '4-1',
    caption: 'الشكل 4-1: آلة حالات اختيار القائد في بروتوكول Raft (Leader Election State Machine) وتوزيع النصاب',
    figureType: 'state_machine',
    contextText: 'تتحول العقدة من Follower إلى Candidate عند نفاد مؤقت الانتخاب العشوائي، ثم ترسل طلبات RequestVote لجمع النصاب القانوني Majority.',
  },
  {
    documentId: 'book_react19_spec_2026',
    pageNumber: 56,
    figureIdx: 1,
    figureNumber: '3-1',
    caption: 'الشكل 3-1: التدفق المعماري لمكونات الخادم React Server Components والتدفق المتزامن نحو المتصفح',
    figureType: 'architecture_diagram',
    contextText: 'تنفيذ كود المكونات بالكامل على خادم Node.js وبث حمولة المكونات بصيغة JSON Stream إلى العميل دون إرسال كود المكون نفسه.',
  },
];

/**
 * Seeds reference figures into SQLite database.
 */
function seedReferenceFigures(force = false) {
  const db = getDb();
  for (const ref of SEEDED_REFERENCE_FIGURES) {
    const existing = db.prepare('SELECT id FROM document_figures WHERE document_id = ? AND figure_idx = ?').get(ref.documentId, ref.figureIdx);
    if (!existing || force) {
      const id = 'fig_seed_' + crypto.createHash('md5').update(`${ref.documentId}_${ref.figureIdx}`).digest('hex').slice(0, 12);
      db.prepare(`
        INSERT OR REPLACE INTO document_figures (
          id, document_id, page_number, figure_idx, figure_number,
          caption, figure_type, byte_offset, metadata_json,
          tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        ref.documentId,
        ref.pageNumber,
        ref.figureIdx,
        ref.figureNumber,
        ref.caption,
        ref.figureType,
        0,
        JSON.stringify({ contextSnippet: ref.contextText, seeded: true }),
        'system_shared',
        '2026-11-07T12:00:00.000Z'
      );
    }
  }
}

module.exports = {
  classifyFigureType,
  extractDiagramsFromText,
  saveDocumentFigure,
  findFiguresForDocument,
  seedReferenceFigures,
  SEEDED_REFERENCE_FIGURES,
};
