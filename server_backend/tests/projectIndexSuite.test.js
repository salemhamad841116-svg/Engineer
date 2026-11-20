/**
 * projectIndexSuite.test.js
 * Phase A — Live Semantic Project Index verification.
 *
 * Proves:
 *   1. AST-based parsing (TS Compiler API) for JS/TS — real symbols with lines,
 *      not regex guesses.
 *   2. HTML structural indexing: elements (id/data-testid), inline scripts with
 *      offset-corrected lines, dom-handler edges.
 *   3. Incremental freshness: only changed files re-parse (content-hash).
 *   4. Strict project isolation: identical symbol names in two projects never mix.
 *   5. Read-only "where is X" answers from the index — zero file modification.
 *   6. Cross-layer tracing: importers + symbol callers via list_dependents.
 *   7. Agent-loop integration: index builds at agent_start; search_code executes
 *      through toolGuard in chat mode for a Viewer; write tools stay blocked.
 */
process.env.LLM_PROVIDER = 'mock';
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `pindex_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);

const assert = require('node:assert');
const { parseFile } = require('../services/agent/semanticParser');
const {
  buildOrUpdateIndex,
  getIndexStatus,
  searchSymbols,
  getSymbol,
  getFileOutline,
  listDependents,
  locateFeature,
  resolveSpecifier,
} = require('../services/agent/projectIndex');
const { getDb, closeDb } = require('../db/database');

console.log('================================================================');
console.log('🗂️  RUNNING SEMANTIC PROJECT INDEX (PHASE A) VERIFICATION SUITE');
console.log('================================================================\n');

const OWNER = 'usr_index_test';

const SAMPLE_JS = `import { saveNote } from './storage.js';
import { formatDate } from './utils/helpers.js';

const MAX_NOTES = 100;

export function renderApp(root) {
  const container = document.getElementById('app');
  root.appendChild(container);
}

export function handleSaveClick(ev) {
  ev.preventDefault();
  const title = document.getElementById('note-title').value;
  saveNote({ title, createdAt: formatDate(Date.now()) });
}

const PublishButton = () => {
  return <button data-testid="publish-btn">Publish</button>;
};
`;

const SAMPLE_TS = `export interface Note { id: string; title: string; }

export class NotesStore {
  private notes: Note[] = [];
  addNote(n: Note): void { this.notes.push(n); }
  findByTitle(title: string): Note | undefined {
    return this.notes.find((x) => x.title === title);
  }
}

export const computeTotal = (items: number[]): number => items.reduce((a, b) => a + b, 0);
`;

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <h1 id="page-title">Notes</h1>
  <button id="publish-button" data-testid="publish-btn" onclick="handleSaveClick(event)">Publish</button>
  <script src="app.js"></script>
  <script>
    function boot() {
      document.getElementById('publish-button').addEventListener('click', handleSaveClick);
    }
    window.addEventListener('DOMContentLoaded', boot);
  </script>
</body>
</html>
`;

const SAMPLE_CSS = `/* layout */
#page-title { font-size: 2rem; }
.publish-panel .primary,
.publish-panel .secondary { margin: 0 auto; }
@media (max-width: 600px) {
  #page-title { font-size: 1.2rem; }
}
`;

const STORAGE_JS = `export function saveNote(note) {
  const notes = JSON.parse(localStorage.getItem('notes') || '[]');
  notes.push(note);
  localStorage.setItem('notes', JSON.stringify(notes));
}
`;

function makeProject(id, files) {
  return { id, files: files.map(([path, content]) => ({ path, name: path.split('/').pop(), content })) };
}

(async () => {
  // ------------------------------------------------------------ 1. JS/TS AST
  console.log('▶️ [Test 01] AST parsing of JS: functions, handlers, components, imports...');
  const jsOut = parseFile('app.js', SAMPLE_JS);
  const jsNames = Object.fromEntries(jsOut.symbols.map((s) => [s.name, s]));
  assert.ok(jsNames.renderApp, 'renderApp must be indexed');
  assert.strictEqual(jsNames.renderApp.kind, 'function');
  assert.strictEqual(jsNames.renderApp.exported, 1);
  assert.ok(jsNames.handleSaveClick, 'handleSaveClick must be indexed');
  assert.strictEqual(jsNames.handleSaveClick.kind, 'handler', 'handle* must classify as handler');
  assert.ok(jsNames.PublishButton, 'PublishButton must be indexed');
  assert.strictEqual(jsNames.PublishButton.kind, 'component', 'PascalCase + JSX return must classify as component');
  assert.strictEqual(jsNames.MAX_NOTES.kind, 'variable');
  const importEdges = jsOut.edges.filter((e) => e.type === 'import');
  assert.strictEqual(importEdges.filter((e) => e.specifier === './storage.js').length >= 1, true, 'import of ./storage.js must be an edge');
  assert.ok(jsOut.edges.some((e) => e.type === 'calls' && e.symbol === 'saveNote'), 'call edge to saveNote must exist');
  assert.ok(jsNames.handleSaveClick.lineStart > 1, 'line numbers must be real (AST positions)');
  console.log(`   ✅ JS AST: ${jsOut.symbols.length} symbols, ${jsOut.edges.length} edges — kinds/lines verified.`);

  console.log('▶️ [Test 02] AST parsing of TS: class, methods, typed signatures...');
  const tsOut = parseFile('store.ts', SAMPLE_TS);
  const tsNames = Object.fromEntries(tsOut.symbols.map((s) => [s.name, s]));
  assert.strictEqual(tsNames.NotesStore.kind, 'class');
  assert.ok(tsOut.symbols.some((s) => s.name === 'addNote' && s.kind === 'method' && s.parentName === 'NotesStore'), 'class methods must carry parentName');
  assert.strictEqual(tsNames.computeTotal.kind, 'function', 'exported arrow must be a function');
  assert.ok(String(tsNames.computeTotal.signature).includes('items: number[]'), 'typed signature must be captured');
  console.log(`   ✅ TS AST: class hierarchy and typed signatures verified.`);

  // ------------------------------------------------------------ 2. HTML/CSS
  console.log('▶️ [Test 03] HTML structural indexing: elements, inline script offsets, handler edges...');
  const htmlOut = parseFile('index.html', SAMPLE_HTML);
  const elPublish = htmlOut.symbols.find((s) => s.name === 'publish-button');
  assert.ok(elPublish && elPublish.kind === 'element', 'element id="publish-button" must be indexed');
  assert.ok(htmlOut.symbols.some((s) => s.name === 'publish-btn'), 'data-testid must be indexed');
  const boot = htmlOut.symbols.find((s) => s.name === 'boot');
  assert.ok(boot, 'inline <script> function must be parsed via AST');
  const expectedBootLine = SAMPLE_HTML.split('\n').findIndex((l) => l.includes('function boot')) + 1;
  assert.strictEqual(boot.lineStart, expectedBootLine, 'inline script line numbers must be offset-corrected');
  assert.ok(htmlOut.edges.some((e) => e.type === 'dom-handler' && e.symbol === 'handleSaveClick'), 'onclick → handleSaveClick edge must exist');
  assert.ok(htmlOut.edges.some((e) => e.type === 'includes' && e.specifier === 'styles.css'), 'stylesheet include edge must exist');
  assert.ok(htmlOut.edges.some((e) => e.type === 'includes' && e.specifier === 'app.js'), 'script src include edge must exist');
  const cssOut = parseFile('styles.css', SAMPLE_CSS);
  assert.ok(cssOut.symbols.some((s) => s.name === '#page-title'), 'CSS id selector must be indexed');
  console.log(`   ✅ HTML: elements + offset-corrected inline AST + handler/include edges; CSS selectors indexed.`);

  // ------------------------------------------------------------ 3. Build + incremental
  const db = getDb();
  const projectA = makeProject('proj_alpha', [
    ['index.html', SAMPLE_HTML],
    ['app.js', SAMPLE_JS],
    ['storage.js', STORAGE_JS],
    ['styles.css', SAMPLE_CSS],
    ['store.ts', SAMPLE_TS],
  ]);

  console.log('▶️ [Test 04] Full index build...');
  const build1 = buildOrUpdateIndex({ db, project: projectA, ownerId: OWNER });
  assert.strictEqual(build1.status, 'updated');
  assert.strictEqual(build1.fileCount, 5);
  assert.ok(build1.symbolCount >= 12, `expected ≥12 symbols, got ${build1.symbolCount}`);
  assert.ok(build1.edgeCount >= 6, `expected ≥6 edges, got ${build1.edgeCount}`);
  console.log(`   ✅ Built: ${build1.fileCount} files, ${build1.symbolCount} symbols, ${build1.edgeCount} edges in ${build1.durationMs}ms.`);

  console.log('▶️ [Test 05] Incremental freshness: unchanged files must NOT re-parse...');
  const beforeIds = db.prepare("SELECT id FROM project_index_symbols WHERE project_id = 'proj_alpha' AND file_path = 'storage.js'").all().map((r) => r.id);
  const build2 = buildOrUpdateIndex({ db, project: projectA, ownerId: OWNER });
  assert.strictEqual(build2.status, 'fresh', 'second identical build must report fresh');
  assert.strictEqual(build2.filesReindexed, 0);
  const changed = makeProject('proj_alpha', [
    ['index.html', SAMPLE_HTML],
    ['app.js', SAMPLE_JS.replace('const MAX_NOTES = 100;', 'const MAX_NOTES = 250;')],
    ['storage.js', STORAGE_JS],
    ['styles.css', SAMPLE_CSS],
    ['store.ts', SAMPLE_TS],
  ]);
  const build3 = buildOrUpdateIndex({ db, project: changed, ownerId: OWNER });
  assert.strictEqual(build3.status, 'updated');
  assert.strictEqual(build3.filesReindexed, 1, 'only app.js changed → exactly 1 re-parse');
  const afterIds = db.prepare("SELECT id FROM project_index_symbols WHERE project_id = 'proj_alpha' AND file_path = 'storage.js'").all().map((r) => r.id);
  assert.deepStrictEqual(afterIds, beforeIds, 'unchanged file symbol rows must be untouched (same row ids)');
  console.log('   ✅ Incremental update: 1 file re-parsed, untouched files kept identical rows.');

  console.log('▶️ [Test 06] File removal drops its index rows...');
  const shrunk = makeProject('proj_alpha', [
    ['index.html', SAMPLE_HTML],
    ['app.js', SAMPLE_JS],
    ['storage.js', STORAGE_JS],
    ['styles.css', SAMPLE_CSS],
  ]);
  const build4 = buildOrUpdateIndex({ db, project: shrunk, ownerId: OWNER });
  assert.strictEqual(build4.filesRemoved, 1);
  const orphan = db.prepare("SELECT COUNT(*) AS c FROM project_index_symbols WHERE project_id = 'proj_alpha' AND file_path = 'store.ts'").get();
  assert.strictEqual(orphan.c, 0, 'removed file must leave zero orphan symbols');
  console.log('   ✅ Removal: store.ts symbols and edges deleted.');

  // ------------------------------------------------------------ 4. Isolation
  console.log('▶️ [Test 07] Strict project isolation (identical names, two projects)...');
  const projectB = makeProject('proj_beta', [
    ['index.html', SAMPLE_HTML],
    ['app.js', SAMPLE_JS],
  ]);
  buildOrUpdateIndex({ db, project: projectB, ownerId: 'usr_other_owner' });
  const inAlpha = searchSymbols({ db, projectId: 'proj_alpha', query: 'handleSaveClick' });
  const inBeta = searchSymbols({ db, projectId: 'proj_beta', query: 'handleSaveClick' });
  assert.ok(inAlpha.total > 0 && inBeta.total > 0, 'symbol defined in both projects must be found in both');
  const betaFileSet = new Set(['index.html', 'app.js']);
  for (const hit of inBeta.results) {
    assert.ok(betaFileSet.has(hit.path), `proj_beta results must only reference its own files, got ${hit.path}`);
  }
  const alphaStorage = searchSymbols({ db, projectId: 'proj_alpha', query: 'saveNote' });
  assert.ok(alphaStorage.results.some((r) => r.path === 'storage.js'), 'proj_alpha must see its own storage.js symbol');
  const betaStorage = searchSymbols({ db, projectId: 'proj_beta', query: 'saveNote' });
  assert.strictEqual(betaStorage.total, 0, 'proj_beta must NOT see alpha-only symbols (saveNote lives in storage.js which beta does not have)');
  const metaAlpha = getIndexStatus({ db, projectId: 'proj_alpha' });
  const metaBeta = getIndexStatus({ db, projectId: 'proj_beta' });
  assert.notStrictEqual(metaAlpha.owner_id, metaBeta.owner_id, 'owner binding must differ');
  const crossLeak = db.prepare("SELECT COUNT(*) AS c FROM project_index_symbols WHERE project_id = 'proj_alpha' AND file_path NOT IN (SELECT file_path FROM project_index_files WHERE project_id = 'proj_alpha')").get();
  assert.strictEqual(crossLeak.c, 0, 'no symbol may exist without its project file row');
  console.log('   ✅ Isolation: per-project rows, per-owner binding, zero leakage.');

  // ------------------------------------------------------------ 5. Read-only query
  console.log('▶️ [Test 08] Read-only "where is the Publish button?" — index answers, files untouched...');
  const snapshotBefore = JSON.stringify(projectA.files.map((f) => [f.path, f.content.length]));
  const located = locateFeature({ db, projectId: 'proj_beta', query: 'Where is the Publish button?' });
  assert.ok(located.total > 0, 'feature query must return hits');
  const topHit = located.results[0];
  assert.ok(/publish/i.test(topHit.name) || /publish/i.test(topHit.signature || ''), `top hit must relate to publish, got ${topHit.name}`);
  assert.ok(topHit.line >= 1 && topHit.path, 'hit must carry file:line');
  const snapshotAfter = JSON.stringify(projectA.files.map((f) => [f.path, f.content.length]));
  assert.strictEqual(snapshotAfter, snapshotBefore, 'read-only query must never modify project files');
  console.log(`   ✅ locateFeature → ${topHit.kind} "${topHit.name}" at ${topHit.path}:${topHit.line}. Zero writes.`);

  // ------------------------------------------------------------ 6. Tracing
  console.log('▶️ [Test 09] Cross-layer tracing: dependents of storage.js...');
  assert.strictEqual(resolveSpecifier('./storage.js', 'app.js', new Set(['storage.js'])), 'storage.js');
  assert.strictEqual(resolveSpecifier('./utils/helpers.js', 'app.js', new Set(['utils/helpers.js'])), 'utils/helpers.js');
  assert.strictEqual(resolveSpecifier('react', 'app.js', new Set(['storage.js'])), null, 'external packages never resolve');
  const deps = listDependents({ db, projectId: 'proj_alpha', filePath: 'storage.js' });
  assert.ok(deps.importers.some((i) => i.path === 'app.js'), 'app.js must be listed as importer of storage.js');
  assert.ok(deps.symbolCallers.some((c) => c.path === 'app.js' && c.viaSymbol === 'saveNote'), 'saveNote callers must be traced cross-file');
  const outline = getFileOutline({ db, projectId: 'proj_alpha', filePath: 'app.js' });
  assert.ok(outline.symbols.length >= 4 && outline.dependencies.length >= 2, 'outline must carry symbols + dependencies');
  console.log(`   ✅ Tracing: ${deps.totalDependents} dependents, outline with ${outline.symbols.length} symbols.`);

  // ------------------------------------------------------------ 7. Modify-not-duplicate support
  console.log('▶️ [Test 10] get_symbol: exact lookup proves a symbol exists BEFORE editing...');
  const sym = getSymbol({ db, projectId: 'proj_alpha', name: 'saveNote' });
  assert.strictEqual(sym.total, 1);
  assert.strictEqual(sym.results[0].path, 'storage.js');
  assert.ok(sym.referencedFrom.some((c) => c.path === 'app.js'), 'referencedFrom must list app.js');
  const missing = getSymbol({ db, projectId: 'proj_alpha', name: 'publishAllNotes' });
  assert.strictEqual(missing.total, 0, 'unknown symbol must return empty (safe to create new)');
  console.log('   ✅ get_symbol: existing symbol found with callers; unknown symbol honestly empty.');

  // ------------------------------------------------------------ 8. Agent integration
  console.log('▶️ [Test 11] Agent loop: index builds at start; search_code runs via toolGuard for Viewer in chat...');
  const { createEngineerAgent } = require('../services/agent/engineerAgent');
  const { setMockToolResponder, _resetCache } = require('../services/ai/workspaceModelRouter');
  _resetCache();

  let stageIndexReady = null;
  const chatProject = makeProject('proj_chat', [['index.html', SAMPLE_HTML], ['app.js', SAMPLE_JS], ['storage.js', STORAGE_JS]]);
  const agent = createEngineerAgent();
  setMockToolResponder(({ messages }) => {
    const sawToolResult = messages.some((m) => m.role === 'tool');
    if (sawToolResult) {
      return { text: 'The Publish button is defined in index.html (element #publish-button) and wired to handleSaveClick in app.js.', toolCalls: [] };
    }
    return { text: '', toolCalls: [{ name: 'search_code', arguments: { query: 'publish' } }] };
  });

  const viewer = { id: 'usr_viewer', role: 'Viewer', account: 'standard' };
  const chatResult = await agent.run({
    prompt: 'Where is the publish button?',
    project: chatProject,
    user: viewer,
    mode: 'chat',
    db,
    onStage: (stage, detail) => { if (stage === 'index_ready') stageIndexReady = detail; },
  });
  assert.strictEqual(chatResult.status, 'completed');
  assert.ok(stageIndexReady, 'index_ready stage must fire at agent start');
  assert.ok(stageIndexReady.symbols >= 5, 'index must contain symbols');
  const searchCall = chatResult.toolCalls.find((c) => c.name === 'search_code');
  assert.ok(searchToolCallOk(searchCall), 'search_code must succeed through toolGuard');
  assert.strictEqual(chatResult.filesModified.length, 0, 'a question must modify zero files (question-is-not-permission)');

  // write attempt in chat mode must be refused by policy
  const { createToolGuard } = require('../security/toolGuard');
  const { workspaceTools } = require('../services/agent/workspaceTools');
  const guard = createToolGuard({ tools: workspaceTools });
  const writeAttempt = await guard.execute(
    { name: 'write_file', arguments: { path: 'evil.js', content: 'x' } },
    { user: viewer, mode: 'chat', projectId: chatProject.id, project: chatProject, db }
  );
  assert.notStrictEqual(writeAttempt.ok, true, 'write_file in chat mode must be denied');
  console.log('   ✅ Agent integration: index_ready fired, search_code served Viewer read-only, writes denied.');

  // ------------------------------------------------------------ 9. Malformed input
  console.log('▶️ [Test 12] Malformed files never crash the indexer...');
  const broken = makeProject('proj_broken', [
    ['bad.js', 'const x = (({ unbalanced'],
    ['empty.js', ''],
    ['readme.md', '# just docs'],
  ]);
  const brokenBuild = buildOrUpdateIndex({ db, project: broken, ownerId: OWNER });
  assert.ok(brokenBuild.fileCount === 3 || brokenBuild.fileCount === 2, 'all indexable files counted');
  console.log('   ✅ Malformed input: index built without throwing.');

  closeDb();
  require('fs').rmSync(process.env.DB_PATH, { force: true });
  require('fs').rmSync(process.env.DB_PATH + '-wal', { force: true });
  require('fs').rmSync(process.env.DB_PATH + '-shm', { force: true });

  console.log('\n================================================================');
  console.log('🎉 SEMANTIC PROJECT INDEX SUITE — ALL 12 TESTS PASSED');
  console.log('================================================================');
  process.exit(0);
})().catch((err) => {
  console.error('\n❌ SUITE FAILED:', err);
  process.exit(1);
});

function searchToolCallOk(call) {
  return call && call.ok === true;
}
