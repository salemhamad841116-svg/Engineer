/**
 * UI Builder Mode — Layers 4 & 5 (client half).
 *
 * Sandboxed live preview (isolated iframe, 0 full-page reloads) with:
 *  - viewport switcher (Mobile 390 / Tablet 768 / Desktop 1440)
 *  - RTL/LTR and Dark/Light/Glass switching via the preview bridge
 *  - Live DOM Inspector: hover highlight + click-to-select (postMessage)
 *  - Zero-Cost Direct Property Panel (text/color/padding/margin/font-size)
 *  - Quick Asset Modal trigger on image click (asset-select)
 *  - SSE build-stage progress (plan→synthesize→assets→audit→ready)
 *
 * Every visible string arrives via the `labels` prop — zero hard-coded
 * Arabic (100% English Codebase gate).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  studioApi, UiBuild, UiBridgeCommand, UiBridgeEvent,
} from './studioApi';

export interface UIBuilderLabels {
  title: string;
  build: string;
  building: string;
  promptPlaceholder: string;
  viewportMobile: string;
  viewportTablet: string;
  viewportDesktop: string;
  directionToggle: string;
  themeToggle: string;
  inspectToggle: string;
  properties: string;
  propText: string;
  propColor: string;
  propBackground: string;
  propPadding: string;
  propFontSize: string;
  apply: string;
  selectedNone: string;
  statusReady: string;
  statusFailed: string;
  statusUnverified: string;
  healBadge: string;
  assetFallbacks: string;
  regenerateAsset: string;
}

export interface UIBuilderPanelProps {
  labels: UIBuilderLabels;
  lang: 'ar' | 'en';
  projectId?: string;
  onBuildComplete?: (build: UiBuild) => void;
}

const VIEWPORTS = [
  { id: 'mobile', width: 390 },
  { id: 'tablet', width: 768 },
  { id: 'desktop', width: 1440 },
] as const;

type ViewportId = (typeof VIEWPORTS)[number]['id'];
type ThemeId = 'dark' | 'light' | 'glass';

export function UIBuilderPanel({ labels, lang, projectId, onBuildComplete }: UIBuilderPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [build, setBuild] = useState<UiBuild | null>(null);
  const [viewport, setViewport] = useState<ViewportId>('desktop');
  const [dir, setDir] = useState<'rtl' | 'ltr'>(lang === 'en' ? 'ltr' : 'rtl');
  const [theme, setTheme] = useState<ThemeId>('dark');
  const [inspecting, setInspecting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [propValue, setPropValue] = useState('');
  const [propKind, setPropKind] = useState<'text' | 'color' | 'background-color' | 'padding' | 'font-size'>('text');
  const [stages, setStages] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const post = useCallback((cmd: UiBridgeCommand) => {
    iframeRef.current?.contentWindow?.postMessage(cmd, '*');
  }, []);

  /* Bridge events from the sandboxed preview. */
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as UiBridgeEvent | undefined;
      if (!m || m.ns !== 'uib') return;
      if (m.type === 'select') setSelected(m.id);
      if (m.type === 'asset-select') setSelected(`asset:${m.slot}`);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /* SSE stage telemetry while a build runs. */
  useEffect(() => {
    if (!build) return undefined;
    const src = new EventSource(studioApi.uiEventsUrl(build.id));
    src.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as { stage?: string };
        if (evt.stage) setStages((s) => (s[s.length - 1] === evt.stage ? s : [...s, evt.stage as string]));
      } catch { /* malformed event — ignore */ }
    };
    return () => src.close();
  }, [build?.id]);

  useEffect(() => { post({ ns: 'uib', type: 'inspect', on: inspecting }); }, [inspecting, post, build]);
  useEffect(() => { post({ ns: 'uib', type: 'theme', theme }); }, [theme, post, build]);
  useEffect(() => { post({ ns: 'uib', type: 'dir', dir }); }, [dir, post, build]);

  const startBuild = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setStages([]);
    setSelected(null);
    try {
      const b = await studioApi.buildUi({ message: prompt, lang, project_id: projectId });
      setBuild(b as UiBuild);
      onBuildComplete?.(b as UiBuild);
    } finally {
      setBusy(false);
    }
  };

  const applyProp = async () => {
    if (!build || !selected || selected.startsWith('asset:') || !propValue) return;
    await studioApi.uiPropPatch(build.id, { data_ui_id: selected, prop: propKind, value: propValue });
    if (propKind === 'text') post({ ns: 'uib', type: 'set-text', id: selected, value: propValue });
    else post({ ns: 'uib', type: 'set-prop', id: selected, prop: propKind, value: propValue });
    setPropValue('');
  };

  const statusLabel = useMemo(() => {
    if (!build) return '';
    if (build.status === 'READY') return labels.statusReady;
    if (build.status === 'UNVERIFIED') return labels.statusUnverified;
    return labels.statusFailed;
  }, [build, labels]);

  const width = VIEWPORTS.find((v) => v.id === viewport)?.width ?? 1440;

  return (
    <div className="ui-builder" data-testid="ui-builder-panel" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="ui-builder-toolbar">
        <strong>{labels.title}</strong>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={labels.promptPlaceholder}
          aria-label={labels.promptPlaceholder}
        />
        <button onClick={startBuild} disabled={busy}>{busy ? labels.building : labels.build}</button>
      </div>

      <div className="ui-builder-switchbar">
        {VIEWPORTS.map((v) => (
          <button
            key={v.id}
            data-active={viewport === v.id}
            onClick={() => setViewport(v.id)}
          >
            {v.id === 'mobile' ? labels.viewportMobile : v.id === 'tablet' ? labels.viewportTablet : labels.viewportDesktop}
          </button>
        ))}
        <button onClick={() => setDir(dir === 'rtl' ? 'ltr' : 'rtl')}>{labels.directionToggle} {dir.toUpperCase()}</button>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'glass' : 'dark')}>
          {labels.themeToggle}: {theme}
        </button>
        <button data-active={inspecting} onClick={() => setInspecting(!inspecting)}>{labels.inspectToggle}</button>
      </div>

      {stages.length > 0 && (
        <div className="ui-builder-stages" data-testid="ui-build-stages">{stages.join(' → ')}</div>
      )}

      <div className="ui-builder-body">
        <div className="ui-builder-preview" style={{ display: 'grid', placeItems: 'center' }}>
          {build ? (
            <iframe
              ref={iframeRef}
              title="ui-preview"
              data-testid="ui-preview-frame"
              sandbox="allow-scripts"
              src={studioApi.uiPreviewUrl(build.id)}
              style={{ width, height: 640, border: '1px solid var(--ui-border, #ccc)', borderRadius: 8 }}
            />
          ) : (
            <div className="ui-builder-empty">{labels.selectedNone}</div>
          )}
        </div>

        <aside className="ui-builder-props" data-testid="ui-prop-panel">
          <h4>{labels.properties}</h4>
          {build && <p>{statusLabel}{build.heal_used ? ` · ${labels.healBadge}` : ''}</p>}
          {build?.gates.assets && build.gates.assets.fallbacks > 0 && (
            <p>{labels.assetFallbacks}: {build.gates.assets.fallbacks}
              <button>{labels.regenerateAsset}</button>
            </p>
          )}
          {selected && !selected.startsWith('asset:') ? (
            <>
              <code>{selected}</code>
              <select value={propKind} onChange={(e) => setPropKind(e.target.value as typeof propKind)}>
                <option value="text">{labels.propText}</option>
                <option value="color">{labels.propColor}</option>
                <option value="background-color">{labels.propBackground}</option>
                <option value="padding">{labels.propPadding}</option>
                <option value="font-size">{labels.propFontSize}</option>
              </select>
              <input value={propValue} onChange={(e) => setPropValue(e.target.value)} />
              <button onClick={applyProp}>{labels.apply}</button>
            </>
          ) : (
            <p>{labels.selectedNone}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export default UIBuilderPanel;
