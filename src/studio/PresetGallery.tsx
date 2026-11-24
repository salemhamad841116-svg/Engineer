/**
 * PresetGallery — Smart Presets UI (Layer 3 of the preset subsystem).
 *
 * - Visual thumbnail cards (real SVG palette cards from the API)
 * - Interactive auto-detected badge with [Change] action
 * - Contextual sub-modifier bar that re-renders per selected preset
 * - Three-step intensity control (subtle / balanced / strong)
 *
 * All user-facing labels arrive from the server (i18n), this component
 * contains no hard-coded Arabic strings.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  studioApi, StudioAsset, StudioPreset, PresetGalleryResponse, GenerateRequest,
} from './studioApi';

interface Props {
  projectId?: string;
  message: string; // current user prompt — drives auto-detect badge
  onGenerated?: (asset: StudioAsset) => void;
}

export function PresetGallery({ message, projectId, onGenerated }: Props) {
  const [gallery, setGallery] = useState<PresetGalleryResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null); // null = auto
  const [modifiers, setModifiers] = useState<Record<string, string>>({});
  const [intensity, setIntensity] = useState<'subtle' | 'balanced' | 'strong'>('balanced');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAsset, setLastAsset] = useState<StudioAsset | null>(null);

  useEffect(() => {
    studioApi.presets('ar').then(setGallery).catch((e: Error) => setError(e.message));
  }, []);

  const selected: StudioPreset | null = useMemo(
    () => gallery?.presets.find((p) => p.id === selectedId) ?? null,
    [gallery, selectedId],
  );

  // Modifier bar re-renders per preset: reset choices when the preset changes.
  useEffect(() => {
    setModifiers({});
  }, [selectedId]);

  async function generate() {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const req: GenerateRequest = {
        message,
        project_id: projectId,
        modifiers: Object.keys(modifiers).length ? modifiers : undefined,
        intensity,
      };
      if (selectedId) req.preset_id = selectedId;
      const asset = await studioApi.generate(req);
      setLastAsset(asset);
      onGenerated?.(asset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !gallery) return <div className="text-red-500 text-sm">{error}</div>;
  if (!gallery) return null;

  return (
    <div className="flex flex-col gap-3" dir="rtl">
      {/* Thumbnail cards */}
      <div className="grid grid-cols-3 gap-2">
        {gallery.presets.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`preset-card-${p.id}`}
            onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
            className={`rounded-lg border text-right transition ${selectedId === p.id ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-zinc-700'}`}
          >
            <img src={p.thumbnail_url} alt={p.label} className="w-full rounded-t-lg" loading="lazy" />
            <div className="p-2 text-xs">{p.label}</div>
          </button>
        ))}
      </div>

      {/* Auto-detected badge (changeable) */}
      {lastAsset?.badge && (
        <div className="flex items-center gap-2 text-xs rounded-full bg-amber-500/15 text-amber-400 px-3 py-1 w-fit" data-testid="auto-detect-badge">
          <span>{gallery.badge.auto_detected}: {lastAsset.preset}</span>
          <button type="button" className="underline" onClick={() => setLastAsset(null)}>
            {gallery.badge.change}
          </button>
        </div>
      )}

      {/* Contextual sub-modifiers (per selected preset) */}
      {selected?.modifiers.map((m) => (
        <div key={m.id} className="flex items-center gap-2 text-xs">
          <span className="text-zinc-400">{m.label}:</span>
          {m.options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid={`modifier-${m.id}-${o.id}`}
              onClick={() => setModifiers((prev) => ({ ...prev, [m.id]: o.id }))}
              className={`rounded-full px-2.5 py-1 border ${modifiers[m.id] === o.id ? 'bg-indigo-600 border-indigo-500' : 'border-zinc-700'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ))}

      {/* Intensity */}
      <div className="flex items-center gap-2 text-xs">
        {gallery.intensity_levels.map((l) => (
          <button
            key={l.id}
            type="button"
            data-testid={`intensity-${l.id}`}
            onClick={() => setIntensity(l.id as 'subtle' | 'balanced' | 'strong')}
            className={`rounded-full px-2.5 py-1 border ${intensity === l.id ? 'bg-indigo-600 border-indigo-500' : 'border-zinc-700'}`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={generate}
        disabled={busy || !message.trim()}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? '…' : 'Generate'}
      </button>

      {error && <div className="text-red-500 text-xs">{error}</div>}
      {lastAsset?.artifact_url && (
        <img src={lastAsset.artifact_url} alt={lastAsset.preset ?? ''} className="rounded-lg max-w-sm" />
      )}
    </div>
  );
}
