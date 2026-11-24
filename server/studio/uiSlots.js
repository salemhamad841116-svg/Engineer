/**
 * UI Builder Mode — Layer 3: Auto-Asset Bridge & Media Hydration.
 *
 * Scans the blueprint for media slots, applies the Smart Asset Budget Cap
 * (default: 1 hero + 4 product photos = 5 paid images max), decides per
 * slot between paid photo / free SVG / free CSS, generates the photos via
 * the delivered Image Mode service (SHA-256 cache reuse is automatic), and
 * injects the resulting WebP URLs into the HTML — target: 0% gray boxes.
 *
 * Cross-asset consistency (Hybrid Layer 3 groundwork, $0 parts):
 *  - one shared style_seed fans out to every slot (`seed:slot`)
 *  - the design-token palette is injected into every image prompt
 *  - RTL requests add a composition hint (calm space on the right)
 *
 * Graceful per-slot fallback: a failed slot never fails the build — it is
 * replaced by an elegant CSS-gradient placeholder (tokens-aligned) flagged
 * `retryable: true` so the UI can offer "regenerate this image".
 */
import crypto from 'node:crypto';
import { generateStudioAsset } from './studioService.js';
import { StudioError } from './studioErrors.js';

export const MAX_PAID_IMAGES = 5;          // 1 hero + 4 products (spec default)
export const MAX_ASSET_CONCURRENCY = 2;    // polite parallel fan-out

/**
 * Build the Semantic Asset Manifest: every visual slot with its role,
 * aspect ratio, transparency need, text-overlay flag, and the budget
 * decision (photo/svg/css) with a human-readable reason.
 */
export function buildAssetManifest(blueprint, { budgetCap = MAX_PAID_IMAGES } = {}) {
  const manifest = [];
  let paidUsed = 0;
  for (const slot of blueprint.assetSlots) {
    if (slot.role === 'photo') {
      if (paidUsed < budgetCap) {
        paidUsed += 1;
        manifest.push({ ...slot, decision: 'photo', reason: 'within_budget' });
      } else {
        manifest.push({ ...slot, decision: 'css', reason: 'budget_cap', retryable: true });
      }
    } else {
      manifest.push({ ...slot, decision: slot.role, reason: slot.role === 'svg' ? 'free_vector' : 'free_css' });
    }
  }
  return manifest;
}

function slotPrompt({ slot, contract, tokens, lang }) {
  const ui = contract?.ui_params || {};
  const dir = ui.direction || (lang === 'en' ? 'ltr' : 'rtl');
  // NOTE: no quoted spans here — the prompt enhancer treats «…»/"…" as
  // mandatory overlay text, which would wrongly arm the OCR gate.
  const parts = [
    `UI asset for the ${slot.slot.replace(/_/g, ' ')} slot of a ${ui.domain || 'web'} application.`,
    slot.slot === 'hero_banner'
      ? 'Wide cinematic hero banner, professional studio lighting.'
      : 'Clean studio product shot on a soft neutral background.',
    `Match this color palette exactly: primary ${tokens.colors.primary}, accent ${tokens.colors.accent}, background ${tokens.colors.bg}.`,
    dir === 'rtl'
      ? 'Composition: keep the calm empty space on the RIGHT side for Arabic RTL text overlay.'
      : 'Composition: keep the calm empty space on the LEFT side for LTR text overlay.',
  ];
  if (slot.textOverlay && ui.protected_brand_text) {
    parts.push('Leave legible calm space for the brand headline.');
  }
  return parts.join(' ');
}

/**
 * Generate all paid photo slots with bounded concurrency.
 * Returns { results: Map(slot -> {ok, asset?, error?, prompt}), sharedSeed }.
 * generateStudioAsset injectable for tests (quota/cache stay real).
 */
export async function generateSlotAssets(db, {
  ownerId, projectId = null, manifest, contract, tokens, lang, genImpl = generateStudioAsset,
}) {
  const paid = manifest.filter((s) => s.decision === 'photo');
  const sharedSeed = crypto.createHash('sha1').update(`${ownerId}:${projectId || ''}:${contract?.ui_params?.domain || 'ui'}`).digest('hex').slice(0, 12);
  const results = new Map();
  let cursor = 0;
  const worker = async () => {
    while (cursor < paid.length) {
      const slot = paid[cursor]; cursor += 1;
      const prompt = slotPrompt({ slot, contract, tokens, lang });
      try {
        const asset = await genImpl(db, {
          ownerId, projectId,
          message: prompt,
          presetId: slot.presetId,
          aspectOverride: slot.aspectRatio,
          seedOverride: `${sharedSeed}:${slot.slot}`,
          protectedBrandText: slot.textOverlay ? (contract?.ui_params?.protected_brand_text || null) : null,
        });
        // Honest states: only proven images (READY, or UNVERIFIED when the OCR
        // tool itself is unavailable) may be injected into client UI.
        if (asset.state === 'READY' || asset.state === 'UNVERIFIED') {
          results.set(slot.slot, { ok: true, asset, prompt });
        } else {
          results.set(slot.slot, { ok: false, error: asset.error_code || asset.state, prompt, retryable: true });
        }
      } catch (err) {
        // Graceful per-slot fallback — the build must survive one bad image.
        results.set(slot.slot, { ok: false, error: err.code || err.message, prompt, retryable: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_ASSET_CONCURRENCY, Math.max(1, paid.length)) }, worker));
  return { results, sharedSeed };
}

function gradientPlaceholder(tokens, slot) {
  const alt = encodeURIComponent(slot.slot.replace(/_/g, ' '));
  return `<div class="asset-fallback" data-retryable="1" style="aspect-ratio:${slot.aspectRatio.replace(':', '/')};width:100%;display:grid;place-items:center;background:linear-gradient(135deg,${tokens.colors.surface},${tokens.colors.primary}22);color:var(--ui-muted);border-radius:var(--ui-radius-card)"><span>${alt}</span></div>`;
}

/**
 * Inject generated assets (or graceful fallbacks) into the HTML.
 * Replaces every <figure data-asset-slot="X" ...></figure> marker with:
 *  - <img> (webp preferred) with alt, aspect-ratio guard, lazy/eager policy
 *  - or a tokens-aligned CSS gradient placeholder flagged retryable
 * Above-the-fold hero gets fetchpriority="high" + eager; the rest lazy.
 *
 * @returns {{html:string, injected:number, fallbacks:number, brokenMarkers:string[]}}
 */
export function injectAssets(html, { manifest, results, tokens, assetUrl }) {
  let injected = 0;
  let fallbacks = 0;
  const brokenMarkers = [];
  let out = String(html || '');
  for (const slot of manifest) {
    const re = new RegExp(`<figure[^>]*data-asset-slot="${slot.slot}"[^>]*>\\s*</figure>`, 'i');
    if (!re.test(out)) {
      if (slot.decision === 'photo') brokenMarkers.push(slot.slot);
      continue;
    }
    if (slot.decision !== 'photo') continue; // svg/css slots are inlined by the synthesizer
    const r = results.get(slot.slot);
    if (r?.ok && r.asset) {
      const src = assetUrl(r.asset);
      const hero = slot.slot === 'hero_banner';
      const alt = `${slot.slot.replace(/_/g, ' ')}`;
      const img = `<img src="${src}" alt="${alt}" data-ui-asset="${slot.slot}" style="width:100%;aspect-ratio:${slot.aspectRatio.replace(':', '/')};object-fit:cover;border-radius:var(--ui-radius-card)" ${hero ? 'fetchpriority="high" loading="eager"' : 'loading="lazy"'}/>`;
      out = out.replace(re, img);
      injected += 1;
    } else {
      out = out.replace(re, gradientPlaceholder(tokens, slot));
      fallbacks += 1;
    }
  }
  return { html: out, injected, fallbacks, brokenMarkers };
}

export { StudioError };
