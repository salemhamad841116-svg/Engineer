// ==============================================================================
// server_backend/services/agent/projectIndex.js
// Phase A — Live Semantic Project Index (the ONLY module with index SQL; DAL rule).
//
// Maintains an up-to-date structural map of the active project (files, symbols,
// imports, handlers, elements) so the agent can locate a feature and trace what
// depends on it BEFORE reading files — selective context instead of blind reads.
//
// Isolation contract: every query is bound to an exact project_id. The index
// never crosses projects, so the agent cannot inherit assumptions from another
// app. Freshness contract: files are re-parsed only when their SHA-256 content
// hash changes (incremental — never a full re-scan per agent turn).
// ==============================================================================
'use strict';

const crypto = require('crypto');
const { parseFile, languageFor } = require('./semanticParser');

const INDEXABLE_MAX_BYTES = 256 * 1024; // mirrors POLICY.limits.maxFileBytes
const RESOLVE_EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.html', '.css'];
const RESOLVE_INDEX_FILES = ['index.js', 'index.ts', 'index.tsx', 'index.html'];

function sha256(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

function normalizeRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Resolves a relative import specifier to an indexed file path (best effort).
 * Returns null for external packages or unresolvable specifiers.
 */
function resolveSpecifier(specifier, fromFile, fileSet) {
  if (!specifier || !specifier.startsWith('.')) return null;
  const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const joined = normalizeRel(`${fromDir}/${specifier}`);
  const parts = [];
  for (const seg of joined.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const base = parts.join('/');
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fileSet.has(base + ext)) return base + ext;
  }
  for (const idx of RESOLVE_INDEX_FILES) {
    if (fileSet.has(`${base}/${idx}`)) return `${base}/${idx}`;
  }
  return null;
}

/**
 * Builds or incrementally updates the semantic index for a project.
 * Source of truth is the in-memory project.files array (same array the agent edits).
 *
 * @param {object} o
 * @param {object} o.db       better-sqlite3 / node:sqlite handle (transaction-capable)
 * @param {object} o.project  { id, files: [{ path|name, content }] }
 * @param {string} o.ownerId  mandatory — RLS ownership of the index rows
 * @returns {object} build report (never throws on unparseable files)
 */
function buildOrUpdateIndex({ db, project, ownerId }) {
  if (!db) throw Object.assign(new Error('INDEX_DB_MISSING'), { code: 'INDEX_UNAVAILABLE' });
  if (!project || !project.id) throw Object.assign(new Error('PROJECT_MISSING'), { code: 'INDEX_PROJECT_MISSING' });
  if (!ownerId) throw Object.assign(new Error('OWNER_MISSING'), { code: 'INDEX_OWNER_MISSING' });

  const projectId = String(project.id);
  const startedAt = Date.now();
  const files = (Array.isArray(project.files) ? project.files : [])
    .map((f) => ({ path: normalizeRel(f.path || f.name), content: String(f.content ?? '') }))
    .filter((f) => f.path && f.content.length <= INDEXABLE_MAX_BYTES);

  const now = new Date().toISOString();
  const existingRows = db
    .prepare('SELECT file_path, content_hash FROM project_index_files WHERE project_id = ?')
    .all(projectId);
  const existing = new Map(existingRows.map((r) => [r.file_path, r.content_hash]));
  const currentPaths = new Set(files.map((f) => f.path));

  const removed = [];
  for (const [path] of existing) {
    if (!currentPaths.has(path)) removed.push(path);
  }
  const changed = files.filter((f) => existing.get(f.path) !== sha256(f.content));

  // Nothing to do — index is already fresh.
  if (removed.length === 0 && changed.length === 0 && existing.size === files.length) {
    const meta = db.prepare('SELECT version, file_count, symbol_count, edge_count, built_at FROM project_index_meta WHERE project_id = ?').get(projectId);
    return {
      status: 'fresh',
      version: meta ? meta.version : 0,
      filesReindexed: 0,
      filesRemoved: 0,
      fileCount: meta ? meta.file_count : files.length,
      symbolCount: meta ? meta.symbol_count : 0,
      edgeCount: meta ? meta.edge_count : 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const fileSet = new Set(files.map((f) => f.path));
  const delFile = db.prepare('DELETE FROM project_index_files WHERE project_id = ? AND file_path = ?');
  const delSymbols = db.prepare('DELETE FROM project_index_symbols WHERE project_id = ? AND file_path = ?');
  const delEdgesFrom = db.prepare('DELETE FROM project_index_edges WHERE project_id = ? AND from_file = ?');
  const insFile = db.prepare(
    'INSERT INTO project_index_files (project_id, file_path, language, content_hash, byte_size, symbol_count, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insSymbol = db.prepare(
    `INSERT INTO project_index_symbols
     (project_id, file_path, name, kind, signature, parent_name, line_start, line_end, byte_start, byte_end, exported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insEdge = db.prepare(
    'INSERT INTO project_index_edges (project_id, from_file, to_file, specifier, edge_type, symbol, line) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const run = db.transaction ? db.transaction.bind(db) : null;
  const apply = () => {
    for (const path of removed) {
      delFile.run(projectId, path);
      delSymbols.run(projectId, path);
      delEdgesFrom.run(projectId, path);
    }
    for (const f of changed) {
      const language = languageFor(f.path);
      const { symbols, edges } = parseFile(f.path, f.content);
      delFile.run(projectId, f.path);
      delSymbols.run(projectId, f.path);
      delEdgesFrom.run(projectId, f.path);
      insFile.run(projectId, f.path, language, sha256(f.content), f.content.length, symbols.length, now);
      for (const s of symbols) {
        insSymbol.run(
          projectId, f.path, s.name, s.kind, s.signature, s.parentName,
          s.lineStart, s.lineEnd, s.byteStart, s.byteEnd, s.exported ? 1 : 0
        );
      }
      for (const e of edges) {
        const toFile = e.type === 'import' || e.type === 'includes'
          ? resolveSpecifier(e.specifier, f.path, fileSet)
          : null;
        insEdge.run(projectId, f.path, toFile, e.specifier || null, e.type, e.symbol || null, e.line || 0);
      }
    }

    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM project_index_files   WHERE project_id = ?) AS files,
           (SELECT COUNT(*) FROM project_index_symbols WHERE project_id = ?) AS symbols,
           (SELECT COUNT(*) FROM project_index_edges   WHERE project_id = ?) AS edges`
      )
      .get(projectId, projectId, projectId);
    db.prepare(
      `INSERT INTO project_index_meta (project_id, owner_id, version, file_count, symbol_count, edge_count, built_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         owner_id = excluded.owner_id,
         version = project_index_meta.version + 1,
         file_count = excluded.file_count,
         symbol_count = excluded.symbol_count,
         edge_count = excluded.edge_count,
         built_at = excluded.built_at`
    ).run(projectId, ownerId, counts.files, counts.symbols, counts.edges, now);
  };

  if (run) run(apply)();
  else apply();

  const meta = db.prepare('SELECT version, file_count, symbol_count, edge_count FROM project_index_meta WHERE project_id = ?').get(projectId);
  return {
    status: 'updated',
    version: meta ? meta.version : 1,
    filesReindexed: changed.length,
    filesRemoved: removed.length,
    fileCount: meta.file_count,
    symbolCount: meta.symbol_count,
    edgeCount: meta.edge_count,
    durationMs: Date.now() - startedAt,
  };
}

function getIndexStatus({ db, projectId }) {
  const meta = db.prepare('SELECT * FROM project_index_meta WHERE project_id = ?').get(String(projectId));
  return meta || null;
}

/**
 * Ranks symbol search hits: exact > prefix > substring; components/functions first.
 */
function rankSymbol(row, query) {
  const q = query.toLowerCase();
  const n = row.name.toLowerCase();
  let score = 0;
  if (n === q) score += 100;
  else if (n.startsWith(q)) score += 60;
  else if (n.includes(q)) score += 30;
  if (row.signature && row.signature.toLowerCase().includes(q)) score += 10;
  if (row.kind === 'component') score += 5;
  if (row.kind === 'function' || row.kind === 'handler') score += 4;
  if (row.exported) score += 2;
  return score;
}

/**
 * Searches symbols by name/signature. Read-only; bound to one project.
 */
function searchSymbols({ db, projectId, query, kind = null, limit = 10 }) {
  const q = String(query || '').trim();
  if (!q) return { query: q, total: 0, results: [] };
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = kind
    ? db.prepare('SELECT * FROM project_index_symbols WHERE project_id = ? AND kind = ? AND (name LIKE ? OR signature LIKE ?) LIMIT 200')
        .all(String(projectId), kind, like, like)
    : db.prepare('SELECT * FROM project_index_symbols WHERE project_id = ? AND (name LIKE ? OR signature LIKE ?) LIMIT 200')
        .all(String(projectId), like, like);
  const ranked = rows
    .map((r) => ({ r, score: rankSymbol(r, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.file_path.localeCompare(b.r.file_path))
    .slice(0, Math.min(limit, 25))
    .map(({ r }) => ({
      name: r.name,
      kind: r.kind,
      path: r.file_path,
      line: r.line_start,
      endLine: r.line_end,
      signature: r.signature,
      parent: r.parent_name,
      exported: !!r.exported,
    }));
  return { query: q, total: ranked.length, results: ranked };
}

/**
 * Exact symbol lookup (used before editing — modify-not-duplicate support).
 */
function getSymbol({ db, projectId, name, filePath = null }) {
  const n = String(name || '').trim();
  if (!n) return { name: n, total: 0, results: [] };
  const rows = filePath
    ? db.prepare('SELECT * FROM project_index_symbols WHERE project_id = ? AND name = ? AND file_path = ?').all(String(projectId), n, normalizeRel(filePath))
    : db.prepare('SELECT * FROM project_index_symbols WHERE project_id = ? AND name = ?').all(String(projectId), n);
  const results = rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    path: r.file_path,
    line: r.line_start,
    endLine: r.line_end,
    byteStart: r.byte_start,
    byteEnd: r.byte_end,
    signature: r.signature,
    parent: r.parent_name,
    exported: !!r.exported,
  }));
  // Callers across the project (symbol-level cross-file tracing)
  const callers = db
    .prepare("SELECT DISTINCT from_file AS path, MIN(line) AS firstLine FROM project_index_edges WHERE project_id = ? AND edge_type = 'calls' AND symbol = ? GROUP BY from_file LIMIT 25")
    .all(String(projectId), n);
  return { name: n, total: results.length, results, referencedFrom: callers };
}

/**
 * Outline of one file: its symbols ordered by line + its outgoing edges.
 */
function getFileOutline({ db, projectId, filePath }) {
  const p = normalizeRel(filePath);
  const file = db.prepare('SELECT * FROM project_index_files WHERE project_id = ? AND file_path = ?').get(String(projectId), p);
  if (!file) return null;
  const symbols = db
    .prepare('SELECT name, kind, signature, parent_name, line_start, line_end, exported FROM project_index_symbols WHERE project_id = ? AND file_path = ? ORDER BY line_start')
    .all(String(projectId), p)
    .map((r) => ({ name: r.name, kind: r.kind, signature: r.signature, parent: r.parent_name, line: r.line_start, endLine: r.line_end, exported: !!r.exported }));
  const deps = db
    .prepare("SELECT to_file, specifier, edge_type, symbol, line FROM project_index_edges WHERE project_id = ? AND from_file = ? AND edge_type IN ('import','includes') ORDER BY line")
    .all(String(projectId), p);
  return {
    path: p,
    language: file.language,
    bytes: file.byte_size,
    symbols,
    dependencies: deps.map((d) => ({ to: d.to_file || d.specifier, type: d.edge_type, symbol: d.symbol, line: d.line, resolved: !!d.to_file })),
  };
}

/**
 * Reverse tracing: which files depend on the given file (imports), and which
 * files call its exported symbols (cross-layer tracing support).
 */
function listDependents({ db, projectId, filePath }) {
  const p = normalizeRel(filePath);
  const importers = db
    .prepare("SELECT from_file AS path, edge_type, symbol, line FROM project_index_edges WHERE project_id = ? AND to_file = ? ORDER BY from_file, line")
    .all(String(projectId), p);
  const exportedSymbols = db
    .prepare('SELECT name FROM project_index_symbols WHERE project_id = ? AND file_path = ? AND exported = 1')
    .all(String(projectId), p)
    .map((r) => r.name);
  const symbolCallers = [];
  for (const name of exportedSymbols.slice(0, 50)) {
    const rows = db
      .prepare("SELECT DISTINCT from_file AS path FROM project_index_edges WHERE project_id = ? AND edge_type = 'calls' AND symbol = ? AND from_file != ? LIMIT 25")
      .all(String(projectId), name, p);
    for (const row of rows) symbolCallers.push({ path: row.path, viaSymbol: name });
  }
  return {
    path: p,
    importers: importers.map((r) => ({ path: r.path, type: r.edge_type, symbol: r.symbol, line: r.line })),
    symbolCallers,
    totalDependents: new Set([...importers.map((r) => r.from_file), ...symbolCallers.map((r) => r.path)]).size,
  };
}

/**
 * Answers read-only questions like "Where is the Publish button?" from the
 * index alone (element ids, data-testids, handler names, component names).
 * NEVER modifies anything — this is a query, not permission to edit.
 */
function locateFeature({ db, projectId, query, limit = 10 }) {
  const tokens = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  const stop = new Set(['where', 'is', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'how', 'does', 'do', 'what', 'which', 'button', 'feature', 'page']);
  const meaningful = tokens.filter((t) => !stop.has(t));
  const needles = meaningful.length ? meaningful : tokens;
  if (!needles.length) return { query, total: 0, results: [] };

  const rows = db.prepare('SELECT * FROM project_index_symbols WHERE project_id = ? LIMIT 5000').all(String(projectId));
  const scored = [];
  for (const r of rows) {
    const hay = `${r.name} ${r.signature || ''} ${r.file_path}`.toLowerCase();
    let score = 0;
    for (const t of needles) {
      if (r.name.toLowerCase() === t) score += 50;
      else if (r.name.toLowerCase().includes(t)) score += 15;
      else if (hay.includes(t)) score += 5;
    }
    if (score > 0) {
      if (r.kind === 'element' || r.kind === 'component' || r.kind === 'handler') score += 6;
      scored.push({ r, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.r.file_path.localeCompare(b.r.file_path));
  return {
    query: String(query || ''),
    total: Math.min(scored.length, limit),
    results: scored.slice(0, limit).map(({ r }) => ({
      name: r.name,
      kind: r.kind,
      path: r.file_path,
      line: r.line_start,
      signature: r.signature,
    })),
  };
}

/** Deletes every index row of a project (called on project deletion). */
function dropProjectIndex({ db, projectId }) {
  const p = String(projectId);
  db.prepare('DELETE FROM project_index_symbols WHERE project_id = ?').run(p);
  db.prepare('DELETE FROM project_index_edges WHERE project_id = ?').run(p);
  db.prepare('DELETE FROM project_index_files WHERE project_id = ?').run(p);
  db.prepare('DELETE FROM project_index_meta WHERE project_id = ?').run(p);
}

module.exports = {
  buildOrUpdateIndex,
  getIndexStatus,
  searchSymbols,
  getSymbol,
  getFileOutline,
  listDependents,
  locateFeature,
  dropProjectIndex,
  resolveSpecifier,
};
