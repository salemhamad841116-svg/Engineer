/**
 * typographyRoutes.js — Bilingual In-Image Typography Engine REST surface
 * (annex 8: 3 Phase-1 routes).
 *
 *   GET  /api/v1/typography/fonts?script=&category=   (font vault + pairing)
 *   POST /api/v1/typography/plan                      (Bilingual Typography Plan)
 *   POST /api/v1/typography/:assetId/verify-ocr       (OCR gate + retry breaker)
 *
 * Mounted in server.ts behind requireWorkspaceAuth; every query is
 * owner-scoped. Zod violations map to 400; honest states only — a failed
 * or unverifiable OCR pass is reported as such, never fabricated.
 *
 * E2E_TEST_MODE only: the verify-ocr body may carry an `ocr_double`
 * ({ text, error_code, error_status }) so the full HTTP lifecycle can be
 * tested deterministically without a local Arabic OCR language pack.
 * The field is ignored in every other mode.
 */

import { Router } from 'express';
import { listFonts } from './fontVault.js';
import { buildTypographyPlan } from './typographyEngine.js';
import { verifyTypographyOcr, persistPlannedLayers } from './ocrGate.js';
import { PLAN_INPUT_SCHEMA, VERIFY_INPUT_SCHEMA } from './typographySchema.js';
import { TYPOGRAPHY_I18N } from './i18n/typographyLexicon.js';
import { StudioError } from '../studioErrors.js';

/** Deterministic test double honored only under E2E_TEST_MODE. */
function ocrDoubleFromBody(body) {
  if (process.env.E2E_TEST_MODE !== '1') return null;
  const d = body && body.ocr_double;
  if (!d || typeof d !== 'object') return null;
  if (typeof d.error_code === 'string' && d.error_code) {
    const status = Number.isInteger(d.error_status) ? d.error_status : 503;
    return {
      async scan() {
        throw new StudioError(status, d.error_code, 'Injected OCR failure (test double).');
      },
    };
  }
  const text = typeof d.text === 'string' ? d.text : '';
  return {
    async scan() {
      return { text, engine: 'injected_test_double' };
    },
  };
}

export function typographyV1Routes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);
  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const zodGuard = (fn) => (req, res, next) => {
    try { return fn(req, res, next); }
    catch (err) {
      if (err && err.name === 'ZodError') {
        return next(new StudioError(400, 'TYPOGRAPHY_INPUT_INVALID', 'Invalid request payload.'));
      }
      return next(err);
    }
  };

  // Font Vault (Layer 4 core): filter by script/category, pairing resolved.
  r.get('/typography/fonts', (req, res) => {
    const lang = req.query.lang === 'ar' ? 'ar' : 'en';
    const script = ['ar', 'en', 'bilingual'].includes(req.query.script) ? req.query.script : null;
    const fonts = listFonts(db, {
      script,
      category: typeof req.query.category === 'string' ? req.query.category : null,
    });
    res.json({
      fonts,
      policy_message: TYPOGRAPHY_I18N[lang]['typography.policy.rejected'],
      server_ms: 0,
    });
  });

  // Bilingual Typography Plan (Layers 1-4 + 6 core): script detection, BiDi
  // segmentation, brand casing lock, strategy matrix, deterministic fallback,
  // font pairing, policy guardrail. Optionally persists planned layers.
  r.post('/typography/plan', asyncH(zodGuard((req, res) => {
    const input = PLAN_INPUT_SCHEMA.parse(req.body || {});
    const plan = buildTypographyPlan(db, { ownerId: req.user.id, payload: input });
    let planned_layer_ids = null;
    if (input.asset_id) {
      planned_layer_ids = persistPlannedLayers(db, {
        ownerId: req.user.id, assetId: input.asset_id, plan,
      });
    }
    res.json({ plan, planned_layer_ids });
  })));

  // OCR Verification Gate (Layers 7 + 8 + 10 core): conditional execution,
  // CER similarity scoring, gibberish detection, max-1-retry breaker with
  // diagnosis, free deterministic fallback recovery with clean plate.
  r.post('/typography/:assetId/verify-ocr', asyncH(zodGuard(async (req, res) => {
    const input = VERIFY_INPUT_SCHEMA.parse(req.body || {});
    const result = await verifyTypographyOcr(db, {
      ownerId: req.user.id,
      assetId: req.params.assetId,
      layersInput: input.layers || null,
      cleanPlateUrl: input.clean_plate_url || null,
      imageRef: input.image_ref || null,
      ocr: ocrDoubleFromBody(req.body),
    });
    res.json(result);
  })));

  // Unified error handler — no internal leaks, no echoed policy phrases.
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof StudioError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[typography-v1] unexpected:', err);
    res.status(500).json({ error: { code: 'TYPOGRAPHY_INTERNAL_ERROR', message: 'Internal typography error.' } });
  });

  return r;
}
