# Bilingual In-Image Typography Engine (Annex 8 — Phase 1)

Official 8th annex, adopted as a Phase-1 package: deterministic-first,
bilingual AR+EN by design (not Arabic-only), zero fabricated verification.

## Phase-1 Scope Delivered

| Annex layer | Phase-1 status |
|---|---|
| 1. Bilingual literal extraction, BiDi segmentation, Exact Brand Casing | **Complete** |
| 2. Safe zones / RTL–LTR layout direction | Core (plan-level direction binding) |
| 3. Bilingual Rendering Strategy Matrix | Core (4 deterministic rules + fallback) |
| 4. Font Vault + Auto AR–EN Pairing | Core (DB vault, paired_font_id chain) |
| 6. Quoted-literal prompting + bilingual negative rules | Core (gemini/fal dialects) |
| 7. Multi-Engine Bilingual OCR Verification Gate | **Complete** |
| 8. Diagnostic-driven retry + Max-1-Retry Budget Circuit-Breaker | Core |
| 10. Clean-plate caching + bilingual policy guardrail | Core |

Deferred (reference-only, NOT built): Phase-2 composite/homography/materials/
live layer editing, Phase-3 hybrid HTML-vs-baked decision, Phase-4
localize-export / custom font upload / `typography_ocr_analytics`.

## Files

- `server_backend/db/database.js` — migration `041_bilingual_typography`
  (`typography_fonts` + `image_text_layers` + 4 indexes + 7 paired font seeds).
  Documented adaptation: the annex references `image_assets(id)`; this
  codebase's asset table is `studio_assets(id)` — the FK points there.
- `server/studio/typography/` — 9 modules:
  `textAnalysis.js` (script detection, BiDi segmentation with byte-exact
  round-trip, casing lock, digit-critical detection),
  `strategyMatrix.js` (decision rules + annex-exact negative strings +
  provider dialects), `fontVault.js` (warm in-memory vault, forward AND
  reverse pairing), `policyGuard.js` (bilingual denylist, category-only
  errors, phrase never echoed), `typographyEngine.js` (plan orchestration,
  Zod-validated Bilingual Typography Plan contract), `ocrGate.js`
  (Levenshtein/CER + best-window matching, gibberish detector, honest
  Tesseract default adapter, retry breaker, fallback recovery),
  `typographySchema.js`, `typographyRoutes.js`,
  `i18n/typographyLexicon.js` (the ONLY Arabic file).
- `server_backend/tests/bilingualTypographySuite.test.js` — 21 tests.
- Gate 8m in `scripts/verify-build.mjs`.

## Routes (all behind requireWorkspaceAuth, owner-scoped)

- `GET  /api/v1/typography/fonts?script=ar|en|bilingual&category=…&lang=ar|en`
- `POST /api/v1/typography/plan` — `{ text | layers[], direction?, style_category?, material_style?, provider?, asset_id? }` → Bilingual Typography Plan; persists planned layers when `asset_id` is given.
- `POST /api/v1/typography/:assetId/verify-ocr` — `{ layers?, clean_plate_url?, image_ref? }` → per-layer verdicts.

## The Four Acceptance Gates (all verified ×3 script cases)

1. **Mixed plan**: `قهوة الأصالة — AL ASALA EST. 2026` → `script_mode: mixed`,
   literal VERBATIM, BiDi segments join byte-for-byte, font pairing resolved
   from `typography_fonts` (ibm_plex_sans_ar ↔ inter_sans). `ChatHSM` →
   `casing_mode: exact_brand`, never case-transformed.
2. **Strategy matrix**: short EN mark (≤3 words) → `native_generative` with
   Latin negatives; any AR / mixed / long EN / digit-critical →
   `deterministic_compositor`.
3. **OCR gate**: CER similarity ≥ 0.95 on AR sign / EN package / bilingual
   banner (best-window matching scores each layer against its share of the
   full-image scan); hallucinated gibberish tokens block a clean pass even
   when the layer text matches; text-free asset → `ocr_status: skipped`
   with **zero** OCR calls.
4. **Budget breaker**: OCR fail → exactly ONE diagnostic retry
   (`retry_count ≤ 1`, diagnosis: spelling/partial mismatch, low contrast,
   hallucinated tokens) → mandatory FREE `fallback_compositor`
   (score 1.0 by construction) with `clean_plate_url` persisted.

## Honesty Contract

- Engine unavailable / language pack missing → `failed_unverified`
  (503 `OCR_ENGINE_UNAVAILABLE` / `OCR_LANGUAGE_PACK_MISSING`). The sandbox
  Tesseract has `eng` only — the default adapter reports the missing `ara`
  pack instead of fabricating a score.
- Policy violations → 400 `POLICY_TEXT_REJECTED` with the violated
  **category only** — the matched phrase is never echoed into logs, prompts,
  or responses.
- 100% English codebase: Arabic exists only in `i18n/typographyLexicon.js`
  and test fixtures (regex gate enforced in the suite).

## Test Doubles

`E2E_TEST_MODE=1` only: the verify-ocr body may carry `ocr_double`
(`{ text }` or `{ error_code }`) for deterministic HTTP lifecycle tests.
Ignored in every other mode.
