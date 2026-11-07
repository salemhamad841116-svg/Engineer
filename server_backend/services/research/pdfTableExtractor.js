// ==============================================================================
// High-Fidelity PDF & Document Table Extraction Engine (Phase 7)
// Extracts, normalizes, and structures tabular data and comparison matrices.
// Stores: Structured JSON, RFC-4180 CSV, and Markdown table representation.
// Preserves: byte_start, byte_end, page_number, and captions for verbatim grounding.
// ==============================================================================

const crypto = require('node:crypto');
const { getDb } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

/**
 * Parses markdown table text into structured columns, rows, and JSON.
 */
function parseMarkdownTable(rawTableText) {
  const lines = rawTableText
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|'));

  if (lines.length < 2) return null;

  const parseRow = (line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

  const headers = parseRow(lines[0]);
  // Line 1 is usually separator (| :--- | :--- |)
  let dataLines = lines.slice(1);
  if (dataLines.length > 0 && /^[|\s:-]+$/.test(dataLines[0])) {
    dataLines = dataLines.slice(1);
  }

  const rows = dataLines.map(parseRow);
  const jsonData = rows.map((row) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h || `col_${idx + 1}`] = row[idx] || '';
    });
    return obj;
  });

  // Convert to CSV
  const csvEscape = (val) => {
    const str = String(val || '').replace(/"/g, '""');
    return /[",\n\r]/.test(str) ? `"${str}"` : str;
  };
  const csvLines = [
    headers.map(csvEscape).join(','),
    ...rows.map((r) => r.map(csvEscape).join(',')),
  ];
  const csvContent = csvLines.join('\n');

  return {
    headers,
    rows,
    jsonData,
    csvContent,
    markdownTable: lines.join('\n'),
    rowCount: rows.length,
    colCount: headers.length,
  };
}

/**
 * Extracts tables from document text with caption and byte offset detection.
 */
function extractTablesFromText(text, { documentId = 'doc_general', defaultPage = 1, tenantId = 'system_shared' } = {}) {
  if (!text || typeof text !== 'string') return [];

  const tables = [];
  const lines = text.split(/\r?\n/);
  let currentTableLines = [];
  let currentCaption = '';
  let inTable = false;
  let tableIdx = 1;
  let runningByteOffset = 0;
  let tableByteStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline

    // Check if line looks like a table caption (e.g., "جدول 1-2: ..." or "Table 3: ...")
    const captionMatch = line.match(/^(?:جدول\s+[0-9-]+[:\s]|Table\s+[0-9.]+[:\s]|مصفوفة\s+[0-9-]+[:\s])(.*)/i);
    if (captionMatch && !inTable) {
      currentCaption = line.trim();
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableByteStart = runningByteOffset;
        currentTableLines = [];
      }
      currentTableLines.push(line.trim());
    } else {
      if (inTable) {
        inTable = false;
        const rawTable = currentTableLines.join('\n');
        const parsed = parseMarkdownTable(rawTable);
        if (parsed) {
          const tableByteEnd = runningByteOffset;
          const id = 'tbl_' + crypto.createHash('md5').update(`${documentId}_${tableIdx}_${tableByteStart}`).digest('hex').slice(0, 16);
          tables.push({
            id,
            documentId,
            pageNumber: defaultPage,
            tableIdx: tableIdx++,
            caption: currentCaption || `جدول بيانات تقني #${tableIdx - 1}`,
            markdownTable: parsed.markdownTable,
            csvContent: parsed.csvContent,
            jsonData: JSON.stringify(parsed.jsonData),
            byteStart: tableByteStart,
            byteEnd: tableByteEnd,
            tenantId,
            headers: parsed.headers,
            rowCount: parsed.rowCount,
          });
        }
        currentCaption = '';
        currentTableLines = [];
      }
    }

    runningByteOffset += lineBytes;
  }

  // Trailing table at the end of text
  if (inTable && currentTableLines.length > 1) {
    const rawTable = currentTableLines.join('\n');
    const parsed = parseMarkdownTable(rawTable);
    if (parsed) {
      const tableByteEnd = runningByteOffset;
      const id = 'tbl_' + crypto.createHash('md5').update(`${documentId}_${tableIdx}_${tableByteStart}`).digest('hex').slice(0, 16);
      tables.push({
        id,
        documentId,
        pageNumber: defaultPage,
        tableIdx: tableIdx++,
        caption: currentCaption || `جدول بيانات تقني #${tableIdx - 1}`,
        markdownTable: parsed.markdownTable,
        csvContent: parsed.csvContent,
        jsonData: JSON.stringify(parsed.jsonData),
        byteStart: tableByteStart,
        byteEnd: tableByteEnd,
        tenantId,
        headers: parsed.headers,
        rowCount: parsed.rowCount,
      });
    }
  }

  return tables;
}

/**
 * Saves extracted table into SQLite database.
 */
function saveDocumentTable(tableRecord) {
  const db = getDb();
  const id = tableRecord.id || ('tbl_' + crypto.randomUUID().slice(0, 16));
  const now = nowIso();

  db.prepare(`
    INSERT OR REPLACE INTO document_tables (
      id, document_id, page_number, table_idx, caption,
      markdown_table, csv_content, json_data, byte_start, byte_end,
      tenant_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    tableRecord.documentId,
    tableRecord.pageNumber || 1,
    tableRecord.tableIdx || 1,
    tableRecord.caption || 'جدول تقني',
    tableRecord.markdownTable,
    tableRecord.csvContent || '',
    tableRecord.jsonData || '[]',
    tableRecord.byteStart || 0,
    tableRecord.byteEnd || 0,
    tableRecord.tenantId || 'system_shared',
    now
  );

  return {
    ...tableRecord,
    id,
    createdAt: now,
  };
}

/**
 * Retrieves all tables for a given document.
 */
function findTablesForDocument(documentId, tenantContext = null) {
  const db = getDb();
  let rows;
  if (!tenantContext || tenantContext.isSuperAdmin) {
    rows = db.prepare('SELECT * FROM document_tables WHERE document_id = ? ORDER BY page_number, table_idx').all(documentId);
  } else {
    const tenantId = tenantContext.tenantId || 'system_shared';
    rows = db.prepare(`
      SELECT * FROM document_tables
      WHERE document_id = ? AND (tenant_id = ? OR tenant_id = 'system_shared')
      ORDER BY page_number, table_idx
    `).all(documentId, tenantId);
  }

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    pageNumber: r.page_number,
    tableIdx: r.table_idx,
    caption: r.caption,
    markdownTable: r.markdown_table,
    csvContent: r.csv_content,
    jsonData: JSON.parse(r.json_data || '[]'),
    byteStart: r.byte_start,
    byteEnd: r.byte_end,
    tenantId: r.tenant_id,
    createdAt: r.created_at,
  }));
}

/**
 * Reference Tables Seeding for System Library Books
 */
const SEEDED_REFERENCE_TABLES = [
  {
    documentId: 'book_db_systems_2025',
    pageNumber: 24,
    tableIdx: 1,
    caption: 'جدول 1-1: مقارنة مستويات العزل في قواعد البيانات والظواهر المسموحة (ANSI SQL Isolation Levels)',
    rawMarkdown: `
| مستوى العزل (Isolation Level) | القراءة المتسخة (Dirty Read) | القراءة غير المتكررة (Non-Repeatable Read) | القراءة الوهمية (Phantom Read) | التكلفة الأدائية والتحفّظ |
| :--- | :--- | :--- | :--- | :--- |
| Read Uncommitted | مسموحة | مسموحة | مسموحة | أدنى تكلفة، صفر أقفال قراءة |
| Read Committed | ممنوعة تماماً | مسموحة | مسموحة | توازن قياسي لمعظم التطبيقات |
| Repeatable Read | ممنوعة | ممنوعة | مسموحة | أقفال حصرية مع MVCC |
| Serializable | ممنوعة | ممنوعة | ممنوعة | أعلى عزل، إبطاء التزامن وأقفال نطاق |
`.trim(),
  },
  {
    documentId: 'book_sw_arch_2026',
    pageNumber: 68,
    tableIdx: 1,
    caption: 'جدول 3-1: المقارنة المعمارية بين نماذج الاتساق ونظرية CAP في الأنظمة الموزعة',
    rawMarkdown: `
| المعمارية / النموذج | الاتساق (Consistency) | التوافر (Availability) | مقاومة الانقسام (Partition Tolerance) | الخوارزمية المعتمدة |
| :--- | :--- | :--- | :--- | :--- |
| CP (Consistency + Partition) | قوي (Strict Linearizability) | منخفض أثناء الانقسام | مضمونة بالكامل | Raft, Multi-Paxos |
| AP (Availability + Partition) | تعاقبي نهائي (Eventual) | دائم بنسبة 100% | مضمونة بالكامل | Dynamo, Cassandra Gossip |
| CA (Consistency + Avail - Single Site) | قوي | كامل محلياً | غير مدعومة عبر شبكة غير موثوقة | Two-Phase Commit (2PC) |
`.trim(),
  },
  {
    documentId: 'book_react19_spec_2026',
    pageNumber: 42,
    tableIdx: 1,
    caption: 'جدول 2-1: مصفوفة المقارنة المعمارية بين React 18 و React 19 والأنماط المعتمدة',
    rawMarkdown: `
| الخاصية المعمارية | React 18 | React 19 المعياري | الأثر على الأداء والحزم |
| :--- | :--- | :--- | :--- |
| Server Components (RSC) | تجريبي وبدائي | معيار أساسي افتراضي | تقليص حزم JavaScript للعميل إلى الصفر |
| Server Actions | غير متاح رسمياً | مدمج بتوجيه 'use server' | إرسال النماذج والمزامنة دون استدعاءات API يدوية |
| useActionState | غير متاح | خطاف قياسي لإدارة الحالة | تحديثات فورية للحالات المعلقة والمتفائلة |
| التعامل مع DOM | مسموح بحذر | محظور تماماً للمحركات الحديثة | تفادي تسريب الذاكرة وتناقض التصيير المتدفق |
`.trim(),
  },
];

/**
 * Seeds reference tables into SQLite database.
 */
function seedReferenceTables(force = false) {
  const db = getDb();
  for (const ref of SEEDED_REFERENCE_TABLES) {
    const existing = db.prepare('SELECT id FROM document_tables WHERE document_id = ? AND table_idx = ?').get(ref.documentId, ref.tableIdx);
    if (!existing || force) {
      const parsed = parseMarkdownTable(ref.rawMarkdown);
      if (parsed) {
        const id = 'tbl_seed_' + crypto.createHash('md5').update(`${ref.documentId}_${ref.tableIdx}`).digest('hex').slice(0, 12);
        db.prepare(`
          INSERT OR REPLACE INTO document_tables (
            id, document_id, page_number, table_idx, caption,
            markdown_table, csv_content, json_data, byte_start, byte_end,
            tenant_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          ref.documentId,
          ref.pageNumber,
          ref.tableIdx,
          ref.caption,
          parsed.markdownTable,
          parsed.csvContent,
          JSON.stringify(parsed.jsonData),
          0,
          Buffer.byteLength(ref.rawMarkdown, 'utf-8'),
          'system_shared',
          '2026-11-07T12:00:00.000Z'
        );
      }
    }
  }
}

module.exports = {
  parseMarkdownTable,
  extractTablesFromText,
  saveDocumentTable,
  findTablesForDocument,
  seedReferenceTables,
  SEEDED_REFERENCE_TABLES,
};
