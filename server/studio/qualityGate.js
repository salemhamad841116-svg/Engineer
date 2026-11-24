/**
 * OCR Quality Gate — Phase 1 (Smart Studio).
 *
 * The spec's typography acceptance criterion, made measurable:
 * any overlay text that must appear inside a generated image (store names,
 * headlines) is verified with local Tesseract OCR. Coverage >= 0.95 passes;
 * otherwise the caller regenerates ONCE with stronger typography emphasis,
 * then reports QUALITY_GATE_FAILED honestly — never ships distorted text.
 */
import { execFile } from 'node:child_process';

export const OCR_THRESHOLD = 0.95;

const stripDiacritics = (s) => s.replace(/[\u064B-\u0652\u0670\u0640]/g, '');

function normWords(text) {
  return stripDiacritics(String(text || '').toLowerCase())
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** Fraction of expected words found in the OCR output (0..1). */
export function textCoverage(expectedTexts, ocrText) {
  const hay = new Set(normWords(ocrText));
  let expected = 0;
  let found = 0;
  const missing = [];
  for (const t of expectedTexts) {
    for (const w of normWords(t)) {
      expected += 1;
      if (hay.has(w)) found += 1;
      else missing.push(w);
    }
  }
  if (expected === 0) return { coverage: 1, expected: 0, found: 0, missing: [] };
  return { coverage: found / expected, expected, found, missing };
}

export function tesseractAvailable() {
  return new Promise((resolve) => {
    execFile('tesseract', ['--version'], { timeout: 10_000 }, (err) => resolve(!err));
  });
}

let cachedLangs = null;
/** Detect installed tessdata languages once; prefer eng+ara, degrade honestly. */
function detectLangs() {
  if (cachedLangs) return Promise.resolve(cachedLangs);
  return new Promise((resolve) => {
    execFile('tesseract', ['--list-langs'], { timeout: 10_000 }, (err, stdout) => {
      if (err) { cachedLangs = 'eng'; return resolve(cachedLangs); }
      const have = new Set(String(stdout).split('\n').map((l) => l.trim()).filter(Boolean));
      const want = ['eng', 'ara'].filter((l) => have.has(l));
      cachedLangs = want.length ? want.join('+') : 'eng';
      resolve(cachedLangs);
    });
  });
}

/** Run local Tesseract on an image file (eng+ara when installed). Honest errors, no fabrications. */
export async function ocrImage(imagePath) {
  const langs = await detectLangs();
  return new Promise((resolve) => {
    execFile('tesseract', [imagePath, 'stdout', '-l', langs], { timeout: 60_000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: `tesseract: ${err.message}`, text: '', langs });
      resolve({ ok: true, text: String(stdout || ''), error: null, langs });
    });
  });
}

/**
 * Verify overlay texts inside a generated image.
 * @returns {Promise<{pass:boolean, coverage:number, missing:string[], reason:string|null}>}
 */
export async function verifyImageTexts(imagePath, expectedTexts, { threshold = OCR_THRESHOLD } = {}) {
  if (!expectedTexts || expectedTexts.length === 0) {
    return { pass: true, coverage: 1, missing: [], reason: 'no-overlay-texts' };
  }
  if (!(await tesseractAvailable())) {
    return { pass: false, coverage: 0, missing: [], reason: 'BLOCKED_OCR_UNAVAILABLE' };
  }
  const ocr = await ocrImage(imagePath);
  if (!ocr.ok) return { pass: false, coverage: 0, missing: [], reason: ocr.error };
  const cov = textCoverage(expectedTexts, ocr.text);
  return {
    pass: cov.coverage >= threshold,
    coverage: Math.round(cov.coverage * 1000) / 1000,
    missing: cov.missing,
    reason: null,
  };
}
