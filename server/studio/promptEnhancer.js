/**
 * Prompt Enhancer — Phase 1 (Smart Studio).
 *
 * Converts a plain Arabic (dialect-friendly) client description into a precise,
 * professional ENGLISH generation prompt in the background. Deterministic
 * template first (auditable, offline); optional LLM polish on top with honest
 * fallback when the model is unavailable.
 *
 * Also extracts overlay texts (store names, headlines inside «» or quotes)
 * that MUST render correctly inside the image — these feed the OCR gate.
 */

// Token-level dialect map — JS \b is ASCII-centric and never matches Arabic
// boundaries, so normalization operates on whitespace-separated tokens.
const DIALECT_TOKENS = {
  'ابي': 'أريد', 'أبي': 'أريد', 'ابغى': 'أريد', 'أبغى': 'أريد',
  'عطني': 'أنشئ', 'هات': 'أنشئ', 'جيب': 'أنشئ',
  'زين': 'احترافي عالي الجودة', 'حلو': 'احترافي عالي الجودة', 'فخم': 'احترافي عالي الجودة',
  'بسرعة': '',
  'مرة': 'جداً', 'مره': 'جداً',
};

const SECTOR_EN = {
  coffee: 'specialty coffee shop', trading: 'financial trading platform',
  food: 'restaurant', realestate: 'real estate', fashion: 'fashion brand',
  health: 'health & fitness', education: 'education', travel: 'travel agency',
};

const THEME_EN = { dark: 'dark theme, moody lighting', light: 'light theme, bright clean lighting' };
const PLATFORM_EN = { web: 'desktop web layout', mobile: 'mobile app layout, 9:16 friendly composition' };

export function normalizeArabic(text) {
  let out = String(text || '');
  out = out.replace(/[\u064B-\u0652\u0670\u0640]/g, ''); // diacritics
  const tokens = out.split(/\s+/).map((t) => (t in DIALECT_TOKENS ? DIALECT_TOKENS[t] : t));
  return tokens.filter((t) => t.length > 0).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract text that must appear INSIDE the image (signage, headlines).
 * Sources: «…» / "…" / '…' quotes, and "باسم X" / "اسمها X" / "بعنوان X".
 */
export function extractOverlayTexts(message) {
  const texts = new Set();
  const src = String(message || '');
  for (const m of src.matchAll(/«([^»]{2,60})»/g)) texts.add(m[1].trim());
  for (const m of src.matchAll(/["']([^"'\n]{2,60})["']/g)) texts.add(m[1].trim());
  for (const m of src.matchAll(/(?:باسم|اسمها|اسمه|بعنوان|مكتوب عليها|مكتوب عليه)\s+([^\s،,.«»"']{2,40}(?:\s[^\s،,.«»"']{1,40}){0,2})/g)) {
    const t = m[1].trim();
    if (!texts.has(t)) texts.add(t);
  }
  return [...texts];
}

/**
 * Build the professional English prompt deterministically.
 */
export function buildProfessionalPrompt({ message, preset, sector, theme, platform }) {
  const clean = normalizeArabic(message);
  const overlays = extractOverlayTexts(message);

  const parts = [];
  if (preset?.prefix_en) parts.push(preset.prefix_en);
  parts.push(`Client concept (translated intent): ${clean}`);
  if (sector && SECTOR_EN[sector]) parts.push(`Industry: ${SECTOR_EN[sector]}`);
  if (theme && THEME_EN[theme]) parts.push(THEME_EN[theme]);
  if (platform && PLATFORM_EN[platform]) parts.push(PLATFORM_EN[platform]);
  if (preset?.suffix_en) parts.push(preset.suffix_en);
  if (overlays.length) {
    parts.push(
      `IMPORTANT — render these texts EXACTLY, legible and correctly spelled on signage/banners: ${overlays.map((t) => `"${t}"`).join(', ')}.`,
    );
  }

  return {
    prompt_en: parts.join('. '),
    negative: preset?.negative_en || 'blurry, low quality, distorted text, watermark, cropped logo',
    overlay_texts: overlays,
  };
}

/**
 * Optional LLM polish. Never blocks generation: any model failure falls back
 * to the deterministic prompt (honest degradation, no fake enhancement).
 */
export async function enhanceWithLlm(basePrompt, { routerChat, modelId = null } = {}) {
  if (!routerChat) return { prompt_en: basePrompt, polished: false, reason: 'no-llm-client' };
  try {
    const res = await routerChat({
      modelId,
      messages: [
        { role: 'system', content: 'You rewrite image-generation briefs into precise professional English prompts. Output ONLY the final prompt text, no commentary. Keep any quoted overlay texts EXACTLY as provided.' },
        { role: 'user', content: basePrompt },
      ],
      maxTokens: 400,
    });
    const text = String(res?.text || '').trim();
    if (text.length < 20) return { prompt_en: basePrompt, polished: false, reason: 'empty-llm-output' };
    return { prompt_en: text, polished: true, reason: null };
  } catch (err) {
    return { prompt_en: basePrompt, polished: false, reason: `llm-fallback:${err?.code || err?.message || 'unknown'}` };
  }
}
