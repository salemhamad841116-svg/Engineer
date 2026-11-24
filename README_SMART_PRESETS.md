# Smart Presets Subsystem — Phase 1 Extension (أوضاع التوليد الجاهزة)

Extends Phase 1 with the 4-layer Smart Presets subsystem. Built into the same
platform source (commit d437b6f + Phase 1), same DAL/security rules.

## Layers delivered

1. **Categorized Preset Library** — `server/studio/presetRegistry.js`: the six
   modes (`cinematic_photo`, `commercial_storefront`, `product_studio`,
   `ui_assets`, `fintech_tech`, `marketing_banner`), each bundling all five
   parameters: positive wrapper (prefix/suffix/strong_boost), negative rules,
   default aspect, conditional OCR gate, palette injection.
2. **Smart Parameter Bundling** — applied in `studioService.generateStudioAsset`:
   wrapper + modifiers + `Color palette: …` + `Style seed: …` all land in the
   final provider prompt; manual aspect override beats preset default.
3. **Auto-Detection & Quick Modifiers** — `detectPreset` (keywords from i18n,
   sector fallback, honest default), `auto_detected` + `badge` in the API
   response drive the changeable badge; contextual modifiers validated per
   preset (unknown → 400); `preset_intensity` (subtle/balanced/strong) weights
   the wrapper against the free text.
4. **Custom & Brand Presets** — migration 034: `studio_custom_presets` +
   `studio_project_brand_lock` (+ 6 audit columns on `studio_assets`).
   `presetStore.js` DAL: save-from-asset (seed/palette/modifiers snapshot),
   brand lock pins preset + style_seed + palette across project generations
   until unlock. Owner-scoped everywhere.

## New / changed files

- `server/studio/presetRegistry.js`, `presetStore.js`, `studioErrors.js`, `i18n/labels.js` (new)
- `server/studio/imagePresets.js` (compat shim; legacy ids `cinematic`/`storefront`/`product` resolve via alias map)
- `server/studio/studioService.js`, `studioRoutes.js` (extended)
- `server_backend/db/database.js` (migration 034)
- `server_backend/tests/studioPresetsSuite.test.js` (new, 14 tests), `smartStudioSuite.test.js` (updated for 6 presets)
- `scripts/verify-build.mjs` (new gate: Smart Presets Subsystem Suite)
- `src/studio/studioApi.ts`, `src/studio/PresetGallery.tsx` (thumbnail cards, badge, modifier bar, intensity)

## New endpoints

- `GET /api/studio/presets?lang=ar|en` — gallery with labels + modifiers + thumbnails
- `GET /api/studio/presets/:id/thumbnail` — deterministic SVG palette card
- `POST /api/studio/presets/custom` `{asset_id, name}` · `GET /presets/custom` · `DELETE /presets/custom/:id`
- `PUT|GET|DELETE /api/studio/projects/:projectId/brand-lock`
- `POST /api/studio/generate` now accepts `custom_preset_id`, `modifiers`, `intensity`, `aspect`; response adds `auto_detected`, `badge`, `palette`, `style_seed`, `modifiers`, `intensity`, `ocr_gate_mode`

## Verified (this sandbox, Node 22.14)

- **14/14** presets suite — including the spec's literal acceptance cases:
  auto-detect ("صورة احترافية في سحراء" → cinematic_photo, 16:9, OCR off, badge),
  conditional OCR with a call-counting spy (storefront/banner always verify;
  cinematic/ui_assets zero OCR calls; product/fintech only when text present),
  modifiers + intensity visible in the final prompt, brand lock pinning
  seed+palette across generations until unlock.
- **25/25** Phase 1 suite still green after refactor; migrations-from-scratch ✅;
  media suite 16/16 ✅.
- Frontend component: TypeScript strict, **0 errors**.

## Honest limitations

- `style_seed` is a prompt-level anchor (Gemini's generateContent exposes no
  seed parameter) — it improves consistency via prompt + locked palette, it is
  NOT API-level determinism.
- Thumbnails are deterministic SVG palette cards (real visual identity, zero
  cost); AI-generated sample thumbnails can be cached on top later without
  changing the endpoint contract.
- The `PresetGallery` component is type-checked and delivered but not yet
  mounted on a studio page (no studio frontend page exists yet — Phase 3).
