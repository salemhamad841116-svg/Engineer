/**
 * Smart Studio API client — typed contract for the preset subsystem.
 * English-only code; Arabic labels arrive from the server (?lang=ar).
 */

export interface StudioPresetOption {
  id: string;
  label: string;
}

export interface StudioPresetModifier {
  id: string;
  label: string;
  options: StudioPresetOption[];
}

export interface StudioPreset {
  id: string;
  label: string;
  category: string;
  default_aspect: string;
  alt_aspects: string[];
  ocr_gate: 'off' | 'always' | 'on_text_detected';
  palette: string[];
  thumbnail_url: string;
  modifiers: StudioPresetModifier[];
}

export interface PresetGalleryResponse {
  presets: StudioPreset[];
  intensity_levels: StudioPresetOption[];
  badge: { auto_detected: string; change: string };
}

export type StudioAssetState = 'RUNNING' | 'READY' | 'UNVERIFIED' | 'QUALITY_GATE_FAILED' | 'FAILED';

export interface StudioAsset {
  id: string;
  state: StudioAssetState;
  preset: string | null;
  aspect: string;
  prompt_en: string;
  ocr_coverage: number | null;
  ocr_gate_mode: string;
  palette: string[];
  style_seed: string | null;
  modifiers: Record<string, string>;
  intensity: 'subtle' | 'balanced' | 'strong';
  auto_detected: boolean;
  badge: { type: 'auto_detected'; preset: string | null } | null;
  artifact_url: string | null;
  error_code: string | null;
  error_summary: string | null;
}

export interface GenerateRequest {
  message: string;
  preset_id?: string;
  custom_preset_id?: string;
  project_id?: string;
  modifiers?: Record<string, string>;
  intensity?: 'subtle' | 'balanced' | 'strong';
  aspect?: string;
  candidates?: number;
  reference_id?: string;
  style_seed?: string;
  protected_brand_text?: string;
}

export interface GenerateBatchResponse {
  group: string;
  assets: StudioAsset[];
}

export interface StudioReference {
  id: string;
  role: 'style' | 'product';
  hash: string;
  mime: string;
  bytes: number;
  created_at: string;
}

export type PipelineStage =
  | 'enhance' | 'generate' | 'ocr' | 'postprocess'
  | 'ready' | 'unverified' | 'failed';

export interface PipelineEvent {
  stage: PipelineStage;
  at: string;
  attempt?: number;
  code?: string;
}

export type RouterIntent =
  | 'image_generate' | 'image_edit'
  | 'ui_generate' | 'ui_edit'
  | 'hybrid_ui_with_assets' | 'chat_consult';

export interface RouteResponse {
  status: 'routed' | 'ambiguous';
  routing_id: string;
  intent: RouterIntent;
  confidence: number;
  model_tier: 'local' | 'cloud_flash';
  mode: 'image' | 'ui' | 'hybrid' | 'chat';
  provider: string;
  latency_ms: number;
  options?: { id: string; label: string; intent: RouterIntent }[];
  question?: string;
  cost_check: { required: boolean; ok: boolean; remaining: number | null };
  override_badge?: { prefix: string; change: string };
  signals?: { has_mask: boolean; click_target: string | null; attached_image: boolean; preset_id: string | null };
  protected_brand_text?: string | null;
  corrections?: { from: string; to: string }[];
}

export interface RouteRequest {
  message: string;
  session_id?: string;
  project_id?: string;
  signals?: { has_mask?: boolean; click_target?: string; attached_image?: boolean; preset_id?: string };
  answers?: Record<string, string>;
  lang?: 'ar' | 'en';
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const body = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) {
    const err = new Error(body.error?.message || `HTTP ${res.status}`) as Error & { code?: string };
    err.code = body.error?.code;
    throw err;
  }
  return body;
}

export const studioApi = {
  presets: (lang: 'ar' | 'en' = 'ar') => api<PresetGalleryResponse>(`/api/studio/presets?lang=${lang}`),
  route: (req: RouteRequest) =>
    api<RouteResponse>('/api/studio/route', { method: 'POST', body: JSON.stringify(req) }),
  generate: (req: GenerateRequest) =>
    api<StudioAsset>('/api/studio/generate', { method: 'POST', body: JSON.stringify(req) }),
  generateCandidates: (req: GenerateRequest & { candidates: number }) =>
    api<GenerateBatchResponse>('/api/studio/generate', { method: 'POST', body: JSON.stringify(req) }),
  uploadReference: (dataB64: string, role: 'style' | 'product') =>
    api<StudioReference>('/api/studio/references', { method: 'POST', body: JSON.stringify({ data_b64: dataB64, role }) }),
  references: () => api<{ references: StudioReference[] }>('/api/studio/references'),
  saveCustomPreset: (assetId: string, name: string) =>
    api<{ id: string }>('/api/studio/presets/custom', { method: 'POST', body: JSON.stringify({ asset_id: assetId, name }) }),
  setBrandLock: (projectId: string, target: { preset_id?: string; custom_preset_id?: string }) =>
    api<unknown>(`/api/studio/projects/${encodeURIComponent(projectId)}/brand-lock`, { method: 'PUT', body: JSON.stringify(target) }),
  clearBrandLock: (projectId: string) =>
    api<unknown>(`/api/studio/projects/${encodeURIComponent(projectId)}/brand-lock`, { method: 'DELETE' }),
  assetFileUrl: (assetId: string, format?: 'webp') =>
    `/api/studio/assets/${encodeURIComponent(assetId)}/file${format === 'webp' ? '?format=webp' : ''}`,
  assetEventsUrl: (assetId: string) => `/api/studio/assets/${encodeURIComponent(assetId)}/events`,

  /* --------------------- UI Builder Mode (Phase 3) --------------------- */
  buildUi: (req: UiBuildRequest) =>
    api<UiBuild>('/api/studio/ui/build', { method: 'POST', body: JSON.stringify(req) }),
  uiBuilds: (projectId?: string) =>
    api<{ builds: UiBuild[] }>(`/api/studio/ui${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`),
  uiPropPatch: (buildId: string, req: UiPropPatchRequest) =>
    api<{ ms: number; version: number }>(`/api/studio/ui/${encodeURIComponent(buildId)}/prop`, { method: 'POST', body: JSON.stringify(req) }),
  uiSurgicalPatch: (buildId: string, req: UiSurgicalPatchRequest) =>
    api<{ version: number; tier: string }>(`/api/studio/ui/${encodeURIComponent(buildId)}/patch`, { method: 'POST', body: JSON.stringify(req) }),
  uiSwapImage: (buildId: string, req: UiSwapImageRequest) =>
    api<{ version: number; asset_id: string }>(`/api/studio/ui/${encodeURIComponent(buildId)}/swap-image`, { method: 'POST', body: JSON.stringify(req) }),
  uiFromImage: (referenceId: string, lang: 'ar' | 'en' = 'ar') =>
    api<{ analysis: UiVisionAnalysis }>('/api/studio/ui/from-image', { method: 'POST', body: JSON.stringify({ reference_id: referenceId, lang }) }),
  uiPreviewUrl: (buildId: string) => `/api/studio/ui/${encodeURIComponent(buildId)}/file`,
  uiEventsUrl: (buildId: string) => `/api/studio/ui/${encodeURIComponent(buildId)}/events`,
};

/* ------------------------- UI Builder types ---------------------------- */

export type UiBuildStatus = 'READY' | 'UNVERIFIED' | 'FAILED' | 'QUALITY_GATE_FAILED';

export interface UiBuildRequest {
  routing_id?: string;
  message?: string;
  session_id?: string;
  project_id?: string;
  lang?: 'ar' | 'en';
  answers?: Record<string, string>;
}

export interface UiBuild {
  id: string;
  domain: string;
  model_tier: string;
  provider: string;
  status: UiBuildStatus;
  version: number;
  parent_id: string | null;
  lang: 'ar' | 'en';
  heal_used: boolean;
  gates: {
    summary: { pass: boolean; verified: boolean; reasons: string[] } | null;
    assets: { injected: number; fallbacks: number; brokenMarkers: string[] } | null;
    audit: { ran: boolean; status: string; console_errors: string[]; broken_images: string[]; overflow: boolean | null } | null;
    wcag: { pass: boolean; report: { name: string; ratio: number; pass: boolean }[] } | null;
  };
  preview_url: string;
  events_url: string;
  created_at: string;
  updated_at: string;
}

export interface UiPropPatchRequest {
  data_ui_id: string;
  prop: 'color' | 'background-color' | 'padding' | 'margin' | 'font-size' | 'text';
  value: string;
}

export interface UiSurgicalPatchRequest {
  data_ui_id: string;
  instruction: string;
}

export interface UiSwapImageRequest {
  data_ui_asset: string;
  asset_id: string;
}

export interface UiVisionAnalysis {
  layout: string[];
  components: { type: string; purpose: string }[];
  theme: string;
  notes?: string;
}

export type UiBridgeCommand =
  | { ns: 'uib'; type: 'inspect'; on: boolean }
  | { ns: 'uib'; type: 'set-prop'; id: string; prop: string; value: string }
  | { ns: 'uib'; type: 'set-text'; id: string; value: string }
  | { ns: 'uib'; type: 'set-image'; slot: string; src: string }
  | { ns: 'uib'; type: 'theme'; theme: 'dark' | 'light' | 'glass' }
  | { ns: 'uib'; type: 'dir'; dir: 'rtl' | 'ltr' };

export type UiBridgeEvent =
  | { ns: 'uib'; type: 'ready' }
  | { ns: 'uib'; type: 'select'; id: string }
  | { ns: 'uib'; type: 'asset-select'; slot: string };
