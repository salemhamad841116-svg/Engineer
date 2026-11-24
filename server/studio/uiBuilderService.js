/**
 * UI Builder Mode — Orchestrator (Layers 1-6, Phase-3 scope).
 *
 * Pipeline per build:
 *   plan      → domain blueprint + design tokens + seed data ($0)
 *   synthesize→ tiered LLM (local qwen | cloud_flash) → single-file HTML
 *   assets    → budget-capped manifest → parallel Image-Mode generation
 *               → WebP injection (0% gray boxes, graceful per-slot fallback)
 *   audit     → static gates + real headless Chromium + WCAG (honest states)
 *   heal      → at most ONE auto-heal round on console errors
 *   ready     → version row + file; SSE stage events throughout
 *
 * Layer 5 (server half): deterministic property patches and image swaps
 * via node-html-parser ($0, <100ms, zero LLM), plus surgical component
 * regeneration that rewrites ONLY the targeted data-ui-id subtree and
 * byte-proves the rest of the document is untouched.
 *
 * No SQL outside this file (DAL rule for the ui_builder domain).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'node-html-parser';
import { StudioError } from './studioErrors.js';
import { getBlueprint, detectDomain } from './domainBlueprints.js';
import { buildTokens, tokensToCss } from './designTokens.js';
import { seedFor } from './i18n/uiLexicon.js';
import {
  buildSynthesisPrompt, buildVisionPrompt, mockSynthesize, extractHtml,
} from './uiPlanner.js';
import { buildAssetManifest, generateSlotAssets, injectAssets } from './uiSlots.js';
import { staticGates, headlessAudit, wcagGate, summarizeGates } from './uiQualityGates.js';
import { emitStage } from './pipelineEvents.js';
import { getBrandLock } from './presetStore.js';
import { getAsset, resolveAssetWebpPath, resolveAssetPath } from './studioService.js';
import { defaultRouterLlm } from './routerLlm.js';

const UI_ROOT = () =>
  path.join(process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media'), 'studio', 'ui');

const MAX_HEAL_ROUNDS = 1; // spec: Auto-Heal exactly once, never a loop
const now = () => new Date().toISOString();

/* --------------------------------- DAL --------------------------------- */

function insertBuild(db, row) {
  db.prepare(`
    INSERT INTO studio_ui_builds
      (id, owner_id, project_id, session_id, routing_id, domain, model_tier, provider,
       status, version, parent_id, html_path, tokens_json, manifest_json, audit_json,
       heal_used, lang, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.id, row.owner_id, row.project_id, row.session_id, row.routing_id, row.domain,
    row.model_tier, row.provider, row.status, row.version, row.parent_id, row.html_path,
    row.tokens_json, row.manifest_json, row.audit_json, row.heal_used, row.lang, now(), now(),
  );
}

function updateBuild(db, ownerId, id, fields) {
  const allowed = ['status', 'html_path', 'audit_json', 'heal_used', 'version', 'parent_id', 'provider'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (!sets.length) return;
  sets.push('updated_at = ?'); vals.push(now(), id, ownerId);
  db.prepare(`UPDATE studio_ui_builds SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`).run(...vals);
}

export function getBuild(db, ownerId, id) {
  const row = db.prepare('SELECT * FROM studio_ui_builds WHERE id = ?').get(id);
  if (!row) throw new StudioError(404, 'UI_BUILD_NOT_FOUND', 'UI build not found.');
  if (row.owner_id !== ownerId) throw new StudioError(404, 'UI_BUILD_NOT_FOUND', 'UI build not found.');
  return row;
}

export function listBuilds(db, ownerId, { projectId = null, limit = 50 } = {}) {
  if (projectId) {
    return db.prepare('SELECT * FROM studio_ui_builds WHERE owner_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(ownerId, projectId, Math.min(200, limit));
  }
  return db.prepare('SELECT * FROM studio_ui_builds WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(ownerId, Math.min(200, limit));
}

/* ------------------------------ file storage ---------------------------- */

function buildDir(ownerId, buildId) {
  const dir = path.join(UI_ROOT(), ownerId, buildId);
  fs.mkdirSync(dir, { recursive: true });
  const root = path.resolve(UI_ROOT());
  if (!path.resolve(dir).startsWith(root)) throw new StudioError(403, 'UI_PATH_FORBIDDEN', 'Path escapes UI root.');
  return dir;
}

export function resolveBuildHtmlPath(db, ownerId, id) {
  const row = getBuild(db, ownerId, id);
  const abs = path.resolve(row.html_path);
  if (!abs.startsWith(path.resolve(UI_ROOT()))) throw new StudioError(403, 'UI_PATH_FORBIDDEN', 'Path escapes UI root.');
  if (!fs.existsSync(abs)) throw new StudioError(404, 'UI_HTML_MISSING', 'Build HTML missing on disk.');
  return abs;
}

/* ------------------------------ LLM wiring ------------------------------ */

function llmForTier(llm, tier) {
  return tier === 'cloud_flash' ? llm.cloud : llm.local;
}

async function synthesize({ prompt, tier, llm, mockCtx }) {
  if (process.env.UI_LLM_MOCK === '1') {
    return { html: mockSynthesize(mockCtx), provider: 'mock' };
  }
  const fn = llmForTier(llm, tier);
  const text = await fn({ system: 'You output one self-contained HTML5 file only.', user: prompt });
  return { html: extractHtml(text), provider: tier === 'cloud_flash' ? 'cloud_flash' : 'local' };
}

/* --------------------------- audit-file rewrite ------------------------- */

/**
 * The served HTML references assets by platform URL (/api/studio/...).
 * For the on-disk headless audit we rewrite those to absolute file paths
 * so Chromium can validate them without a running server.
 */
function auditCopy(htmlPath, db, ownerId) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(/src="\/api\/studio\/assets\/([^"?]+)\/file(?:\?format=webp)?"/g, (m, assetId) => {
    try {
      const resolved = m.includes('format=webp')
        ? resolveAssetWebpPath(db, ownerId, assetId)
        : resolveAssetPath(db, ownerId, assetId);
      return `src="${resolved.abs}"`;
    } catch (_) {
      return m; // unresolved stays — naturalWidth gate will catch it honestly
    }
  });
  const auditPath = htmlPath.replace(/\.html$/, '.audit.html');
  fs.writeFileSync(auditPath, html);
  return auditPath;
}

/* ------------------------------ the build ------------------------------- */

/**
 * @param {object} arg
 * @param {object} arg.contract Smart Router output (ui_generate/ui_edit/hybrid)
 * @param {string} arg.message normalized user message (domain detection aid)
 * @param {object} [arg.llm] injectable {local, cloud} (tests)
 */
export async function buildUi(db, {
  ownerId, projectId = null, sessionId = null, routingId = null,
  contract, message = '', lang = 'ar', llm = null, genImpl = null, auditImpl = headlessAudit,
}) {
  const llms = llm || defaultRouterLlm();
  const buildId = crypto.randomUUID();
  const stage = (s, data = {}) => emitStage(buildId, s, data);

  /* ---- plan ($0) ---- */
  stage('plan', { step: 'domain+tokens' });
  const domain = detectDomain({ uiDomain: contract?.ui_params?.domain, normalized: message });
  const blueprint = getBlueprint(domain);
  let brandLock = null;
  try { brandLock = getBrandLock(db, ownerId, projectId); } catch (_) { brandLock = null; }
  const themeReq = contract?.ui_params?.theme;
  const tokens = buildTokens({
    theme: ['dark', 'light', 'glass'].includes(themeReq) ? themeReq : blueprint.defaultTheme,
    brandLock, lang,
  });
  const tokensCss = tokensToCss(tokens);
  const seedData = seedFor(domain, lang);

  /* ---- synthesize (tiered) ---- */
  const tier = contract?.model_tier === 'cloud_flash' ? 'cloud_flash' : 'local';
  stage('synthesize', { tier });
  const prompt = buildSynthesisPrompt({ contract, blueprint, tokens, tokensCss, seedData, lang });
  const mockCtx = { contract, blueprint, tokens, tokensCss, seedData, lang };
  let { html, provider } = await synthesize({ prompt, tier, llm: llms, mockCtx });

  /* ---- static gates (fail fast, $0) ---- */
  let statics = staticGates(html);
  if (!statics.lorem_ok || !statics.ui_ids_ok) {
    const row = baseRow({ buildId, ownerId, projectId, sessionId, routingId, domain, tier, provider, lang, tokens, manifest: [], status: 'FAILED' });
    row.audit_json = JSON.stringify({ statics, reason: 'contract_violation' });
    insertBuild(db, row);
    stage('failed', { reasons: ['static_contract'] });
    throw new StudioError(422, 'UI_CONTRACT_VIOLATION', 'Generated HTML failed the output contract gates.');
  }

  /* ---- assets (Layer 3) ---- */
  stage('assets', { step: 'manifest' });
  const manifest = buildAssetManifest(blueprint);
  const { results } = await generateSlotAssets(db, {
    ownerId, projectId, manifest, contract, tokens, lang,
    genImpl: genImpl || undefined,
  });
  const assetUrl = (a) => `/api/studio/assets/${a.id}/file${a.webp_path ? '?format=webp' : ''}`;
  const injected = injectAssets(html, { manifest, results, tokens, assetUrl });
  html = injected.html;

  /* ---- persist v1 + audit ---- */
  const dir = buildDir(ownerId, buildId);
  const htmlPath = path.join(dir, 'v1.html');
  fs.writeFileSync(htmlPath, html);

  stage('audit', { step: 'static+headless+wcag' });
  let audit = await auditImpl(auditCopy(htmlPath, db, ownerId));
  let wcag = wcagGate(tokens);
  let summary = summarizeGates({ statics, audit, wcag });

  /* ---- auto-heal: exactly one round, only on console errors ---- */
  let healUsed = 0;
  let finalAssets = { injected: injected.injected, fallbacks: injected.fallbacks, brokenMarkers: injected.brokenMarkers };
  if (summary.reasons.includes('console_errors') && audit.ran) {
    healUsed = 1;
    stage('heal', { errors: audit.consoleErrors.slice(0, 3) });
    const healPrompt = [
      'Fix the following runtime errors in this single-file HTML. Return the FULL corrected file only.',
      'Errors:', ...audit.consoleErrors.slice(0, 5),
      'File:', html,
    ].join('\n');
    const healed = await synthesize({ prompt: healPrompt, tier, llm: llms, mockCtx });
    // The healed file restarts from slot markers — assets MUST be
    // re-injected or the heal would silently strip every image.
    const reinject = injectAssets(healed.html, { manifest, results, tokens, assetUrl });
    html = reinject.html;
    finalAssets = { injected: reinject.injected, fallbacks: reinject.fallbacks, brokenMarkers: reinject.brokenMarkers };
    fs.writeFileSync(htmlPath, html);
    audit = await auditImpl(auditCopy(htmlPath, db, ownerId));
    statics = staticGates(html);
    summary = summarizeGates({ statics, audit, wcag });
  }

  const status = !summary.pass && summary.reasons.some((r) => ['console_errors', 'broken_images'].includes(r))
    ? 'FAILED'
    : summary.pass ? (summary.verified ? 'READY' : 'UNVERIFIED') : (summary.verified ? 'QUALITY_GATE_FAILED' : 'UNVERIFIED');

  const row = baseRow({ buildId, ownerId, projectId, sessionId, routingId, domain, tier, provider, lang, tokens, manifest, status });
  row.heal_used = healUsed;
  row.audit_json = JSON.stringify({
    statics, audit, wcag, summary,
    assets: finalAssets,
  });
  insertBuild(db, row);

  stage(status === 'READY' ? 'ready' : status === 'FAILED' ? 'failed' : 'unverified', {
    status, heal_used: healUsed, fallbacks: injected.fallbacks,
  });
  return { ...row, gates: JSON.parse(row.audit_json) };
}

function baseRow({ buildId, ownerId, projectId, sessionId, routingId, domain, tier, provider, lang, tokens, manifest, status }) {
  return {
    id: buildId, owner_id: ownerId, project_id: projectId, session_id: sessionId,
    routing_id: routingId, domain, model_tier: tier, provider, status,
    version: 1, parent_id: null,
    html_path: path.join(UI_ROOT(), ownerId, buildId, 'v1.html'),
    tokens_json: JSON.stringify(tokens), manifest_json: JSON.stringify(manifest),
    audit_json: '{}', heal_used: 0, lang,
  };
}

/* ------------------- Layer 5: deterministic patches ($0) ---------------- */

const PROP_WHITELIST = new Set(['color', 'background-color', 'padding', 'margin', 'font-size', 'text']);
const VALUE_FORBIDDEN = /[<>]|javascript:|expression\(/i;

/**
 * Direct Property Panel server half: text/color/padding/margin/font-size.
 * Deterministic DOM edit + version bump. Zero LLM, zero quota.
 * @returns {{ms:number, version:number}}
 */
export function applyPropPatch(db, { ownerId, buildId, dataUiId, prop, value }) {
  if (!PROP_WHITELIST.has(prop)) throw new StudioError(400, 'UI_PROP_NOT_ALLOWED', `prop must be one of: ${[...PROP_WHITELIST].join(', ')}`);
  if (VALUE_FORBIDDEN.test(String(value))) throw new StudioError(400, 'UI_VALUE_UNSAFE', 'Value failed sanitization.');
  const started = performance.now();
  const row = getBuild(db, ownerId, buildId);
  const htmlPath = resolveBuildHtmlPath(db, ownerId, buildId);
  const doc = parse(fs.readFileSync(htmlPath, 'utf8'));
  const node = doc.querySelector(`[data-ui-id="${dataUiId}"]`);
  if (!node) throw new StudioError(404, 'UI_NODE_NOT_FOUND', `No component with data-ui-id="${dataUiId}".`);
  if (prop === 'text') node.textContent = String(value);
  else node.setAttribute('style', `${node.getAttribute('style') || ''};${prop}:${value}`);
  const nextVersion = row.version + 1;
  const nextPath = path.join(path.dirname(htmlPath), `v${nextVersion}.html`);
  fs.writeFileSync(nextPath, doc.toString());
  updateBuild(db, ownerId, buildId, { version: nextVersion, parent_id: row.parent_id || row.id, html_path: nextPath });
  return { ms: Math.round(performance.now() - started), version: nextVersion };
}

/** Deterministic image swap from the project vault (Quick Asset Modal). */
export function applyImageSwap(db, { ownerId, buildId, dataUiAsset, assetId }) {
  const row = getBuild(db, ownerId, buildId); // target resource first (tenant)
  const asset = getAsset(db, ownerId, assetId); // then the vault asset (tenant)
  const htmlPath = resolveBuildHtmlPath(db, ownerId, buildId);
  const doc = parse(fs.readFileSync(htmlPath, 'utf8'));
  const node = doc.querySelector(`[data-ui-asset="${dataUiAsset}"]`);
  if (!node) throw new StudioError(404, 'UI_ASSET_SLOT_NOT_FOUND', `No image for slot "${dataUiAsset}".`);
  node.setAttribute('src', `/api/studio/assets/${asset.id}/file${asset.webp_path ? '?format=webp' : ''}`);
  const nextVersion = row.version + 1;
  const nextPath = path.join(path.dirname(htmlPath), `v${nextVersion}.html`);
  fs.writeFileSync(nextPath, doc.toString());
  updateBuild(db, ownerId, buildId, { version: nextVersion, parent_id: row.parent_id || row.id, html_path: nextPath });
  return { version: nextVersion, asset_id: asset.id };
}

/**
 * Surgical Component Regeneration: the LLM rewrites ONLY the targeted
 * data-ui-id subtree; everything else in the document must stay
 * byte-identical (proved by prefix/suffix comparison).
 */
export async function applySurgicalPatch(db, {
  ownerId, buildId, dataUiId, instruction, llm = null, tier = 'local',
}) {
  if (!instruction || String(instruction).trim().length < 3) {
    throw new StudioError(400, 'UI_INSTRUCTION_INVALID', 'Instruction is required (>= 3 chars).');
  }
  const llms = llm || defaultRouterLlm();
  const row = getBuild(db, ownerId, buildId);
  const htmlPath = resolveBuildHtmlPath(db, ownerId, buildId);
  const source = fs.readFileSync(htmlPath, 'utf8');
  const doc = parse(source);
  const node = doc.querySelector(`[data-ui-id="${dataUiId}"]`);
  if (!node) throw new StudioError(404, 'UI_NODE_NOT_FOUND', `No component with data-ui-id="${dataUiId}".`);

  const original = node.toString();
  let replacement;
  if (process.env.UI_LLM_MOCK === '1') {
    node.setAttribute('data-patched', '1');
    node.innerHTML = `${node.innerHTML}<span class="patched-note"></span>`;
    replacement = node.toString();
  } else {
    const fn = llmForTier(llms, tier);
    const text = await fn({
      system: 'Rewrite ONLY the given HTML subtree per the instruction. Output HTML only, keep the same data-ui-id. English code.',
      user: `Instruction: ${instruction}\nSubtree:\n${original}`,
    });
    replacement = extractHtml(text);
  }
  if (!replacement.includes(`data-ui-id="${dataUiId}"`)) {
    throw new StudioError(422, 'UI_PATCH_LOST_ID', 'Patch dropped the component data-ui-id; rejected.');
  }
  const idx = source.indexOf(original);
  if (idx < 0) throw new StudioError(500, 'UI_PATCH_ANCHOR_LOST', 'Could not re-anchor the subtree.');
  const next = source.slice(0, idx) + replacement + source.slice(idx + original.length);

  // Byte-proof: everything outside the subtree is untouched.
  const prefixSame = next.slice(0, idx) === source.slice(0, idx);
  const suffixSame = next.endsWith(source.slice(idx + original.length));
  if (!prefixSame || !suffixSame) throw new StudioError(500, 'UI_PATCH_LEAK', 'Patch leaked outside the target subtree; rejected.');

  const nextVersion = row.version + 1;
  const nextPath = path.join(path.dirname(htmlPath), `v${nextVersion}.html`);
  fs.writeFileSync(nextPath, next);
  updateBuild(db, ownerId, buildId, { version: nextVersion, parent_id: row.parent_id || row.id, html_path: nextPath });
  return { version: nextVersion, tier };
}

/* ------------------- Layer 2: screenshot / wireframe → code -------------- */

/**
 * Analyze an uploaded UI screenshot via Gemini vision. Honest BLOCKED
 * without a key; UI_LLM_MOCK=1 returns a fixed layout for tests.
 */
export async function analyzeUiImage({ b64, mime, lang = 'ar', fetchImpl = fetch }) {
  if (process.env.UI_LLM_MOCK === '1') {
    return { layout: ['header', 'hero', 'grid', 'modal'], components: [{ type: 'hero', purpose: 'banner' }], theme: 'light', notes: 'mock-vision' };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new StudioError(503, 'UI_VISION_BLOCKED', 'Screenshot-to-code needs GEMINI_API_KEY on the server.');
  const model = process.env.ROUTER_CLOUD_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: buildVisionPrompt({ lang }) }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) throw new StudioError(502, 'UI_VISION_FAILED', `vision provider HTTP ${res.status}`);
  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new StudioError(422, 'UI_VISION_BAD_JSON', 'Vision analysis was not valid JSON.');
  }
}
