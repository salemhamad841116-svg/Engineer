# Smart Studio — Phase 1 (الاستوديو الذكي)

Smart Intent Router + Prompt Enhancer + Image Generation Engine + Smart Presets + OCR Typography Gate.
Built directly into the Engineer platform source (commit d437b6f), following the `server/media/` pattern.

## Files

| File | Role |
|---|---|
| `server/studio/intentRouter.js` | Keyword-scored routing: image / ui / hybrid / chat + Quick Clarifiers (platform/theme/sector buttons, suppressed when answered) |
| `server/studio/promptEnhancer.js` | Arabic dialect normalization (token-level), overlay-text extraction («…»/quotes/باسم), deterministic professional English prompt builder, optional LLM polish with honest fallback |
| `server/studio/imagePresets.js` | cinematic (16:9) / storefront (16:9) / product (1:1) presets |
| `server/studio/imageProviders.js` | Isolated provider layer: `GEMINI_API_KEY` (native generateContent, model `IMAGE_GEMINI_MODEL` default `gemini-2.5-flash-image`) → `MEDIA_IMAGE_*` OpenAI-compatible → honest BLOCKED. `IMAGE_PROVIDER_MOCK=1` for tests. FAL_KEY plugs in here later without touching callers |
| `server/studio/qualityGate.js` | Tesseract OCR typography gate: coverage ≥ 0.95 passes; language-adaptive (eng+ara when installed, degrades honestly) |
| `server/studio/studioService.js` | DAL (all studio SQL) + orchestration: classify → enhance → generate → magic-byte validation → OCR gate → ONE typography-emphasis retry → honest READY / UNVERIFIED / QUALITY_GATE_FAILED / FAILED |
| `server/studio/studioRoutes.js` | Express router (see endpoints below) |
| `server_backend/tests/smartStudioSuite.test.js` | 25 tests (see verification below) |

## Modified platform files

- `server_backend/db/database.js` — migration `033_smart_studio` adds `studio_assets` (full audit trail: original Arabic message, English prompt, OCR coverage, attempts, provider/model, honest states)
- `server.ts` — wires `app.use('/api/studio', studioRoutes(platformDb, workspaceAuth.requireWorkspaceAuth))`
- `scripts/verify-build.mjs` — new gate: **Smart Studio Phase 1 Suite (25 Tests)**

## Endpoints (all behind workspace auth)

- `GET  /api/studio/providers` — provider status (READY/BLOCKED honestly)
- `GET  /api/studio/presets` — the three presets
- `GET  /api/studio/quota` — daily image quota (shared with media engine: 20/day)
- `POST /api/studio/route` — `{message, answers?}` → `{mode, confidence, sector, platform, theme, clarifiers[]}`
- `POST /api/studio/enhance` — `{message, preset_id?, sector?, theme?, platform?}` → `{prompt_en, negative, overlay_texts[]}`
- `POST /api/studio/generate` — `{message, preset_id?, project_id?, answers?}` → full pipeline → asset record
- `GET  /api/studio/assets` / `GET /api/studio/assets/:id` — list / read (owner-scoped)
- `GET  /api/studio/assets/:id/file` — artifact download (ownership + path-traversal safe)

## Environment

```bash
GEMINI_API_KEY=...            # required for real generation (Phase 1 provider)
IMAGE_GEMINI_MODEL=gemini-2.5-flash-image   # optional override
IMAGE_PROVIDER_MOCK=1         # tests only — deterministic 1px PNG
MEDIA_STORAGE_DIR=...         # artifacts root (default data/media/studio/<owner>/)
```

## Verified (this sandbox, Node 22.14, real Tesseract 5)

- ✅ **25/25** Smart Studio suite — including REAL OCR tests: PIL-rendered text images verified by actual Tesseract; retry orchestration proven end-to-end (wrong-text image → emphasis retry → right-text image → READY, attempts=2, 2 quota units)
- Regression: `freshDbMigrationSuite` ✅, `mediaAndFlashcardsSuite` 16/16 ✅, `aiFeaturePackSuite` 11/11 ✅, `continuousImprovementSuite` 13/13 ✅
- `server.ts` + all studio modules pass esbuild syntax validation

## Honest limitations (not verified here)

- **Real Gemini generation was NOT tested** (no API key in sandbox). The request shape (URL, `x-goog-api-key` header, responseModalities, inlineData parsing) is unit-tested via injected fetch. First real run needs `GEMINI_API_KEY` set.
- Full `npm run build` / lint gates were not run in this sandbox (dev dependencies omitted); syntax validated with esbuild instead. Run `node scripts/verify-build.mjs` on your machine.
- Arabic OCR requires `ara` tessdata on the host (`apt install tesseract-ocr-ara`); without it the gate runs eng-only and Arabic overlay verification degrades honestly.
- UI Builder / Hybrid execution paths are ROUTED (mode + clarifiers) but not built — that's Phase 3.
