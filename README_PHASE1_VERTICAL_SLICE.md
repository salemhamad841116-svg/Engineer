# Phase-1 Feature Freeze — Vertical Slice (Execution Order)

Frozen scope: ONE integrated, fast, lean E2E production line — chat message
to compressed WebP in the split-screen — with every advanced annex deferred
to Phases 2-4. This document records what the frozen slice is, where it
lives, and how its seven acceptance gates are proven.

## The Frozen E2E Flow

1. **Smart Intent Router** — normalize + literal lock → local fast-path
   (<10ms, $0) → local classifier with cloud fallback on schema failure.
2. **Quick Clarifiers** — confidence band 0.50-0.79 halts any paid call and
   shows the 1-3 chip card (<15ms, deterministic bank) with 1-Click Skip.
3. **Smart Presets + Prompt Enhancer** — 7 base presets with quick modifiers
   and intensity → SHA-256-cached enhancement with protected brand locking.
4. **Generation + Sharp** — IMAGE_PROVIDER=gemini (mock in tests) with
   content-hash dedup, conditional OCR gate, local WebP via Sharp.
5. **Adaptive Split-Screen** — 2-4 candidates via `candidates`, badge +
   custom preset + Brand Preset Lock (presets v1 surface).

## Frozen /api/v1 Surface

| Scope | Routes |
|---|---|
| Router + telemetry | `POST /router/dispatch` • `POST /router/:logId/override` • `GET /telemetry/routing-and-cost` |
| Clarifiers | `POST /clarifiers/evaluate` • `POST /clarifiers/:id/resolve` • `POST /clarifiers/:id/skip` |
| Presets & identity | `GET /presets` • `POST /presets/resolve` • `POST /presets/custom` • `GET/PATCH /projects/:id/brand-kit` |
| Enhance + images | `POST /prompts/enhance` • `POST /images/generate` |

Implementation: `server/studio/phase1/phase1Routes.js` — thin zod-guarded
bindings over the SAME engines that serve the legacy `/api/studio` surface
(no duplicated logic; the client keeps working).

## Tables (with documented name adaptations)

| Directive name | Actual table | Note |
|---|---|---|
| intent_routing_logs | `studio_routing_telemetry` | pre-existing (035) |
| provider_cost_ledger | `provider_cost_ledger` | **new — migration 042** |
| clarifier_sessions / clarifier_prompt_cache | `studio_clarifier_sessions` / `studio_clarifier_cache` | (039) |
| smart_presets / brand_kits | `smart_presets` / `studio_project_brand_lock` | (040) |
| prompt_enhancer_cache | `studio_prompt_cache` | (038) |
| image_assets / asset_content_cache | `studio_assets` / `studio_generation_cache` | pre-existing |

## The Seven Acceptance Gates (13-test suite)

1. **Cleanliness & security** — regex gate over the phase-1 engine surface
   (Arabic only in i18n lexicons + fixtures); AES-256-GCM vault; zero key
   references in the TS/TSX client bundle.
2. **Fast-path speed** — avg <10ms over 50 runs, provider `fast_path`,
   injected LLM spy at exactly 0 calls.
3. **Bilingual verbatim lock** — the gate message
   `متجر قهوة الأصالة — AL ASALA في سحراء` yields correction
   `سحراء→صحراء` AND the whole bilingual brand
   `قهوة الأصالة — AL ASALA` as ONE locked verbatim entity (dash-bridge
   capture in `extractBrandCandidates`), auditable in the ledger meta.
4. **Ambiguity guard** — band request → deterministic-bank card <15ms with
   0 LLM calls; 1-click resolve compiles with provably 0 LLM calls.
5. **Conditional OCR** — `commercial_storefront` + `marketing_banner`
   required; `cinematic_photo` + `ui_assets` skipped; service-level proof:
   gate-off preset fires 0 OCR calls even with brand text, gated preset
   retries at most once (MAX_ATTEMPTS=2) then fails honestly.
6. **Zero duplicate spend** — repeat enhance → `prompt_cache_hit` (0 LLM);
   repeat generate → `generation_cache_hit` with the saving booked in
   `provider_cost_ledger` (estimated pricing, flagged honestly; mock runs
   book no fake spend).
7. **Clean real run** — full HTTP cycle (dispatch → presets → enhance →
   generate → RIFF/WEBP bytes on disk → telemetry) + 2-candidate group +
   browser boot with **0 console errors** (session probe `/api/auth/me`
   now answers 200 `user:null`; inline SVG favicon removes the 404).

## Honest Notes

- The sandbox cannot reach Gemini/Google (TLS-blocked): generation is
  exercised through the mock provider boundary; the paid path itself is
  unchanged and the cost ledger books real spend only against real
  providers (`pricing_model: 'estimated'` everywhere else).
- OCR verification uses local Tesseract (eng pack only in the sandbox) —
  unavailability is reported honestly, never faked.
- Deferred (not built): inpainting/outpainting, mask+SAM, rembg, 4K
  upscale, 3D perspective / LUT / CMYK, UI Builder, Hybrid DAG, Admin CMS,
  A/B tests, ZIP export & share links.
