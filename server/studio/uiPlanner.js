/**
 * UI Builder Mode — Layer 2: UI Planner & Code Synthesis.
 *
 * Turns the Smart Router JSON contract + domain blueprint + design tokens
 * + realistic seed data into a strict synthesis prompt, and validates the
 * produced HTML against the output contract:
 *   - one self-contained HTML file (no external CDNs — offline preview)
 *   - 100% English code; user-facing strings isolated in the CONTENT object
 *   - data-ui-id on every major component (enables click-to-edit)
 *   - asset placeholders as <figure data-asset-slot="..."> markers
 *   - complete UI states: skeleton loading, empty state, modal/drawer
 *
 * Tiered synthesis: contract.model_tier decides local ($0, qwen2.5:7b via
 * workspaceModelRouter) vs cloud_flash (Gemini). UI_LLM_MOCK=1 swaps in a
 * deterministic template synthesizer (tests only, same IMAGE_PROVIDER_MOCK
 * culture).
 */

import { mockStrings } from './i18n/uiLexicon.js';

export const OUTPUT_CONTRACT_VERSION = 'ui-contract/1';

const COMMON_RULES = [
  'Output ONE self-contained HTML5 document and nothing else (no markdown fences).',
  'All code, identifiers, class names and comments MUST be English only.',
  'Every user-facing string lives in a single `const CONTENT = {...}` object at the top of <script>; HTML binds to it.',
  'Every major component carries a unique data-ui-id attribute (header, hero, grid, drawer, modal, table, chart).',
  'For each asset slot, emit exactly: <figure data-asset-slot="SLOT_ID" style="aspect-ratio:W/H"></figure> — the platform injects the real media.',
  'Include complete UI states: skeleton loading block, an empty-state view, one modal or drawer, and working tabs/filters.',
  'Style ONLY through the provided CSS variables (var(--ui-*)). No external fonts, CDNs, or network calls.',
  'Charts are drawn with inline SVG or canvas using the provided seed data — no chart libraries.',
  'Interactive screens must be navigable client-side (hash routes or data-screen toggles) inside this one file.',
];

/**
 * @param {object} arg
 * @param {object} arg.contract Smart Router output (intent/ui_params/asset_tasks)
 * @param {object} arg.blueprint row from DOMAIN_BLUEPRINTS
 * @param {object} arg.tokens design tokens
 * @param {string} arg.tokensCss rendered CSS variables block
 * @param {object} arg.seedData realistic domain seed (already localized)
 * @param {'ar'|'en'} arg.lang
 */
export function buildSynthesisPrompt({ contract, blueprint, tokens, tokensCss, seedData, lang }) {
  const ui = contract?.ui_params || {};
  const lines = [
    'You are a senior front-end engineer generating a production-grade single-file UI.',
    `Domain blueprint: ${blueprint.id} — components to implement (each with data-ui-id):`,
    ...blueprint.components.map((c) => `- ${c.id}: ${c.label}`),
    `Theme mode: ${tokens.theme}. Layout direction: ${ui.direction || (lang === 'en' ? 'ltr' : 'rtl')}. Content language: ${lang}.`,
  ];
  if (ui.protected_brand_text) {
    lines.push(`Render this brand text EXACTLY as written, never translate or restyle it: "${ui.protected_brand_text}".`);
  }
  lines.push(
    'CSS variables (already injected — use them, do not redefine):',
    tokensCss,
    'Realistic seed data (use it verbatim; NEVER use lorem ipsum or random filler):',
    JSON.stringify(seedData, null, 1),
    ...COMMON_RULES,
  );
  return lines.join('\n');
}

/** Wireframe/screenshot-to-code vision prompt (Gemini multimodal). */
export function buildVisionPrompt({ lang }) {
  return [
    'Analyze this UI screenshot/wireframe and return STRICT JSON only:',
    '{"layout":["header","sidebar","grid",...],"components":[{"type":"...","purpose":"..."}],"theme":"dark|light","notes":"..."}',
    `Describe purposes in ${lang === 'en' ? 'English' : 'the request language'}; JSON keys stay English.`,
  ].join('\n');
}

/* ------------------------------ validation ----------------------------- */

export function htmlHasLorem(html) {
  return /lorem|ipsum|dolor sit amet|placeholder text/i.test(String(html || ''));
}

export function htmlHasUiIds(html) {
  return /data-ui-id="[a-z0-9_-]+"/i.test(String(html || ''));
}

export function htmlHasContentIsolation(html) {
  return /const\s+CONTENT\s*=\s*\{/.test(String(html || ''));
}

export function htmlSlotIds(html) {
  const out = [];
  const re = /data-asset-slot="([a-z0-9_]+)"/gi;
  let m;
  while ((m = re.exec(String(html || '')))) out.push(m[1]);
  return out;
}

/**
 * Deterministic template synthesizer for tests/dev (UI_LLM_MOCK=1).
 * Produces a REAL, contract-compliant HTML file from blueprint + tokens +
 * seed data — not a stub: it renders components, states, and slot markers.
 */
export function mockSynthesize({ contract, blueprint, tokens, tokensCss, seedData, lang }) {
  const ui = contract?.ui_params || {};
  const dir = ui.direction || (lang === 'en' ? 'ltr' : 'rtl');
  const brand = ui.protected_brand_text || seedData.storeName || seedData.portfolioName || 'App';
  const S = mockStrings(lang);
  const slots = htmlSlotMarkers(blueprint);
  // Content isolation contract: ALL localized strings live in CONTENT;
  // markup binds to it at runtime (keeps the English-codebase gate green).
  const cardsData = (seedData.products || seedData.tickers || seedData.rows || [])
    .map((p) => ({ name: p.name || p.symbol, meta: p.category || p.price || p.total || '' }));
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}" data-theme="${tokens.theme}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title id="pageTitle"></title>
<style>${tokensCss}
*{box-sizing:border-box;margin:0}
body{font-family:var(--ui-font);background:var(--ui-bg);color:var(--ui-text);max-width:100%;overflow-x:hidden}
header[data-ui-id="app_header"]{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background:var(--ui-surface);border-bottom:1px solid var(--ui-border)}
.btn{background:var(--ui-primary);color:var(--ui-on-primary);border:0;border-radius:var(--ui-radius-control);padding:10px 18px;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:24px}
.card{background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:var(--ui-radius-card);padding:16px;box-shadow:var(--ui-shadow)}
.skeleton{padding:24px;color:var(--ui-muted)}
.empty{padding:48px;text-align:center;color:var(--ui-muted)}
figure[data-asset-slot]{background:var(--ui-surface);border:1px dashed var(--ui-border);border-radius:var(--ui-radius-card);width:100%;margin:0}
.modal{position:fixed;inset:0;display:none;place-items:center;background:rgba(0,0,0,.45)}
.modal.open{display:grid}
.modal>div{background:var(--ui-surface);border-radius:var(--ui-radius-card);padding:24px;max-width:420px}
</style>
</head>
<body>
<header data-ui-id="app_header"><strong id="brandSlot"></strong><button class="btn" id="ctaBtn"></button></header>
${slots}
<main data-ui-id="content_grid" class="grid" id="cardsRoot"></main>
<section data-ui-id="skeleton_state" class="skeleton" hidden></section>
<section data-ui-id="empty_state" class="empty" hidden></section>
<div data-ui-id="app_modal" class="modal" id="modal"><div><p id="modalBody"></p><button class="btn" id="modalClose">OK</button></div></div>
<script>
const CONTENT = ${JSON.stringify({ brand, cta: S.open, modal: S.details, empty: S.empty, loading: S.loading, cards: cardsData })};
document.getElementById('pageTitle').textContent = CONTENT.brand;
document.getElementById('brandSlot').textContent = CONTENT.brand;
const cardsRoot = document.getElementById('cardsRoot');
CONTENT.cards.forEach(function(c, i){
  const el = document.createElement('article');
  el.className = 'card';
  el.setAttribute('data-ui-id', 'card_' + (i + 1));
  const h = document.createElement('h3'); h.textContent = c.name;
  const p = document.createElement('p'); p.textContent = c.meta;
  el.appendChild(h); el.appendChild(p);
  cardsRoot.appendChild(el);
});
document.getElementById('ctaBtn').textContent = CONTENT.cta;
document.getElementById('modalBody').textContent = CONTENT.modal;
document.querySelector('[data-ui-id="empty_state"]').textContent = CONTENT.empty;
document.querySelector('[data-ui-id="skeleton_state"]').textContent = CONTENT.loading;
document.getElementById('ctaBtn').addEventListener('click', () => document.getElementById('modal').classList.add('open'));
document.getElementById('modalClose').addEventListener('click', () => document.getElementById('modal').classList.remove('open'));
</script>
</body>
</html>`;
}

function htmlSlotMarkers(blueprint) {
  return blueprint.assetSlots
    .filter((s) => s.role === 'photo')
    .map((s) => {
      const [w, h] = s.aspectRatio.split(':');
      return `<figure data-asset-slot="${s.slot}" style="aspect-ratio:${w}/${h}"></figure>`;
    })
    .join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Strip accidental markdown fences from LLM output. */
export function extractHtml(text) {
  const t = String(text || '').trim();
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf('<!DOCTYPE');
  const altStart = body.indexOf('<html');
  const i = start >= 0 ? start : altStart;
  return i >= 0 ? body.slice(i).trim() : body;
}
