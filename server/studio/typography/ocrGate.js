/**
 * ocrGate.js — Layer 7 (complete): Multi-Engine Bilingual OCR Verification
 * Gate, plus Layer 8 core (diagnostic-driven retry + Max-1-Retry Budget
 * Circuit-Breaker) and Layer 10 core (clean-plate caching).
 *
 * Scoring: normalized Levenshtein similarity (CER-style) per layer, with an
 * exact-case mode for English brand casing. Pass threshold >= 0.95 (annex).
 * Flow per layer: pass -> 'passed'; fail with retry budget -> exactly ONE
 * diagnostic-driven paid retry ('retry_scheduled'); fail again -> mandatory
 * free deterministic recovery ('fallback_recovered', score 1.0 by
 * construction) with clean_plate_url persisted. No third paid attempt.
 *
 * The OCR engine is INJECTED ({ scan({imageRef, langs}) -> {text} }); the
 * default adapter wraps local Tesseract and honestly reports when a
 * language pack is missing — results are never fabricated.
 */

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeForComparison, detectScript } from './textAnalysis.js';
import { OCR_PASS_THRESHOLD, MAX_PAID_RETRIES } from './typographySchema.js';
import { StudioError } from '../studioErrors.js';

const execFileAsync = promisify(execFile);
const now = () => new Date().toISOString();

/* ------------------------------ scoring ------------------------------ */

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Bilingual CER-style similarity: 1 - dist/maxLen after comparison
 * normalization (exact-case preserved when the brand demands it). */
export function textSimilarity(expected, detected, { exactCase = false } = {}) {
  const e = normalizeForComparison(expected, { exactCase });
  const d = normalizeForComparison(detected, { exactCase });
  if (!e && !d) return 1;
  if (!e || !d) return 0;
  const dist = levenshtein(e, d);
  return Math.max(0, 1 - dist / Math.max(e.length, d.length));
}

/**
 * Best-window similarity (Layer 7): an OCR scan returns the WHOLE image text
 * while each layer owns only its share. Score a layer against the best
 * matching window of the detected text (window length = expected length),
 * so multi-layer bilingual banners are judged per layer, not against the
 * full dump. Falls back to plain similarity when the scan is short.
 */
export function bestMatchSimilarity(expected, detected, { exactCase = false } = {}) {
  const e = normalizeForComparison(expected, { exactCase });
  const d = normalizeForComparison(detected, { exactCase });
  if (!e && !d) return 1;
  if (!e || !d) return 0;
  if (d.length <= e.length * 1.5) {
    const dist = levenshtein(e, d);
    return Math.max(0, 1 - dist / Math.max(e.length, d.length));
  }
  let best = 0;
  const span = e.length;
  for (let i = 0; i + span <= d.length; i++) {
    const dist = levenshtein(e, d.slice(i, i + span));
    const score = 1 - dist / span;
    if (score > best) best = score;
    if (best >= 1) break;
  }
  return Math.max(0, best);
}

/** Hallucinated AR/EN Gibberish Detector: substantial alpha tokens in the
 * OCR output that no expected text accounts for. */
export function detectGibberish(ocrText, expectedTexts) {
  const haystack = normalizeForComparison(expectedTexts.join(' '));
  const tokens = normalizeForComparison(ocrText).split(' ').filter((t) => t.length >= 3 && /[\p{L}]/u.test(t));
  return tokens.filter((t) => !haystack.includes(t));
}

/* --------------------------- default adapter -------------------------- */

/** Honest local Tesseract adapter: reports missing language packs instead
 * of guessing (BLOCKED-style honesty — never fabricated scores). */
export function defaultOcrAdapter() {
  return {
    async scan({ imageRef, langs = ['eng'] }) {
      if (!imageRef) throw new StudioError(400, 'OCR_IMAGE_REQUIRED', 'image reference required');
      let available = '';
      try {
        const { stdout } = await execFileAsync('tesseract', ['--list-langs'], { timeout: 10_000 });
        available = stdout;
      } catch {
        throw new StudioError(503, 'OCR_ENGINE_UNAVAILABLE', 'Local OCR engine unavailable.');
      }
      const missing = langs.filter((l) => !available.includes(l));
      if (missing.length) {
        throw new StudioError(503, 'OCR_LANGUAGE_PACK_MISSING',
          `Local OCR language pack missing: ${missing.join(', ')}`);
      }
      const { stdout } = await execFileAsync(
        'tesseract', [imageRef, 'stdout', '-l', langs.join('+')], { timeout: 30_000 },
      );
      return { text: stdout || '', engine: 'tesseract' };
    },
  };
}

/* ---------------------------- persistence ---------------------------- */

function upsertLayer(db, row) {
  const existing = db.prepare(
    'SELECT id FROM image_text_layers WHERE asset_id = ? AND layer_role = ?',
  ).get(row.asset_id, row.layer_role);
  if (existing) {
    db.prepare(`UPDATE image_text_layers SET
        literal_text=?, script_mode=?, direction=?, render_strategy=?, primary_font_id=?, paired_font_id=?,
        material_style=?, ocr_engine_used=?, ocr_detected_text=?, ocr_similarity_score=?, wcag_contrast_ratio=?,
        hallucinated_text_found=?, retry_count=?, status=?, diagnosis_json=?, clean_plate_url=?, owner_id=?, updated_at=?
      WHERE id = ?`).run(
      row.literal_text, row.script_mode, row.direction, row.render_strategy, row.primary_font_id, row.paired_font_id,
      row.material_style, row.ocr_engine_used, row.ocr_detected_text, row.ocr_similarity_score, row.wcag_contrast_ratio,
      row.hallucinated_text_found, row.retry_count, row.status, row.diagnosis_json, row.clean_plate_url, row.owner_id, now(), existing.id,
    );
    return existing.id;
  }
  const id = `itl_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(`INSERT INTO image_text_layers (
      id, asset_id, owner_id, clean_plate_url, layer_role, script_mode, direction, literal_text,
      render_strategy, primary_font_id, paired_font_id, material_style,
      ocr_engine_used, ocr_detected_text, ocr_similarity_score, wcag_contrast_ratio,
      hallucinated_text_found, retry_count, status, diagnosis_json, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, row.asset_id, row.owner_id, row.clean_plate_url, row.layer_role, row.script_mode, row.direction, row.literal_text,
    row.render_strategy, row.primary_font_id, row.paired_font_id, row.material_style,
    row.ocr_engine_used, row.ocr_detected_text, row.ocr_similarity_score, row.wcag_contrast_ratio,
    row.hallucinated_text_found, row.retry_count, row.status, row.diagnosis_json, now(), now(),
  );
  return id;
}

/** Register planned layers (status 'planned') from a built plan. */
export function persistPlannedLayers(db, { ownerId, assetId, plan }) {
  const ids = [];
  for (const layer of plan.layers) {
    ids.push(upsertLayer(db, {
      asset_id: assetId, owner_id: ownerId, clean_plate_url: null,
      layer_role: layer.layer_role, script_mode: layer.script_mode,
      direction: plan.direction, literal_text: layer.literal_text,
      render_strategy: plan.render_strategy,
      primary_font_id: layer.font_id, paired_font_id: layer.paired_font_id,
      material_style: layer.material_style,
      ocr_engine_used: 'none', ocr_detected_text: null, ocr_similarity_score: null,
      wcag_contrast_ratio: null, hallucinated_text_found: 0, retry_count: 0,
      status: 'planned', diagnosis_json: '[]',
    }));
  }
  return ids;
}

/* ------------------------- verification flow -------------------------- */

function loadOwnedAsset(db, ownerId, assetId) {
  const asset = db.prepare('SELECT id, owner_id FROM studio_assets WHERE id = ?').get(assetId);
  if (!asset) throw new StudioError(404, 'TYPO_ASSET_NOT_FOUND', 'Asset not found.');
  if (asset.owner_id !== ownerId) throw new StudioError(403, 'TYPO_ASSET_FORBIDDEN', 'Asset belongs to another tenant.');
  return asset;
}

/**
 * Run the bilingual OCR gate over an asset's text layers.
 * @param ocr injected engine ({ scan }) — tests use counting doubles.
 * @param analyzer optional WCAG contrast sampler ({ contrast(imageRef) -> number|null }).
 */
export async function verifyTypographyOcr(db, {
  ownerId, assetId, layersInput = null, cleanPlateUrl = null,
  ocr = null, analyzer = null, imageRef = null,
}) {
  loadOwnedAsset(db, ownerId, assetId);
  const stored = db.prepare(
    'SELECT * FROM image_text_layers WHERE asset_id = ? ORDER BY created_at ASC',
  ).all(assetId);
  const layers = layersInput && layersInput.length
    ? layersInput.map((l) => ({
      layer_role: l.layer_role || 'headline', literal_text: l.literal_text,
      script_mode: detectScript(l.literal_text), exact_case: l.exact_case,
      font_id: null, paired_font_id: null, material_style: 'flat_clean',
    }))
    : stored.map((r) => ({
      layer_role: r.layer_role, literal_text: r.literal_text, script_mode: r.script_mode,
      exact_case: false, font_id: r.primary_font_id, paired_font_id: r.paired_font_id,
      material_style: r.material_style, retry_count: r.retry_count, status: r.status,
    }));

  // Conditional gate (Layer 7): nothing requested -> skipped, ZERO OCR calls.
  if (layers.length === 0) {
    return { asset_id: assetId, ocr_status: 'skipped', ocr_calls: 0, layers: [] };
  }

  const engine = ocr || defaultOcrAdapter();
  const langs = [...new Set(layers.map((l) => (l.script_mode === 'en' ? 'eng' : 'ara')))];
  const results = [];
  let ocrCalls = 0;
  let ocrText = '';
  let engineUsed = 'none';
  let engineError = null;

  try {
    const scan = await engine.scan({ imageRef, langs: langs.length ? langs : ['eng'] });
    ocrCalls++;
    ocrText = scan.text || '';
    engineUsed = scan.engine || 'injected';
  } catch (err) {
    engineError = err;
  }

  const contrast = analyzer ? await analyzer.contrast(imageRef) : null;
  const gibberish = ocrText ? detectGibberish(ocrText, layers.map((l) => l.literal_text)) : [];

  for (const layer of layers) {
    const priorRetry = layer.retry_count || 0;
    const base = {
      asset_id: assetId, owner_id: ownerId, clean_plate_url: cleanPlateUrl,
      layer_role: layer.layer_role, script_mode: layer.script_mode,
      direction: layer.script_mode === 'en' ? 'ltr' : 'rtl',
      literal_text: layer.literal_text,
      render_strategy: 'native_generative',
      primary_font_id: layer.font_id, paired_font_id: layer.paired_font_id,
      material_style: layer.material_style,
      ocr_engine_used: engineUsed, ocr_detected_text: ocrText || null,
      wcag_contrast_ratio: contrast,
      hallucinated_text_found: gibberish.length > 0 ? 1 : 0,
    };

    if (engineError) {
      // Honest unverified state — never a fabricated pass.
      const id = upsertLayer(db, {
        ...base, ocr_similarity_score: null, retry_count: priorRetry,
        status: 'failed_unverified',
        diagnosis_json: JSON.stringify([{ code: engineError.code || 'OCR_ENGINE_ERROR' }]),
      });
      results.push({ layer_id: id, layer_role: layer.layer_role, status: 'failed_unverified', error_code: engineError.code || 'OCR_ENGINE_ERROR' });
      continue;
    }

    const exactCase = layer.exact_case || /[A-Z]/.test(String(layer.literal_text).slice(1).replace(/[^A-Za-z]/g, 'x'));
    const score = bestMatchSimilarity(layer.literal_text, ocrText, { exactCase });

    // A clean pass requires BOTH the layer's own text to match AND the image
    // to be free of hallucinated gibberish — stray tokens elsewhere in the
    // render are a defect even when the requested text is perfect.
    if (score >= OCR_PASS_THRESHOLD && gibberish.length === 0) {
      const id = upsertLayer(db, {
        ...base, ocr_similarity_score: score, retry_count: priorRetry,
        status: 'passed', diagnosis_json: '[]',
      });
      results.push({ layer_id: id, layer_role: layer.layer_role, status: 'passed', ocr_similarity_score: score });
      continue;
    }

    const diagnosis = [];
    if (score < OCR_PASS_THRESHOLD) {
      diagnosis.push({
        code: score < 0.5 ? 'spelling_mismatch' : 'partial_text_mismatch',
        script: layer.script_mode,
        expected: layer.literal_text,
        detected_excerpt: ocrText.slice(0, 120),
        similarity: Math.round(score * 1000) / 1000,
      });
    }
    if (contrast !== null && contrast < 3) diagnosis.push({ code: 'low_contrast', wcag_contrast_ratio: contrast });
    if (gibberish.length) diagnosis.push({ code: 'hallucinated_text', tokens: gibberish.slice(0, 5) });

    if (priorRetry < MAX_PAID_RETRIES) {
      // Diagnostic-Driven Retry Refinement (Layer 8 core): exactly one paid
      // retry, armed with the precise failure reasons for Prompt Enhancer.
      const id = upsertLayer(db, {
        ...base, ocr_similarity_score: score, retry_count: priorRetry + 1,
        status: 'retry_scheduled', diagnosis_json: JSON.stringify(diagnosis),
      });
      results.push({
        layer_id: id, layer_role: layer.layer_role, status: 'retry_scheduled',
        retry_count: priorRetry + 1, ocr_similarity_score: score, diagnosis,
      });
    } else {
      // Max-1-Retry Budget Circuit-Breaker (Layer 8) + Clean-Then-Composite
      // Recovery (Layer 8/10): mandatory free deterministic recovery; the
      // compositor renders the literal verbatim, so accuracy is 100% by
      // construction — and recorded as such, with the clean plate cached.
      const id = upsertLayer(db, {
        ...base,
        render_strategy: 'fallback_compositor',
        ocr_engine_used: 'deterministic_local',
        ocr_similarity_score: 1.0,
        retry_count: priorRetry,
        status: 'fallback_recovered',
        diagnosis_json: JSON.stringify(diagnosis),
        clean_plate_url: cleanPlateUrl || base.clean_plate_url,
      });
      results.push({
        layer_id: id, layer_role: layer.layer_role, status: 'fallback_recovered',
        render_strategy: 'fallback_compositor', ocr_similarity_score: 1.0,
        retry_count: priorRetry, diagnosis,
      });
    }
  }

  return {
    asset_id: assetId,
    ocr_status: 'executed',
    ocr_calls: ocrCalls,
    ocr_engine_used: engineUsed,
    hallucinated_text_found: gibberish.length > 0,
    gibberish_tokens: gibberish.slice(0, 10),
    wcag_contrast_ratio: contrast,
    layers: results,
  };
}
