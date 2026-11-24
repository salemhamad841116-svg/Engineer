/**
 * Image Studio Panel — Image Mode Phase 1 (Layers 1+2).
 *
 * Layer 1 (Adaptive Canvas): split-view studio that mounts when the router
 * decides an image intent — pure state switch, zero page reloads. Includes
 * zoom/pan/fit inspection, UI safe-zone & grid overlays, and a 2-4 candidate
 * gallery strip with pin/compare.
 *
 * Layer 2 (Visual Prompting): aspect-ratio bar, seed lock, protected brand
 * text input (verbatim to the generation payload), and reference-image
 * upload (drag & drop, product/style).
 *
 * English-only code: every user-facing string arrives via the `labels`
 * prop from the server i18n. Mounted in Phase 3; type-checked today.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StudioAsset, GenerateRequest } from './studioApi';
import { studioApi } from './studioApi';
import type { QuickImageToolbarLabels } from './QuickImageToolbar';
import { QuickImageToolbar, TOOLBAR_INSET_PX } from './QuickImageToolbar';

/* --------------------------------- Labels --------------------------------- */
export interface ImageStudioLabels {
  studio_title: string;
  fit: string;
  grid: string;
  safe_zone: string;
  candidates: string;
  pin: string;
  unpin: string;
  aspect_ratio: string;
  seed_lock: string;
  seed_unlock: string;
  seed_hint: string;
  protected_text: string;
  protected_text_hint: string;
  reference_upload: string;
  reference_style: string;
  reference_product: string;
  reference_ready: string;
  generate: string;
  generating: string;
  empty_state: string;
  cache_hit: string;
  stage_enhance: string;
  stage_generate: string;
  stage_ocr: string;
  stage_postprocess: string;
  stage_ready: string;
  stage_failed: string;
  chat_placeholder: string;
  toolbar: QuickImageToolbarLabels;
}

/* ------------------------------ StudioCanvas ------------------------------ */

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export interface CanvasProps {
  asset: StudioAsset | null;
  labels: ImageStudioLabels;
  /** Reserved top band (px) so a floating overlay never occludes the image. */
  topInsetPx?: number;
  /** Floating overlay (e.g. the Quick Image Toolbar), top-centered. */
  overlay?: React.ReactNode;
}

/** Zoomable/pannable inspection canvas with grid + safe-zone overlays. */
export function StudioCanvas({ asset, labels, topInsetPx = 0, overlay }: CanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => { setZoom(1); setOffset({ x: 0, y: 0 }); }, [asset?.id]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const src = asset ? studioApi.assetFileUrl(asset.id, 'webp') : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-neutral-950" data-testid="studio-canvas">
      {src ? (
        <div
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <img
            src={src}
            alt={asset?.prompt_en || ''}
            draggable={false}
            className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none"
            style={{
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
              ...(topInsetPx > 0
                ? { top: `calc(50% + ${topInsetPx / 2}px)`, maxHeight: `calc(100% - ${topInsetPx}px)` }
                : {}),
            }}
            data-testid="canvas-image"
          />
          {showGrid && (
            <div
              className="pointer-events-none absolute inset-0 opacity-25"
              data-testid="grid-overlay"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
              }}
            />
          )}
          {showSafeZone && (
            <div className="pointer-events-none absolute inset-[8%] rounded border-2 border-dashed border-emerald-400/70" data-testid="safezone-overlay">
              <div className="absolute left-4 top-4 h-6 w-1/3 rounded bg-emerald-400/20" />
              <div className="absolute bottom-4 right-4 h-8 w-24 rounded bg-emerald-400/20" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-neutral-500" data-testid="canvas-empty">
          {labels.empty_state}
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex gap-2">
        <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
          className="rounded bg-neutral-800/90 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          data-testid="fit-button">
          {labels.fit} · {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => setShowGrid((v) => !v)}
          className={`rounded px-3 py-1 text-xs ${showGrid ? 'bg-emerald-700 text-white' : 'bg-neutral-800/90 text-neutral-200 hover:bg-neutral-700'}`}
          data-testid="grid-toggle">
          {labels.grid}
        </button>
        <button type="button" onClick={() => setShowSafeZone((v) => !v)}
          className={`rounded px-3 py-1 text-xs ${showSafeZone ? 'bg-emerald-700 text-white' : 'bg-neutral-800/90 text-neutral-200 hover:bg-neutral-700'}`}
          data-testid="safezone-toggle">
          {labels.safe_zone}
        </button>
      </div>

      {overlay && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center" data-testid="canvas-overlay">
          {overlay}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- CandidateStrip ----------------------------- */

export interface CandidateStripProps {
  assets: StudioAsset[];
  activeId: string | null;
  pinnedIds: Set<string>;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  labels: ImageStudioLabels;
}

/** 2-4 candidate gallery strip: instant switch + pin for comparison. */
export function CandidateStrip({ assets, activeId, pinnedIds, onSelect, onTogglePin, labels }: CandidateStripProps) {
  if (!assets.length) return null;
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-2" data-testid="candidate-strip">
      <span className="shrink-0 text-xs text-neutral-400">{labels.candidates}</span>
      {assets.map((a, i) => (
        <div key={a.id} className="relative shrink-0">
          <button
            type="button"
            onClick={() => onSelect(a.id)}
            className={`block h-16 w-16 overflow-hidden rounded-lg border-2 ${a.id === activeId ? 'border-emerald-400' : 'border-transparent opacity-70 hover:opacity-100'}`}
            data-testid={`candidate-${i}`}
          >
            <img src={studioApi.assetFileUrl(a.id, 'webp')} alt={`candidate ${i + 1}`} className="h-full w-full object-cover" />
          </button>
          <button
            type="button"
            onClick={() => onTogglePin(a.id)}
            title={pinnedIds.has(a.id) ? labels.unpin : labels.pin}
            className={`absolute -top-1 -end-1 h-5 w-5 rounded-full text-[10px] leading-5 ${pinnedIds.has(a.id) ? 'bg-emerald-500 text-white' : 'bg-neutral-700 text-neutral-300'}`}
            data-testid={`pin-${i}`}
          >
            {pinnedIds.has(a.id) ? '★' : '☆'}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ ControlsBar ------------------------------- */

const ASPECT_CHOICES = ['1:1', '16:9', '9:16', '4:5', '21:9'];

export interface ControlsProps {
  aspect: string;
  onAspect: (a: string) => void;
  seedLocked: boolean;
  seed: string;
  onToggleSeedLock: () => void;
  protectedText: string;
  onProtectedText: (t: string) => void;
  referenceId: string | null;
  onReference: (id: string | null) => void;
  labels: ImageStudioLabels;
}

/** Layer 2 controls: aspect bar, seed lock, protected text, reference upload. */
export function ControlsBar(props: ControlsProps) {
  const { labels } = props;
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File | undefined, role: 'style' | 'product') => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    const ref = await studioApi.uploadReference(btoa(binary), role);
    props.onReference(ref.id);
  }, [props]);

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-neutral-900 p-3" data-testid="controls-bar">
      {/* Aspect ratio bar */}
      <div className="flex items-center gap-1" data-testid="aspect-bar">
        <span className="me-2 text-xs text-neutral-400">{labels.aspect_ratio}</span>
        {ASPECT_CHOICES.map((a) => (
          <button key={a} type="button" onClick={() => props.onAspect(a)}
            className={`rounded px-2 py-1 text-xs ${props.aspect === a ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
            data-testid={`aspect-${a.replace(':', 'x')}`}>
            {a}
          </button>
        ))}
      </div>

      {/* Seed lock */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={props.onToggleSeedLock}
          className={`rounded px-3 py-1 text-xs ${props.seedLocked ? 'bg-amber-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
          data-testid="seed-lock-toggle"
          title={labels.seed_hint}>
          {props.seedLocked ? labels.seed_lock : labels.seed_unlock}
        </button>
        {props.seedLocked && <code className="text-xs text-amber-300" data-testid="seed-value">{props.seed}</code>}
      </div>

      {/* Protected brand text — verbatim, never translated */}
      <div>
        <label className="mb-1 block text-xs text-neutral-400" htmlFor="protected-brand-text">
          {labels.protected_text}
        </label>
        <input
          id="protected-brand-text"
          value={props.protectedText}
          onChange={(e) => props.onProtectedText(e.target.value)}
          placeholder={labels.protected_text_hint}
          maxLength={80}
          className="w-full rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-emerald-500"
          data-testid="protected-text-input"
        />
      </div>

      {/* Reference upload (drag & drop) */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFile(e.dataTransfer.files?.[0], 'style'); }}
        className={`rounded-lg border-2 border-dashed p-3 text-center text-xs ${dragOver ? 'border-emerald-400 bg-emerald-950/40' : 'border-neutral-700 text-neutral-400'}`}
        data-testid="reference-dropzone"
      >
        {props.referenceId ? (
          <span className="text-emerald-400" data-testid="reference-ready">✓ {labels.reference_ready}</span>
        ) : (
          <>
            <p>{labels.reference_upload}</p>
            <div className="mt-2 flex justify-center gap-2">
              <button type="button" className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
                onClick={() => { fileRef.current?.setAttribute('data-role', 'style'); fileRef.current?.click(); }}
                data-testid="reference-style-btn">
                {labels.reference_style}
              </button>
              <button type="button" className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
                onClick={() => { fileRef.current?.setAttribute('data-role', 'product'); fileRef.current?.click(); }}
                data-testid="reference-product-btn">
                {labels.reference_product}
              </button>
            </div>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-testid="reference-file-input"
          onChange={(e) => {
            const role = (e.currentTarget.getAttribute('data-role') === 'product' ? 'product' : 'style') as 'style' | 'product';
            void handleFile(e.target.files?.[0], role);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}

/* ---------------------------- ImageStudioPanel ---------------------------- */

export interface ImageStudioPanelProps {
  labels: ImageStudioLabels;
  buildRequest: () => Omit<GenerateRequest, 'candidates' | 'aspect' | 'style_seed' | 'protected_brand_text' | 'reference_id'>;
  candidates?: number;
}

const newSeed = () => Math.random().toString(16).slice(2, 14);

/** Adaptive image studio: canvas + candidates + controls, one panel. */
export function ImageStudioPanel({ labels, buildRequest, candidates = 2 }: ImageStudioPanelProps) {
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [aspect, setAspect] = useState('1:1');
  const [seedLocked, setSeedLocked] = useState(false);
  const [seed, setSeed] = useState(newSeed);
  const [protectedText, setProtectedText] = useState('');
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const active = useMemo(() => assets.find((a) => a.id === activeId) || assets[0] || null, [assets, activeId]);

  const generate = useCallback(async (seedOverride?: string) => {
    setBusy(true);
    try {
      const req: GenerateRequest = {
        ...buildRequest(),
        candidates: Math.min(4, Math.max(2, candidates)),
        aspect,
        protected_brand_text: protectedText || undefined,
        reference_id: referenceId || undefined,
        style_seed: seedOverride ?? (seedLocked ? seed : undefined),
      };
      const res = await studioApi.generateCandidates(req as GenerateRequest & { candidates: number });
      setAssets(res.assets);
      setActiveId(res.assets[0]?.id ?? null);
      if (!seedLocked) setSeed(res.assets[0]?.style_seed || newSeed());
    } finally {
      setBusy(false);
    }
  }, [buildRequest, candidates, aspect, protectedText, referenceId, seedLocked, seed]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col gap-3" data-testid="image-studio-panel">
      <div className="min-h-0 flex-1">
        <StudioCanvas
          asset={active}
          labels={labels}
          topInsetPx={TOOLBAR_INSET_PX}
          overlay={active ? (
            <QuickImageToolbar
              asset={active}
              pinned={pinnedIds.has(active.id)}
              busy={busy}
              controlsVisible={controlsVisible}
              onToggleControls={() => setControlsVisible((v) => !v)}
              onVariant={() => void generate(newSeed())}
              onTogglePin={() => togglePin(active.id)}
              labels={labels.toolbar}
            />
          ) : undefined}
        />
      </div>
      <CandidateStrip
        assets={assets}
        activeId={active?.id ?? null}
        pinnedIds={pinnedIds}
        onSelect={setActiveId}
        onTogglePin={togglePin}
        labels={labels}
      />
      {controlsVisible && (
        <ControlsBar
          aspect={aspect}
          onAspect={setAspect}
          seedLocked={seedLocked}
          seed={seed}
          onToggleSeedLock={() => setSeedLocked((v) => !v)}
          protectedText={protectedText}
          onProtectedText={setProtectedText}
          referenceId={referenceId}
          onReference={setReferenceId}
          labels={labels}
        />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void generate()}
        className="rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        data-testid="generate-button"
      >
        {busy ? labels.generating : labels.generate}
      </button>
    </div>
  );
}

/* ----------------------------- AdaptiveStudio ----------------------------- */

export interface AdaptiveStudioProps {
  mode: 'image' | 'ui' | 'hybrid' | 'chat' | null;
  labels: ImageStudioLabels;
  buildRequest: ImageStudioPanelProps['buildRequest'];
  children?: React.ReactNode; // chat thread stays mounted beside the studio
}

/**
 * Adaptive split-screen (Layer 1): the preview area becomes the image
 * studio when the router says image intent — a pure state switch with
 * zero page reloads; the conversation stays open and synchronized.
 */
export function AdaptiveStudio({ mode, labels, buildRequest, children }: AdaptiveStudioProps) {
  const imageMode = mode === 'image' || mode === 'hybrid';
  return (
    <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-2" data-testid="adaptive-studio">
      <div className="min-h-0" data-testid="chat-pane">{children}</div>
      <div className="min-h-0" data-testid="studio-pane">
        {imageMode ? (
          <ImageStudioPanel labels={labels} buildRequest={buildRequest} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl bg-neutral-900 text-sm text-neutral-500" data-testid="studio-idle">
            {labels.chat_placeholder}
          </div>
        )}
      </div>
    </div>
  );
}
