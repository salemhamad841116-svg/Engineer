/**
 * Live Pipeline Telemetry (Image Mode, Layer 5) — in-process event bus.
 *
 * The generation pipeline emits stage events per asset:
 *   enhance -> generate -> ocr -> postprocess -> ready | unverified | failed
 * The SSE endpoint replays the retained history to late subscribers, then
 * streams live. Zero external infrastructure ($0) — a per-process ring
 * buffer is enough for a single-node deployment; Redis pub/sub can replace
 * this module behind the same interface when the platform scales out.
 */

const MAX_HISTORY = 50; // events per asset
const MAX_ASSETS = 500; // retained asset buffers (LRU-ish eviction)

const buffers = new Map(); // assetId -> { events: [], listeners: Set<fn> }

function bufferFor(assetId) {
  let b = buffers.get(assetId);
  if (!b) {
    if (buffers.size >= MAX_ASSETS) {
      const oldest = buffers.keys().next().value;
      buffers.delete(oldest);
    }
    b = { events: [], listeners: new Set() };
    buffers.set(assetId, b);
  }
  return b;
}

export function emitStage(assetId, stage, data = {}) {
  if (!assetId) return;
  const evt = { stage, at: new Date().toISOString(), ...data };
  const b = bufferFor(assetId);
  b.events.push(evt);
  if (b.events.length > MAX_HISTORY) b.events.shift();
  for (const fn of b.listeners) {
    try { fn(evt); } catch { /* a broken listener must never break the pipeline */ }
  }
}

/** Returns an unsubscribe function. */
export function subscribe(assetId, listener) {
  const b = bufferFor(assetId);
  b.listeners.add(listener);
  return () => b.listeners.delete(listener);
}

export function getHistory(assetId) {
  const b = buffers.get(assetId);
  return b ? [...b.events] : [];
}

/** Test hook. */
export function resetPipelineEvents() {
  buffers.clear();
}
