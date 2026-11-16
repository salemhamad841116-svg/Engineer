// src/utils/previewCompiler.ts
// Safe single-document preview compiler shared by the live preview (browser) and the
// server-side build verifier. All insertions use FUNCTION replacers / index splicing so
// that `$'`, `$&`, `` $` `` and `$1` sequences inside user code are never interpreted as
// String.prototype.replace substitution patterns (root cause of the blank-chart bug:
// `'$' + riskAmount` was rewritten into `'\n</html> + riskAmount`, a SyntaxError that
// killed the whole inline application script).

export const PREVIEW_HEALTH_MESSAGE = 'ENGINEER_PREVIEW_HEALTH';
export const PREVIEW_HEALTH_REQUEST = 'ENGINEER_PREVIEW_HEALTH_REQUEST';

export interface InlineAssetsInput {
  html: string;
  css?: string[];
  js?: string[];
  /** Local asset file names (e.g. "styles.css", "app.js") whose <link>/<script src> refs must be removed. */
  localAssetNames?: string[];
  lang?: string;
  dir?: string;
  title?: string;
  /** Extra <script> blocks appended before </body> (already wrapped in <script> tags). */
  bodyScripts?: string[];
  /** Inject the runtime health probe (window errors + canvas pixel audit). */
  includeHealthProbe?: boolean;
  /** Initial localStorage contents for the sandboxed (opaque-origin) preview. */
  storageSeed?: Record<string, string>;
}

export interface InlineScriptSyntaxIssue {
  index: number;
  message: string;
  excerpt: string;
}

/** Prevents a literal "</script" inside JS from terminating the inline block. */
export function escapeInlineScript(js: string): string {
  return String(js || '').replace(/<\/script/gi, '<\\/script');
}

/** Prevents a literal "</style" inside CSS from terminating the inline block. */
export function escapeInlineStyle(css: string): string {
  return String(css || '').replace(/<\/style/gi, '<\\/style');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inserts `block` immediately before the LAST occurrence of `closingTag` (case-insensitive). */
export function insertBeforeClosingTag(doc: string, closingTag: string, block: string): string {
  const idx = doc.toLowerCase().lastIndexOf(closingTag.toLowerCase());
  if (idx === -1) return `${doc}\n${block}`;
  return `${doc.slice(0, idx)}${block}\n${doc.slice(idx)}`;
}

/** Inserts `block` right after the opening <head ...> tag (or creates a head). */
export function insertAfterHeadOpen(doc: string, block: string): string {
  const m = /<head\b[^>]*>/i.exec(doc);
  if (m) {
    const end = m.index + m[0].length;
    return `${doc.slice(0, end)}\n${block}${doc.slice(end)}`;
  }
  const htmlOpen = /<html\b[^>]*>/i.exec(doc);
  if (htmlOpen) {
    const end = htmlOpen.index + htmlOpen[0].length;
    return `${doc.slice(0, end)}\n<head>\n${block}\n</head>${doc.slice(end)}`;
  }
  return `${block}\n${doc}`;
}

/** Removes <link href="styles.css"> / <script src="app.js"></script> refs to files that are inlined. */
export function stripLocalAssetRefs(doc: string, names: string[]): string {
  let out = doc;
  for (const raw of names) {
    const name = String(raw || '').replace(/^\.?\//, '');
    if (!name) continue;
    const n = escapeRegExp(name);
    out = out.replace(new RegExp(`<script\\b[^>]*\\bsrc=["'](?:\\.?\\/)?${n}["'][^>]*>\\s*<\\/script>`, 'gi'), () => '');
    out = out.replace(new RegExp(`<link\\b[^>]*\\bhref=["'](?:\\.?\\/)?${n}["'][^>]*\\/?>`, 'gi'), () => '');
  }
  return out;
}

/**
 * Runtime health probe injected FIRST in <head>, so it observes errors thrown by the
 * application scripts. After load it audits every <canvas> (size + painted pixels +
 * distinct colours) and posts ENGINEER_PREVIEW_HEALTH to the parent workspace.
 */
export const PREVIEW_HEALTH_PROBE_SCRIPT = `<script id="engineer-preview-health">
(function () {
  var errors = [];
  window.addEventListener('error', function (e) {
    var msg = (e && e.message) ? String(e.message) : 'Script error';
    if (e && e.lineno) msg += ' (line ' + e.lineno + ')';
    errors.push(msg.slice(0, 300));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    errors.push(('Unhandled promise rejection: ' + String((r && r.message) || r)).slice(0, 300));
  });
  function auditCanvas(c) {
    var info = { id: c.id || null, width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight, painted: 0, colors: 0 };
    try {
      var ctx = c.getContext('2d');
      if (!ctx || !c.width || !c.height) return info;
      var data = ctx.getImageData(0, 0, c.width, c.height).data;
      var seen = {};
      var stride = Math.max(1, Math.floor((c.width * c.height) / 40000)) * 4;
      for (var i = 3; i < data.length; i += stride) {
        if (data[i] > 0) {
          info.painted++;
          if (info.colors < 16) {
            var key = (data[i - 3] >> 4) + ',' + (data[i - 2] >> 4) + ',' + (data[i - 1] >> 4);
            if (!seen[key]) { seen[key] = 1; info.colors++; }
          }
        }
      }
    } catch (err) { info.error = String(err && err.message || err); }
    return info;
  }
  function snapshot() {
    var canvases = Array.prototype.map.call(document.querySelectorAll('canvas'), auditCanvas);
    var blank = canvases.filter(function (c) { return c.cssWidth > 0 && c.cssHeight > 0 && (c.painted === 0 || c.colors < 2); });
    var hidden = canvases.filter(function (c) { return c.cssWidth === 0 || c.cssHeight === 0; });
    return { errors: errors.slice(0, 8), canvases: canvases, blankCanvases: blank.length, hiddenCanvases: hidden.length, ok: errors.length === 0 && blank.length === 0 && hidden.length === 0 };
  }
  function report(phase) {
    var s = snapshot();
    s.type = '${PREVIEW_HEALTH_MESSAGE}';
    s.phase = phase;
    try { window.parent && window.parent !== window && window.parent.postMessage(s, '*'); } catch (_) {}
  }
  window.__engineerPreviewHealth = snapshot;
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === '${PREVIEW_HEALTH_REQUEST}') report('request');
  });
  window.addEventListener('load', function () {
    setTimeout(function () { report('load'); }, 700);
    setTimeout(function () { report('settled'); }, 2000);
  });
})();
</script>`;

export const PREVIEW_STORAGE_MESSAGE = 'ENGINEER_PREVIEW_STORAGE';

/**
 * The live preview iframe runs WITHOUT `allow-same-origin` (generated code must never get
 * the platform origin, cookies or API access). Opaque-origin documents throw on
 * `localStorage`/`sessionStorage`, so this shim installs an in-memory Storage seeded from the
 * parent workspace and mirrors writes back via postMessage (persisted per project by the parent).
 */
export function buildPreviewStorageShim(seed: Record<string, string> = {}): string {
  const safeSeed = JSON.stringify(seed || {}).replace(/</g, '\\u003c');
  return `<script id="engineer-preview-storage">
(function () {
  function makeStore(initial, kind) {
    var data = Object.create(null);
    Object.keys(initial || {}).forEach(function (k) { data[k] = String(initial[k]); });
    function sync() {
      if (kind !== 'local') return;
      try { window.parent && window.parent !== window && window.parent.postMessage({ type: '${PREVIEW_STORAGE_MESSAGE}', data: data }, '*'); } catch (_) {}
    }
    return {
      get length() { return Object.keys(data).length; },
      key: function (i) { var k = Object.keys(data); return i >= 0 && i < k.length ? k[i] : null; },
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); sync(); },
      removeItem: function (k) { delete data[String(k)]; sync(); },
      clear: function () { data = Object.create(null); sync(); }
    };
  }
  var needsShim = false;
  try { var t = window.localStorage; t.setItem('__engineer_probe__', '1'); t.removeItem('__engineer_probe__'); } catch (_) { needsShim = true; }
  if (!needsShim) return;
  var local = makeStore(${safeSeed}, 'local');
  var session = makeStore({}, 'session');
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return local; } }); } catch (_) {}
  try { Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return session; } }); } catch (_) {}
})();
</script>`;
}

/** Builds the full preview document with inlined CSS/JS (no replace-pattern hazards). */
export function inlineAssetsIntoHtml(input: InlineAssetsInput): string {
  let doc = String(input.html || '');
  const css = (input.css || []).filter((c) => c && c.trim()).join('\n');
  const js = (input.js || []).filter((j) => j && j.trim()).join('\n');

  if (!/<!DOCTYPE html>/i.test(doc) && !/<html/i.test(doc)) {
    doc = `<!DOCTYPE html>\n<html lang="${input.lang || 'ar'}" dir="${input.dir || 'rtl'}">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${input.title || 'App'}</title>\n</head>\n<body>\n${doc}\n</body>\n</html>`;
  }

  if (!/\bdir=/i.test(doc)) {
    doc = doc.replace(/<html/i, () => `<html dir="${input.dir || 'rtl'}"`);
  }

  if (input.localAssetNames && input.localAssetNames.length) {
    doc = stripLocalAssetRefs(doc, input.localAssetNames);
  }

  if (input.includeHealthProbe) {
    doc = insertAfterHeadOpen(doc, PREVIEW_HEALTH_PROBE_SCRIPT);
  }

  // Storage shim must run before any application script (inserted first in <head>).
  doc = insertAfterHeadOpen(doc, buildPreviewStorageShim(input.storageSeed));

  if (css && !doc.includes(css.slice(0, 30))) {
    const styleBlock = `<style>\n${escapeInlineStyle(css)}\n</style>`;
    doc = /<\/head>/i.test(doc) ? insertBeforeClosingTag(doc, '</head>', styleBlock) : `${styleBlock}\n${doc}`;
  }

  if (js && !doc.includes(js.slice(0, 30))) {
    const scriptBlock = `<script>\n${escapeInlineScript(js)}\n</script>`;
    doc = /<\/body>/i.test(doc) ? insertBeforeClosingTag(doc, '</body>', scriptBlock) : `${doc}\n${scriptBlock}`;
  }

  for (const extra of input.bodyScripts || []) {
    doc = /<\/body>/i.test(doc) ? insertBeforeClosingTag(doc, '</body>', extra) : `${doc}\n${extra}`;
  }

  return doc;
}

/** Extracts the source of every classic inline <script> (skips src=, modules and JSON blocks). */
export function extractInlineScripts(doc: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    if (type && !/^(text\/javascript|application\/javascript)$/i.test(type[1])) continue;
    out.push(m[2] || '');
  }
  return out;
}

/**
 * Parses (without executing) every inline script of a compiled preview document.
 * Uses the Function constructor, which compiles the body and throws SyntaxError on
 * invalid code — available both in Node and in the browser.
 */
export function checkInlineScriptSyntax(doc: string): { ok: boolean; scripts: number; issues: InlineScriptSyntaxIssue[] } {
  const scripts = extractInlineScripts(doc);
  const issues: InlineScriptSyntaxIssue[] = [];
  scripts.forEach((src, index) => {
    if (!src.trim()) return;
    try {
      new Function(src);
    } catch (e: unknown) {
      issues.push({
        index,
        message: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        excerpt: src.trim().slice(0, 120),
      });
    }
  });
  return { ok: issues.length === 0, scripts: scripts.length, issues };
}
