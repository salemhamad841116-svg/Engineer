# Quick Image Toolbar — Official Annex (Phase-1 Mini + Phase 2-4 Reference)

## 1. Scope Rule (mandatory)

The Phase-1 feature freeze stays intact. Phase 1 ships **only** a lightweight
mini toolbar with **exactly five actions** over the studio image:

1. **Quick controls toggle** — show/hide the Layer-2 ControlsBar.
2. **Generate variant** — same brief, fresh style seed (`POST /api/studio/generate`).
3. **Save as custom preset** — one click (`POST /api/studio/presets/custom`).
4. **Pin / unpin** the active candidate (local compare state).
5. **Download** — original PNG or optimized WebP (`GET /api/studio/assets/:id/file`).

**Zero new tables. Zero new routes. Zero new libraries.** Every action binds
to an endpoint or state store that already existed in the frozen Phase-1
slice. The full 10-layer / 50-feature toolbar (masking + Lazy SAM, inpainting,
outpainting, local rembg/4K, live text, UI bridge, undo/redo version tree,
brand vault, 300 DPI export, telemetry) is **Phase 2-4 reference material —
DO NOT BUILD** until Phase 1 is formally accepted and Phase 2 is opened.

## 2. Delivered Files

| File | Role |
| --- | --- |
| `src/studio/QuickImageToolbar.tsx` | The mini toolbar component (5 actions, collapsible, per-action debounce lock). |
| `src/studio/ImageStudioPanel.tsx` | Integration: canvas overlay mount, 56px top inset (zero occlusion), controls visibility state, variant seed override. |
| `src/studio/toolbarHarness.tsx` + `toolbar-harness.html` | Dev-only verification harness (not mounted in the product shell). |
| `server_backend/tests/quickImageToolbarGate.test.cjs` | Self-contained Gate-A browser suite (boots its own server, 22 checks). |

No server file was modified; no migration was added (still 42 migrations /
109 tables). The only pre-existing fix in this round: removed a stale
`eslint-disable react-hooks/exhaustive-deps` comment in `UIBuilderPanel.tsx`
that broke the lint gate (rule plugin not installed).

## 3. Design Contract

- **Zero occlusion** — `StudioCanvas` reserves a 56px top band
  (`TOOLBAR_INSET_PX`); the image is centered below it, so the floating bar
  can never cover any image pixel at any aspect ratio (verified by
  bounding-box intersection = 0px).
- **Collapsible** — the bar folds into a single handle; expanded state shows
  the 5 actions + handle (`data-collapsed` attribute for tests).
- **Per-action debounce lock** — `TOOLBAR_DEBOUNCE_MS = 400ms`; rapid repeat
  clicks on the *same* action fire exactly once while different actions stay
  responsive. Async actions additionally disable while in flight.
- **Zero reloads** — downloads use native same-origin anchor downloads;
  every other action is pure React state or `fetch`.
- **i18n** — all strings arrive via `labels.toolbar` (English-only codebase;
  Arabic labels come from the server i18n at mount time, like the rest of
  the studio).
- **Accessibility** — `aria-label`, `aria-pressed` (toggles), `aria-expanded`
  (collapse + download menu) on every control.

## 4. Gate A — Acceptance Evidence (22/22 PASSED)

Self-contained run (boots the platform with the mock image provider, temp
SQLite DB, ephemeral port, headless Chromium):

```
node server_backend/tests/quickImageToolbarGate.test.cjs
```

Prerequisites: repo dependencies installed (`playwright-core` is a declared
dependency) and a Chromium binary (`CHROMIUM_PATH` env or a standard system
path). Exit code 2 = environment prerequisite missing (honest UNVERIFIED).

Verified live:

- exactly 5 action buttons (`[data-qtb-action="true"]`) + collapse handle;
- collapse hides all actions, expand restores them;
- bounding-box intersection with the image = **0px** (never occludes);
- 5 rapid variant clicks → **1** generate request; 4 rapid pin clicks → **1**
  toggle; distinct clicks after the window work normally;
- save preset double-click → **1** POST + saved state;
- download menu offers PNG (original) and WebP (`?format=webp`); WebP
  download starts via native anchor with no navigation;
- **0** page reloads, **0** console errors, **0** page errors;
- **0** requests matching mask/SAM/segment/inpaint/rembg/onnx — no Phase 2+
  library bytes ship.

## 5. Phase 2-4 Reference (NOT BUILT — summary only)

| Phase | Scope (reference) | Key acceptance (per annex) |
| --- | --- | --- |
| 2 | Masking + Lazy SAM, inpainting, outpainting, local processing (rembg, Sharp, 4K), live text | SAM loads 0 bytes until clicked; AbortController cancels; 60 FPS brush; 0% pixel-diff outside mask; $0 local processing; RTL/LTR safe-zone outpaint; <200ms live text preview; split before/after + undo/redo from local cache |
| 3-4 | Send-to-UI bridge, undo/redo version tree, brand vault, localized export | naturalWidth>0 handoff; WCAG scrim; palette→design tokens; version tree restore; AR/EN/Dual + 300 DPI export; `toolbar_action_telemetry` |

Reference routes for those phases (`POST /api/v1/images/:assetId/inpaint`,
`/outpaint`, `/local-process`, typography composite, `extract-tokens`, vault,
`localize-export`) and the `toolbar_action_telemetry` table are documented in
the annex as **reference-only — DO NOT EXECUTE** in Phase 1.

## 6. Freeze Compliance

- Phase-1 frozen tables/routes untouched; cost ledger, OCR gate, router,
  enhancer behave exactly as in the vertical-slice round.
- Regression evidence this round: Phase-1 Vertical Slice 13/13, Bilingual
  Typography 21/21, lint + `tsc --noEmit` clean, platform verification
  pipeline steps 1-30 green (see delivery report for the one pre-existing,
  unrelated pipeline note).
