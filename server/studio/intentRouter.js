/**
 * Smart Intent Router — Phase 1 (Smart Studio).
 *
 * Routes one client message to exactly one execution path:
 *   image  → AI image generation/editing
 *   ui     → live UI builder
 *   hybrid → UI build + auto asset injection
 *   chat   → ordinary conversation (no build)
 *
 * Design contract:
 * 1) Deterministic keyword scoring FIRST (free, fast, auditable).
 * 2) Ambiguous cases return clarifier buttons (Quick Clarifiers) — the router
 *    never guesses silently when a wrong guess would burn paid generation.
 * 3) Optional LLM tie-break via workspaceModelRouter, with deterministic
 *    fallback if the model is unavailable (honest degradation).
 */

const IMAGE_SIGNALS = [
  // Arabic
  'صورة', 'صوره', 'صور', 'تصميم صورة', 'صمم صورة', 'مشهد', 'خلفية', 'خلفيه',
  'بانر', 'لافتة', 'لافته', 'شعار', 'لوجو', 'لوغو', 'بوستر', 'غلاف', 'غلاف',
  'تصوير منتج', 'تصوير منتجات', 'موك اب', 'موكاب', 'إعلان', 'اعلان', 'منشور',
  // English
  'image', 'picture', 'photo', 'poster', 'logo', 'banner', 'mockup', 'wallpaper',
  'thumbnail', 'cover art', 'illustration',
];

const UI_SIGNALS = [
  // Arabic
  'تطبيق', 'واجهة', 'واجهه', 'لوحة تحكم', 'لوحه تحكم', 'داشبورد', 'صفحة', 'صفحه',
  'موقع', 'منصة تداول', 'منصه تداول', 'شاشة', 'شاشه', 'نموذج إدخال', 'متجر إلكتروني',
  'متجر الكتروني', 'تداول', 'محفظة', 'محفظه',
  // English
  'app', 'application', 'dashboard', 'interface', 'ui', 'website', 'web page',
  'landing page', 'trading platform', 'control panel', 'admin panel', 'form',
];

// Words that force HYBRID when combined with a UI signal (UI that needs imagery).
const HYBRID_ASSET_HINTS = [
  'بصور', 'بالصور', 'مع صور', 'صور منتجات', 'صور حقيقية', 'صور واقعية', 'بانر',
  'with images', 'with photos', 'product photos', 'real images',
];

const SECTORS = {
  coffee:   ['قهوة', 'قهوه', 'كافيه', 'مقهى', 'coffee', 'cafe'],
  trading:  ['تداول', 'أسهم', 'اسهم', 'عملات', 'كريبتو', 'trading', 'stocks', 'crypto', 'forex'],
  food:     ['مطعم', 'مطاعم', 'أكل', 'اكل', 'طعام', 'برجر', 'بيتزا', 'restaurant', 'food', 'burger'],
  realestate: ['عقار', 'عقارات', 'شقق', 'فلل', 'real estate', 'property'],
  fashion:  ['أزياء', 'ازياء', 'ملابس', 'موضة', 'fashion', 'clothing'],
  health:   ['صحة', 'صحه', 'عيادة', 'مستشفى', 'لياقة', 'جيم', 'clinic', 'gym', 'fitness', 'health'],
  education:['تعليم', 'دورات', 'مدرسة', 'مدرسه', 'جامعة', 'courses', 'education', 'school'],
  travel:   ['سفر', 'سياحة', 'سياحه', 'رحلات', 'فنادق', 'travel', 'hotel', 'flights'],
};

const stripDiacritics = (s) => s.replace(/[\u064B-\u0652\u0670\u0640]/g, '');

function normalize(msg) {
  return stripDiacritics(String(msg || '').toLowerCase().trim());
}

function score(message, signals) {
  const n = normalize(message);
  let hits = 0;
  const matched = [];
  for (const sig of signals) {
    if (n.includes(sig)) { hits += 1; matched.push(sig); }
  }
  return { hits, matched };
}

export function detectSector(message) {
  const n = normalize(message);
  for (const [sector, words] of Object.entries(SECTORS)) {
    if (words.some((w) => n.includes(w))) return sector;
  }
  return null;
}

export function detectPlatform(message) {
  const n = normalize(message);
  if (/(جوال|موبايل|هاتف|ايفون|اندرويد|mobile|android|ios|iphone)/.test(n)) return 'mobile';
  if (/(ويب|موقع|متصفح|سطح المكتب|web|desktop|website)/.test(n)) return 'web';
  return null;
}

export function detectTheme(message) {
  const n = normalize(message);
  if (/(داكن|ليلي|dark|black theme)/.test(n)) return 'dark';
  if (/(فاتح|نهاري|light|white theme)/.test(n)) return 'light';
  return null;
}

/**
 * Clarifier buttons — Arabic labels, machine-readable ids.
 * Returned ONLY when the answer changes the output materially.
 */
export function buildClarifiers({ mode, message, answers = {} }) {
  const out = [];
  if ((mode === 'ui' || mode === 'hybrid') && !answers.platform && !detectPlatform(message)) {
    out.push({
      id: 'platform',
      question: 'الواجهة لأي منصة؟',
      options: [
        { id: 'web', label: 'ويب' },
        { id: 'mobile', label: 'جوال' },
      ],
    });
  }
  if ((mode === 'ui' || mode === 'hybrid' || mode === 'image') && !answers.theme && !detectTheme(message)) {
    out.push({
      id: 'theme',
      question: 'التصميم داكن أم فاتح؟',
      options: [
        { id: 'dark', label: 'داكن' },
        { id: 'light', label: 'فاتح' },
      ],
    });
  }
  if (!answers.sector && !detectSector(message) && (mode === 'ui' || mode === 'image' || mode === 'hybrid')) {
    out.push({
      id: 'sector',
      question: 'ما نوع القطاع؟',
      options: [
        { id: 'coffee', label: 'قهوة' },
        { id: 'food', label: 'مطاعم' },
        { id: 'trading', label: 'تداول' },
        { id: 'fashion', label: 'أزياء' },
      ],
    });
  }
  return out;
}

/**
 * Classify one message.
 * @returns {{mode: 'image'|'ui'|'hybrid'|'chat', confidence: number,
 *            scores: object, sector: string|null, platform: string|null,
 *            theme: string|null, clarifiers: Array}}
 */
export function classifyIntent(message, { answers = {} } = {}) {
  const img = score(message, IMAGE_SIGNALS);
  const ui = score(message, UI_SIGNALS);
  const hybridHint = score(message, HYBRID_ASSET_HINTS).hits > 0;

  const sector = answers.sector || detectSector(message);
  const platform = answers.platform || detectPlatform(message);
  const theme = answers.theme || detectTheme(message);

  let mode = 'chat';
  if (img.hits === 0 && ui.hits === 0) {
    mode = 'chat';
  } else if (img.hits > 0 && ui.hits > 0) {
    mode = 'hybrid';
  } else if (ui.hits > 0 && hybridHint) {
    mode = 'hybrid';
  } else if (ui.hits > 0) {
    mode = 'ui';
  } else {
    mode = 'image';
  }

  const total = img.hits + ui.hits;
  const confidence = mode === 'chat' ? 1 : Math.min(1, 0.55 + 0.15 * total + (hybridHint ? 0.1 : 0));

  const clarifiers = mode === 'chat' ? [] : buildClarifiers({ mode, message, answers });

  return {
    mode,
    confidence: Math.round(confidence * 100) / 100,
    scores: { image: img.hits, ui: ui.hits },
    sector, platform, theme,
    clarifiers,
  };
}
