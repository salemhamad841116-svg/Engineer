// ==============================================================================
// Unified Knowledge Data Access Layer (DAL) / Repository Pattern
// Implements Application-Level RLS (Tenant Isolation) for SQLite and PostgreSQL readiness.
// MANDATORY: All book indexing, search, citation, and chunk queries MUST pass through this DAL.
// ==============================================================================

const crypto = require('node:crypto');
const { get, all, run, tx } = require('../db/database');
const { nowIso } = require('../utils/clock');
const {
  generateEmbedding,
  vectorToBlob,
  blobToVector,
  cosineSimilarity,
  tokenizeForBM25,
  computeBM25Score,
  reciprocalRankFusion,
} = require('../services/research/localEmbeddingService');

class AccessDeniedError extends Error {
  constructor(message = 'Access denied: Tenant isolation policy violation', statusCode = 403) {
    super(message);
    this.name = 'AccessDeniedError';
    this.statusCode = statusCode;
  }
}

/**
 * Validates and normalizes tenant context.
 * Strict: Every operation requires a valid tenantId.
 */
function assertTenantContext(tenantContext) {
  if (!tenantContext || typeof tenantContext !== 'object') {
    throw new AccessDeniedError('Missing tenantContext: All DAL operations require authenticated tenant context', 403);
  }
  const tenantId = tenantContext.tenantId || tenantContext.userId;
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    throw new AccessDeniedError('Invalid tenantId in tenantContext: Cross-tenant security violation', 403);
  }
  return {
    tenantId: tenantId.trim(),
    userId: tenantContext.userId ? String(tenantContext.userId).trim() : tenantId.trim(),
    role: tenantContext.role || 'user',
    isSuperAdmin: Boolean(tenantContext.isSuperAdmin || tenantContext.role === 'admin'),
  };
}

/**
 * High-fidelity chunking that preserves byte-exact verbatim raw text.
 */
function chunkBookContentWithVerbatim(text, {
  chapter = 'عام',
  pageStart = 1,
  wordsPerPage = 250,
  targetChars = 1800,
  overlapChars = 270,
} = {}) {
  if (!text || typeof text !== 'string') return [];

  const chunks = [];
  let startIndex = 0;
  let chunkIdx = 0;

  if (text.length <= targetChars) {
    const rawBuffer = Buffer.from(text, 'utf-8');
    return [{
      idx: 0,
      page: pageStart,
      chapter,
      text: text.trim(),
      verbatimRawChunk: text, // Byte-exact preservation without trim
      charStart: 0,
      charEnd: text.length,
      byteStart: 0,
      byteEnd: rawBuffer.byteLength,
    }];
  }

  while (startIndex < text.length) {
    let endIndex = startIndex + targetChars;

    if (endIndex >= text.length) {
      const rawSlice = text.slice(startIndex);
      const cleanSlice = rawSlice.trim();
      if (cleanSlice.length > 0) {
        const estimatedPage = pageStart + Math.floor(startIndex / (wordsPerPage * 6));
        const byteStart = Buffer.byteLength(text.slice(0, startIndex), 'utf-8');
        const byteEnd = Buffer.byteLength(text, 'utf-8');
        chunks.push({
          idx: chunkIdx++,
          page: estimatedPage,
          chapter,
          text: cleanSlice,
          verbatimRawChunk: rawSlice, // Byte-exact preservation
          charStart: startIndex,
          charEnd: text.length,
          byteStart,
          byteEnd,
        });
      }
      break;
    }

    const sub = text.slice(startIndex, endIndex);
    const lastParagraph = sub.lastIndexOf('\n\n');
    const lastSentence = Math.max(
      sub.lastIndexOf('. '),
      sub.lastIndexOf('؟ '),
      sub.lastIndexOf('! '),
      sub.lastIndexOf('.\n')
    );
    const lastSpace = sub.lastIndexOf(' ');

    let splitOffset = targetChars;
    if (lastParagraph > targetChars * 0.5) {
      splitOffset = lastParagraph + 2;
    } else if (lastSentence > targetChars * 0.5) {
      splitOffset = lastSentence + 2;
    } else if (lastSpace > targetChars * 0.3) {
      splitOffset = lastSpace + 1;
    }

    const rawChunkSlice = text.slice(startIndex, startIndex + splitOffset);
    const chunkText = rawChunkSlice.trim();

    if (chunkText.length > 0) {
      const estimatedPage = pageStart + Math.floor(startIndex / (wordsPerPage * 6));
      const byteStart = Buffer.byteLength(text.slice(0, startIndex), 'utf-8');
      const byteEnd = Buffer.byteLength(text.slice(0, startIndex + splitOffset), 'utf-8');
      chunks.push({
        idx: chunkIdx++,
        page: estimatedPage,
        chapter,
        text: chunkText,
        verbatimRawChunk: rawChunkSlice, // Byte-exact preservation
        charStart: startIndex,
        charEnd: startIndex + splitOffset,
        byteStart,
        byteEnd,
      });
    }

    startIndex += Math.max(splitOffset - overlapChars, 1);
  }

  return chunks;
}

class KnowledgeDAL {
  /**
   * Registers a book under the given tenant context.
   * Preserves verbatim_raw_chunk for every chunk.
   */
  registerBook(bookData, tenantContext) {
    const ctx = assertTenantContext(tenantContext);
    const bookId = bookData.id || 'book_' + crypto.randomUUID().slice(0, 10);
    const now = nowIso();
    const isShared = Boolean(bookData.isSharedLibrary || bookData.source === 'library');

    const title = bookData.title;
    const author = bookData.author || 'غير محدد';
    const edition = bookData.edition || 'الطبعة المعتمدة';
    const publicationYear = bookData.publicationYear || 2024;
    const language = bookData.language || 'Arabic';
    const pagesTotal = bookData.pagesTotal || 100;
    const fullText = bookData.fullText || '';
    const toc = bookData.toc || [];
    const chapters = bookData.chapters || [];

    tx(() => {
      // 1. Verify if exists and belongs to another tenant
      const existing = get('SELECT id, tenant_id, is_shared_library FROM documents WHERE id = ?', bookId);
      if (existing) {
        if (!ctx.isSuperAdmin && existing.tenant_id && existing.tenant_id !== ctx.tenantId) {
          throw new AccessDeniedError(`Forbidden: Cannot overwrite book belonging to another tenant (${existing.tenant_id})`, 403);
        }
        run(`
          UPDATE documents SET
            title = ?, language = ?, size_bytes = ?, pages_total = ?, page_count = ?,
            raw_text = ?, tenant_id = ?, is_shared_library = ?
          WHERE id = ?
        `, title, language, fullText.length, pagesTotal, pagesTotal, fullText, ctx.tenantId, isShared ? 1 : 0, bookId);
      } else {
        const userExists = ctx.userId ? get('SELECT id FROM users WHERE id = ?', ctx.userId) : null;
        const validOwnerId = userExists ? ctx.userId : null;
        const sourceVal = isShared ? 'library' : 'tenant_upload';

        run(`
          INSERT INTO documents (
            id, tenant_id, owner_id, title, original_filename, kind, file_type, mime_type,
            size_bytes, language, upload_status, ocr_status, index_status, pages_total, page_count,
            raw_text, uploaded_at, source, attribution, is_shared_library
          ) VALUES (?, ?, ?, ?, ?, 'document', 'book', 'application/x-book', ?, ?, 'stored', 'not_applicable', 'completed', ?, ?, ?, ?, ?, 'verified', ?)
        `,
          bookId, ctx.tenantId, validOwnerId, title, title + '.epub', fullText.length,
          language, pagesTotal, pagesTotal, fullText, now, sourceVal, isShared ? 1 : 0
        );
      }

      // 2. Book structures
      run(`
        INSERT OR REPLACE INTO book_structures (
          id, book_id, tenant_id, toc_json, chapters_json, author, edition, publication_year, language, total_pages, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        'struct_' + bookId, bookId, ctx.tenantId,
        JSON.stringify(toc), JSON.stringify(chapters),
        author, edition, publicationYear, language, pagesTotal, now, now
      );

      // 3. Chunks with verbatim_raw_chunk
      let targetChapters = (chapters && chapters.length > 0) ? chapters : [];
      if (targetChapters.length === 0 && fullText && fullText.trim()) {
        targetChapters = [{
          title: 'الفصل الأول: المحتوى المعتمد',
          pageStart: 1,
          pageEnd: pagesTotal || 1,
          content: fullText.trim(),
        }];
      }
      if (targetChapters.length > 0) {
        run('DELETE FROM chunks WHERE document_id = ?', bookId);
        let globalIdx = 0;
        for (const ch of targetChapters) {
          const chChunks = chunkBookContentWithVerbatim(ch.content, {
            chapter: ch.title,
            pageStart: ch.pageStart || 1,
            targetChars: 1800,
            overlapChars: 270,
          });

          for (const c of chChunks) {
            const chunkId = `chk_${bookId}_${globalIdx}`;
            const embeddingVec = generateEmbedding(c.text);
            const embeddingBlob = vectorToBlob(embeddingVec);
            run(`
              INSERT OR REPLACE INTO chunks (
                id, document_id, idx, page, text, verbatim_raw_chunk,
                byte_start, byte_end, embedding, embedding_blob, embed_model, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local-dense-128', ?)
            `,
              chunkId, bookId, globalIdx++, c.page, c.text, c.verbatimRawChunk,
              c.byteStart || 0, c.byteEnd || 0, embeddingBlob, embeddingBlob, now
            );
          }
        }
      }
    });

    return this.getBookDetails(bookId, ctx);
  }

  /**
   * Retrieves book details with strict tenant isolation check.
   */
  getBookDetails(bookId, tenantContext) {
    const ctx = assertTenantContext(tenantContext);
    const doc = get('SELECT * FROM documents WHERE id = ?', bookId);
    if (!doc) return null;

    // Strict RLS: Allow if owned by tenant OR if explicitly shared library
    const isOwner = doc.tenant_id === ctx.tenantId || (doc.owner_id && doc.owner_id === ctx.userId);
    const isShared = Number(doc.is_shared_library) === 1;

    if (!isOwner && !isShared && !ctx.isSuperAdmin) {
      throw new AccessDeniedError(`Forbidden: Access denied to book ${bookId} owned by another tenant`, 403);
    }

    const struct = get('SELECT * FROM book_structures WHERE book_id = ?', bookId);
    const chunksCount = get('SELECT COUNT(*) as c FROM chunks WHERE document_id = ?', bookId)?.c || 0;

    return {
      id: doc.id,
      tenantId: doc.tenant_id,
      title: doc.title,
      author: struct?.author || 'مؤلف غير محدد',
      edition: struct?.edition || 'الطبعة المعتمدة',
      publicationYear: struct?.publication_year || 2024,
      language: doc.language,
      totalPages: doc.page_count || struct?.total_pages || 1,
      toc: struct?.toc_json ? JSON.parse(struct.toc_json) : [],
      chapters: struct?.chapters_json ? JSON.parse(struct.chapters_json) : [],
      chunksCount,
      isSharedLibrary: Boolean(doc.is_shared_library),
      createdAt: doc.uploaded_at || doc.created_at,
    };
  }

  /**
   * Lists all books accessible to the tenant (owned books + shared library books).
   */
  listBooks(tenantContext) {
    const ctx = assertTenantContext(tenantContext);

    let sql = `
      SELECT d.id, d.title, d.language, d.page_count, d.tenant_id, d.is_shared_library,
             s.author, s.edition, s.publication_year
      FROM documents d
      LEFT JOIN book_structures s ON s.book_id = d.id
      WHERE (d.kind = 'document' OR s.id IS NOT NULL)
    `;
    const params = [];

    if (!ctx.isSuperAdmin) {
      sql += ' AND (d.tenant_id = ? OR (d.owner_id IS NOT NULL AND d.owner_id = ?) OR d.is_shared_library = 1)';
      params.push(ctx.tenantId, ctx.userId);
    }

    sql += ' ORDER BY d.title ASC';
    const rows = all(sql, ...params);

    return rows.map((d) => ({
      id: d.id,
      tenantId: d.tenant_id,
      title: d.title,
      author: d.author || 'مؤلف معتمد',
      edition: d.edition || 'طبعة رسمية',
      publicationYear: d.publication_year || 2024,
      language: d.language || 'Arabic',
      totalPages: d.page_count || 1,
      isSharedLibrary: Boolean(d.is_shared_library),
    }));
  }

  /**
   * Searches knowledge chunks strictly scoped to the tenant's accessible books.
   */
  searchBookKnowledge(query, { bookIds = null, limit = 8, expandContext = true } = {}, tenantContext) {
    const ctx = assertTenantContext(tenantContext);
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return [];

    // Verify requested bookIds
    if (Array.isArray(bookIds) && bookIds.length > 0) {
      for (const bId of bookIds) {
        const doc = get('SELECT id, tenant_id, owner_id, is_shared_library FROM documents WHERE id = ?', bId);
        if (doc) {
          const isOwner = doc.tenant_id === ctx.tenantId || (doc.owner_id && doc.owner_id === ctx.userId);
          const isShared = Number(doc.is_shared_library) === 1;
          if (!isOwner && !isShared && !ctx.isSuperAdmin) {
            throw new AccessDeniedError(`Forbidden: Cannot search book ${bId} belonging to another tenant`, 403);
          }
        }
      }
    }

    const tokens = cleanQuery.toLowerCase().split(/[\s,،.؟!;:()[\]{}"]+/).filter((t) => t.length > 1);

    let sql = `
      SELECT c.id, c.document_id, c.idx, c.page, c.text, c.verbatim_raw_chunk,
             c.byte_start, c.byte_end, c.embedding_blob, c.embedding,
             d.title as book_title, d.tenant_id, d.is_shared_library,
             s.author, s.edition, s.publication_year, s.chapters_json
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      LEFT JOIN book_structures s ON s.book_id = d.id
      WHERE 1=1
    `;
    const params = [];

    // Enforce Tenant RLS boundary
    if (!ctx.isSuperAdmin) {
      sql += ' AND (d.tenant_id = ? OR (d.owner_id IS NOT NULL AND d.owner_id = ?) OR d.is_shared_library = 1)';
      params.push(ctx.tenantId, ctx.userId);
    }

    if (Array.isArray(bookIds) && bookIds.length > 0) {
      const placeholders = bookIds.map(() => '?').join(',');
      sql += ` AND c.document_id IN (${placeholders})`;
      params.push(...bookIds);
    }

    const allChunks = all(sql, ...params);
    if (!allChunks || allChunks.length === 0) return [];

    const queryTokens = tokenizeForBM25(cleanQuery);
    const queryVec = generateEmbedding(cleanQuery);

    const bm25List = [];
    const vectorList = [];
    const chunkMap = new Map();
    const highlightsMap = new Map();

    const avgDocLen = allChunks.reduce((acc, c) => acc + (c.text.length / 5), 0) / Math.max(allChunks.length, 1);

    for (const chunk of allChunks) {
      chunkMap.set(chunk.id, chunk);
      const textLower = chunk.text.toLowerCase();
      const matchHighlights = [];

      // 1. BM25 & exact keyword matching
      const docTokens = tokenizeForBM25(chunk.text);
      let bm25 = computeBM25Score(queryTokens, docTokens, docTokens.length, avgDocLen);

      if (cleanQuery.length > 3 && textLower.includes(cleanQuery.toLowerCase())) {
        bm25 += 15.0;
        matchHighlights.push(cleanQuery);
      }
      for (const t of queryTokens) {
        if (textLower.includes(t)) {
          matchHighlights.push(t);
        }
      }

      if (bm25 > 0) {
        bm25List.push({ id: chunk.id, score: bm25 });
      }

      // 2. Vector Cosine Similarity
      let chunkVec = null;
      if (chunk.embedding_blob && Buffer.isBuffer(chunk.embedding_blob) && chunk.embedding_blob.byteLength >= 512) {
        chunkVec = blobToVector(chunk.embedding_blob);
      } else if (chunk.embedding && Buffer.isBuffer(chunk.embedding) && chunk.embedding.byteLength >= 512) {
        chunkVec = blobToVector(chunk.embedding);
      } else {
        chunkVec = generateEmbedding(chunk.text);
      }

      const cosSim = cosineSimilarity(queryVec, chunkVec);
      const minSim = bm25 > 0 ? 0.15 : 0.35;
      if (cosSim >= minSim) {
        vectorList.push({ id: chunk.id, score: cosSim });
      }

      highlightsMap.set(chunk.id, Array.from(new Set(matchHighlights)));
    }

    bm25List.sort((a, b) => b.score - a.score);
    vectorList.sort((a, b) => b.score - a.score);

    // 3. Reciprocal Rank Fusion
    const fusedResults = reciprocalRankFusion(bm25List, vectorList, 60);

    const scored = [];
    for (const item of fusedResults) {
      const chunk = chunkMap.get(item.id);
      if (!chunk) continue;

      let chapterTitle = 'الفصل العام';
      if (chunk.chapters_json) {
        try {
          const chList = JSON.parse(chunk.chapters_json);
          const foundCh = chList.find((ch) => chunk.page >= ch.pageStart && (!ch.pageEnd || chunk.page <= ch.pageEnd));
          if (foundCh) chapterTitle = foundCh.title;
        } catch (_) {}
      }

      let contextBefore = '';
      let contextAfter = '';
      if (expandContext) {
        const prev = get('SELECT text FROM chunks WHERE document_id = ? AND idx = ?', chunk.document_id, chunk.idx - 1);
        const next = get('SELECT text FROM chunks WHERE document_id = ? AND idx = ?', chunk.document_id, chunk.idx + 1);
        if (prev) contextBefore = prev.text.slice(-200);
        if (next) contextAfter = next.text.slice(0, 200);
      }

      scored.push({
        chunkId: chunk.id,
        bookId: chunk.document_id,
        bookTitle: chunk.book_title,
        tenantId: chunk.tenant_id,
        author: chunk.author || 'غير محدد',
        edition: chunk.edition || 'طبعة معتمدة',
        publicationYear: chunk.publication_year || 2024,
        chapter: chapterTitle,
        pageNumber: chunk.page || 1,
        byteStart: chunk.byte_start || 0,
        byteEnd: chunk.byte_end || (chunk.verbatim_raw_chunk ? Buffer.byteLength(chunk.verbatim_raw_chunk, 'utf-8') : 0),
        text: chunk.text,
        verbatimRawChunk: chunk.verbatim_raw_chunk || chunk.text, // Verbatim guarantee
        contextBefore,
        contextAfter,
        score: item.score,
        rrfScore: item.rrfScore,
        matchType: item.matchType,
        semanticSimilarity: item.vectorScore || 0,
        bm25Score: item.bm25Score || 0,
        matchedTokens: highlightsMap.get(chunk.id) || [],
      });
    }

    return scored.slice(0, limit);
  }

  /**
   * Retrieves a single verbatim raw chunk by ID with tenant verification.
   */
  getVerbatimChunk(chunkId, tenantContext) {
    const ctx = assertTenantContext(tenantContext);
    const row = get(`
      SELECT c.*, d.tenant_id, d.owner_id, d.is_shared_library, d.source
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE c.id = ?
    `, chunkId);

    if (!row) return null;

    const isOwner = row.tenant_id === ctx.tenantId || (row.owner_id && row.owner_id === ctx.userId);
    const isShared = Number(row.is_shared_library) === 1;

    if (!isOwner && !isShared && !ctx.isSuperAdmin) {
      throw new AccessDeniedError(`Forbidden: Access denied to chunk ${chunkId} belonging to another tenant`, 403);
    }

    return {
      chunkId: row.id,
      bookId: row.document_id,
      page: row.page,
      idx: row.idx,
      text: row.text,
      verbatimRawChunk: row.verbatim_raw_chunk || row.text,
    };
  }

  /**
   * Deletes a book and all associated structures/chunks if owned by the tenant.
   */
  deleteBook(bookId, tenantContext) {
    const ctx = assertTenantContext(tenantContext);
    const doc = get('SELECT id, tenant_id, owner_id FROM documents WHERE id = ?', bookId);
    if (!doc) return false;

    if (!ctx.isSuperAdmin && doc.tenant_id !== ctx.tenantId && doc.owner_id !== ctx.userId) {
      throw new AccessDeniedError(`Forbidden: Cannot delete book ${bookId} owned by another tenant`, 403);
    }

    tx(() => {
      run('DELETE FROM chunks WHERE document_id = ?', bookId);
      run('DELETE FROM book_structures WHERE book_id = ?', bookId);
      run('DELETE FROM documents WHERE id = ?', bookId);
    });

    return true;
  }

  /**
   * Seeds isolated bilingual demo library books for demo guest sessions.
   * Bound to 'tenant_demo' with RLS isolation.
   */
  seedDemoLibrary() {
    try {
      const existing = get("SELECT id FROM documents WHERE id = 'book_demo_ibn_khaldun'");
      if (existing) return;

      const demoTenant = { tenantId: 'tenant_demo', userId: 'usr_demo_guest', role: 'user' };

      // 1. Arabic Demo Reference: مقدمة ابن خلدون
      this.registerBook({
        id: 'book_demo_ibn_khaldun',
        title: 'مقدمة ابن خلدون (مقتطفات تجريبية - فصول الاجتماع الإنساني)',
        author: 'عبد الرحمن بن خلدون',
        edition: 'طبعة دار الفكر المحققة',
        publicationYear: 1377,
        language: 'Arabic',
        pagesTotal: 350,
        fullText: 'إن الاجتماع الإنساني ضروري، ويعبر الحكماء عن هذا بقولهم: الإنسان مدني بالطبع، أي لا بد له من الاجتماع الذي هو المدنية في اصطلاحهم وهو معنى العمران. وبيانه أن الله سبحانه خلق الإنسان وركبه على صورة لا يصح حياتها وبقاؤها إلا بالغذاء، وهداه إلى التماسه بفطرته وبما ركب فيه من القدرة على تحصيله. واعلم أن العدوان على الناس في أموالهم يذهب بآمالهم في تحصيلها واكتسابها، لما يرونه حينئذ من أن غايتها ومصيرها انتهابها من أيديهم. وإذا ذهبت آمالهم في اكتسابها وتحصيلها انقبضت أيديهم عن السعي في ذلك.',
        chapters: [
          {
            title: 'المقدمة: في فضل علم التاريخ وتحقيق مذاهبه',
            pageStart: 1,
            pageEnd: 45,
            content: 'إن الاجتماع الإنساني ضروري، ويعبر الحكماء عن هذا بقولهم: الإنسان مدني بالطبع، أي لا بد له من الاجتماع الذي هو المدنية في اصطلاحهم وهو معنى العمران. وبيانه أن الله سبحانه خلق الإنسان وركبه على صورة لا يصح حياتها وبقاؤها إلا بالغذاء، وهداه إلى التماسه بفطرته وبما ركب فيه من القدرة على تحصيله.',
          },
          {
            title: 'الفصل الثالث: في أن الظلم مؤذن بخراب العمران',
            pageStart: 46,
            pageEnd: 120,
            content: 'واعلم أن العدوان على الناس في أموالهم يذهب بآمالهم في تحصيلها واكتسابها، لما يرونه حينئذ من أن غايتها ومصيرها انتهابها من أيديهم. وإذا ذهبت آمالهم في اكتسابها وتحصيلها انقبضت أيديهم عن السعي في ذلك، وعلى قدر الاعتداء ونزع الأموال يكون انقباض الرعايا عن السعي في الاكتساب.',
          }
        ],
        isSharedLibrary: false,
      }, demoTenant);

      // 2. English Demo Reference: The Wealth of Nations
      this.registerBook({
        id: 'book_demo_wealth_of_nations',
        title: 'The Wealth of Nations (Demo Excerpts - Division of Labor)',
        author: 'Adam Smith',
        edition: 'Standard Scholarly Edition',
        publicationYear: 1776,
        language: 'English',
        pagesTotal: 280,
        fullText: 'The greatest improvement in the productive powers of labour, and the greater part of the skill, dexterity, and judgment with which it is anywhere directed, or applied, seem to have been the effects of the division of labour. It is not from the benevolence of the butcher, the brewer, or the baker that we expect our dinner, but from their regard to their own interest. We address ourselves, not to their humanity but to their self-love, and never talk to them of our own necessities but of their advantages.',
        chapters: [
          {
            title: 'Chapter 1: Of the Division of Labour',
            pageStart: 1,
            pageEnd: 30,
            content: 'The greatest improvement in the productive powers of labour, and the greater part of the skill, dexterity, and judgment with which it is anywhere directed, or applied, seem to have been the effects of the division of labour. In every improved society, the farmer is generally nothing but a farmer; the manufacturer, nothing but a manufacturer.',
          },
          {
            title: 'Chapter 2: Of the Principle which gives occasion to the Division of Labour',
            pageStart: 31,
            pageEnd: 75,
            content: 'It is not from the benevolence of the butcher, the brewer, or the baker that we expect our dinner, but from their regard to their own interest. We address ourselves, not to their humanity but to their self-love, and never talk to them of our own necessities but of their advantages.',
          }
        ],
        isSharedLibrary: false,
      }, demoTenant);
    } catch (err) {
      console.warn('[knowledgeDal] seedDemoLibrary notice:', err.message);
    }
  }
}

const knowledgeDal = new KnowledgeDAL();
try {
  knowledgeDal.seedDemoLibrary();
} catch (_) {}

module.exports = {
  knowledgeDal,
  KnowledgeDAL,
  AccessDeniedError,
  assertTenantContext,
  chunkBookContentWithVerbatim,
};
