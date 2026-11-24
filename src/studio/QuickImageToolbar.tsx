/**
 * Quick Image Toolbar — Phase 1 Mini (official annex: "Quick Image Toolbar").
 *
 * Phase-1 scope rule (feature freeze intact): exactly FIVE actions in a
 * collapsible floating bar that never occludes the image, built exclusively
 * on existing endpoints, state, and libraries:
 *
 *   1. Toggle quick controls (show/hide the Layer-2 ControlsBar)
 *   2. Generate variant (same brief, fresh style seed via /api/studio/generate)
 *   3. Save as custom preset (POST /api/studio/presets/custom)
 *   4. Pin / unpin the active candidate (local compare state)
 *   5. Download original PNG or optimized WebP (/api/studio/assets/:id/file)
 *
 * Zero new tables, zero new routes, zero new libraries. The full 10-layer
 * toolbar (masking/SAM, inpainting, outpainting, live text, version tree,
 * brand vault, 300 DPI export) is Phase 2+ reference material and is NOT
 * loaded here — no mask/SAM bytes ship in this bundle.
 *
 * English-only code: every user-facing string arrives via the `labels` prop
 * from the server i18n, matching the rest of the studio panel.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioAsset } from './studioApi';
import { studioApi } from './studioApi';

/* --------------------------------- Labels --------------------------------- */
export interface QuickImageToolbarLabels {
  toggle_controls: string;
  generate_variant: string;
  save_preset: string;
  save_preset_done: string;
  pin: string;
  unpin: string;
  download: string;
  download_png: string;
  download_webp: string;
  collapse: string;
  expand: string;
}

/* -------------------------------- Component ------------------------------- */

export interface QuickImageToolbarProps {
  asset: StudioAsset;
  pinned: boolean;
  busy: boolean;
  controlsVisible: boolean;
  onToggleControls: () => void;
  onVariant: () => void;
  onTogglePin: () => void;
  labels: QuickImageToolbarLabels;
}

/** Double-click debounce window for every toolbar action. */
export const TOOLBAR_DEBOUNCE_MS = 400;

/** Reserved canvas top band (px) so the floating bar never covers the image. */
export const TOOLBAR_INSET_PX = 56;

const ACTION_BTN =
  'flex h-8 w-8 items-center justify-center rounded-full text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * Collapsible floating mini toolbar (Phase 1): five actions only, double-click
 * debounce lock on every action, zero page reloads (downloads use native
 * same-origin anchor downloads, everything else is pure state or fetch).
 */
export function QuickImageToolbar({
  asset, pinned, busy, controlsVisible,
  onToggleControls, onVariant, onTogglePin, labels,
}: QuickImageToolbarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const lockRef = useRef<Record<string, number>>({});
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  // Reset transient save state when switching candidates.
  useEffect(() => { setSaved(false); setDownloadOpen(false); }, [asset.id]);

  /** Per-action debounce guard: swallows repeat clicks on the SAME action
   *  inside TOOLBAR_DEBOUNCE_MS while never blocking a different action. */
  const guarded = useCallback((key: string, fn: () => void) => () => {
    const now = Date.now();
    if (now < (lockRef.current[key] || 0)) return;
    lockRef.current[key] = now + TOOLBAR_DEBOUNCE_MS;
    fn();
  }, []);

  const savePreset = useCallback(async () => {
    setSaving(true);
    try {
      const name = `custom-${asset.preset || 'style'}-${Date.now().toString(36)}`;
      await studioApi.saveCustomPreset(asset.id, name);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [asset.id, asset.preset]);

  if (collapsed) {
    return (
      <div className="pointer-events-auto mt-2" data-testid="quick-image-toolbar" data-collapsed="true">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={labels.expand}
          aria-expanded="false"
          title={labels.expand}
          className="flex h-7 items-center rounded-full bg-neutral-900/85 px-3 text-xs text-neutral-200 shadow-lg ring-1 ring-white/10 backdrop-blur hover:bg-neutral-800"
          data-testid="qtb-collapse"
        >
          ▾
        </button>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-auto mt-2 flex items-center gap-1 rounded-full bg-neutral-900/85 px-2 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur"
      data-testid="quick-image-toolbar"
      data-collapsed="false"
    >
      {/* 1 — Quick controls toggle */}
      <button
        type="button"
        onClick={guarded('controls', onToggleControls)}
        aria-label={labels.toggle_controls}
        aria-pressed={controlsVisible}
        title={labels.toggle_controls}
        className={`${ACTION_BTN} ${controlsVisible ? 'bg-neutral-800 text-emerald-300' : ''}`}
        data-testid="qtb-controls"
        data-qtb-action="true"
      >
        ☰
      </button>

      {/* 2 — Generate variant (fresh seed, same brief) */}
      <button
        type="button"
        onClick={guarded('variant', onVariant)}
        disabled={busy}
        aria-label={labels.generate_variant}
        title={labels.generate_variant}
        className={ACTION_BTN}
        data-testid="qtb-variant"
        data-qtb-action="true"
      >
        ↻
      </button>

      {/* 3 — Save as custom preset */}
      <button
        type="button"
        onClick={guarded('save', () => { void savePreset(); })}
        disabled={saving || saved}
        aria-label={saved ? labels.save_preset_done : labels.save_preset}
        title={saved ? labels.save_preset_done : labels.save_preset}
        className={`${ACTION_BTN} ${saved ? 'text-emerald-400' : ''}`}
        data-testid="qtb-save-preset"
        data-qtb-action="true"
      >
        {saved ? '✓' : '✚'}
      </button>

      {/* 4 — Pin / unpin */}
      <button
        type="button"
        onClick={guarded('pin', onTogglePin)}
        aria-label={pinned ? labels.unpin : labels.pin}
        aria-pressed={pinned}
        title={pinned ? labels.unpin : labels.pin}
        className={`${ACTION_BTN} ${pinned ? 'text-emerald-400' : ''}`}
        data-testid="qtb-pin"
        data-qtb-action="true"
      >
        {pinned ? '★' : '☆'}
      </button>

      {/* 5 — Download (original PNG or optimized WebP, native anchor download) */}
      <div className="relative">
        <button
          type="button"
          onClick={guarded('download', () => setDownloadOpen((v) => !v))}
          aria-label={labels.download}
          aria-expanded={downloadOpen}
          title={labels.download}
          className={ACTION_BTN}
          data-testid="qtb-download"
          data-qtb-action="true"
        >
          ⬇
        </button>
        {downloadOpen && (
          <div
            className="absolute left-1/2 top-full z-30 mt-1 flex -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-neutral-900 text-xs text-neutral-200 shadow-lg ring-1 ring-white/10"
            data-testid="qtb-download-menu"
          >
            <a
              href={studioApi.assetFileUrl(asset.id)}
              download={`${asset.id}.png`}
              onClick={() => setDownloadOpen(false)}
              className="px-3 py-1.5 hover:bg-neutral-700"
              data-testid="qtb-download-png"
            >
              {labels.download_png}
            </a>
            <a
              href={studioApi.assetFileUrl(asset.id, 'webp')}
              download={`${asset.id}.webp`}
              onClick={() => setDownloadOpen(false)}
              className="px-3 py-1.5 hover:bg-neutral-700"
              data-testid="qtb-download-webp"
            >
              {labels.download_webp}
            </a>
          </div>
        )}
      </div>

      {/* Collapse handle (shell chrome, not one of the five actions) */}
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        aria-label={labels.collapse}
        aria-expanded="true"
        title={labels.collapse}
        className="flex h-8 w-5 items-center justify-center rounded-full text-xs text-neutral-400 hover:bg-neutral-700"
        data-testid="qtb-collapse"
      >
        ▴
      </button>
    </div>
  );
}
