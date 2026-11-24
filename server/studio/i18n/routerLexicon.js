/**
 * Router Lexicon — language data for the Smart Intent Router (7 layers).
 *
 * This is the ONLY router file allowed to contain non-English text.
 * All code files import these lists; the English-codebase gate scans the
 * code files and must find zero Arabic characters in them.
 */

// Common Arabic misspellings -> corrected form (token-level, Layer 1).
export const TYPO_MAP = {
  'سحراء': 'صحراء',
  'صوره': 'صورة',
  'واجهه': 'واجهة',
  'خلفيه': 'خلفية',
  'لافته': 'لافتة',
  'منصه': 'منصة',
  'محفظه': 'محفظة',
  'ازياء': 'أزياء',
  'انشا': 'أنشئ',
  'ابني': 'ابنِ',
};

// Direct deterministic commands (Layer 2). Matched against normalized text
// with plain substring checks — no regex literals with Arabic in code files.
export const DIRECT_COMMAND_LEXICON = [
  {
    id: 'remove_bg',
    intent: 'image_edit',
    patterns: [
      'فرّغ الخلفية', 'فرغ الخلفية', 'افرغ الخلفية', 'أفرغ الخلفية',
      'حذف الخلفية', 'احذف الخلفية', 'ازالة الخلفية', 'إزالة الخلفية',
      'ازل الخلفية', 'أزل الخلفية',
      'remove background', 'remove the background', 'clear background', 'delete background',
    ],
  },
  {
    id: 'upscale_4k',
    intent: 'image_edit',
    patterns: [
      'ارفع الدقة', 'ارفع الجودة', 'زد الدقة', 'رفع الدقة', 'رفع الجودة',
      'upscale', 'raise resolution', 'increase resolution', '4k',
    ],
  },
  {
    id: 'export_code',
    intent: 'ui_edit',
    patterns: [
      'صدّر الكود', 'صدر الكود', 'تصدير الكود', 'صدّر المشروع', 'صدر المشروع',
      'export code', 'export the code', 'export project',
    ],
  },
];

// Follow-up markers — message modifies the LAST session output (Layer 3).
export const FOLLOWUP_MARKERS = [
  'أضف', 'اضف', 'اضافة', 'إضافة', 'اجعل', 'خلي', 'خلّ', 'غيّر', 'غير',
  'عدّل', 'عدل', 'أزل', 'ازل', 'احذف', 'امسح', 'بدّل', 'بدل', 'كبّر',
  'كبر', 'صغّر', 'صغر', 'وسّع', 'وسع', 'خفف', 'زوّد', 'زود', 'قلل',
  'add', 'make', 'change', 'remove', 'delete', 'modify', 'swap',
  'darker', 'lighter', 'bigger', 'smaller', 'brighter',
];

// Shop/brand prefixes for Literal Entity Locking (Layer 1).
export const BRAND_PREFIXES = [
  'متجر', 'مقهى', 'كافيه', 'مطعم', 'شركة', 'صيدلية', 'عيادة', 'معرض',
  'محل', 'براند', 'علامة', 'فندق', 'مخبز', 'صالون', 'سالون', 'نادي',
  'أكاديمية', 'اكاديمية', 'مدرسة', 'مستشفى', 'مؤسسة', 'موسسه',
];

// Explicit naming hints — a brand after these may be a single word.
export const BRAND_NAME_HINTS = ['باسم', 'اسمه', 'اسمها', 'بعنوان'];

// Tokens that terminate a brand capture.
export const BRAND_STOP_WORDS = [
  'في', 'فى', 'على', 'الى', 'إلى', 'من', 'عن', 'مع', 'او', 'أو', 'ثم',
  'و', 'ب', 'ل', 'بـ', 'لـ', 'داخل', 'تحت', 'فوق', 'امام', 'أمام', 'عند',
];

// Complexity signals — complex UIs route to the cloud tier (Layer 5).
export const COMPLEXITY_SIGNALS = [
  'رسوم بيانية', 'رسم بياني', 'دفتر أوامر', 'دفتر اوامر', 'شموع',
  'محفظة استثمارية', 'لوحة مؤشرات', 'مؤشرات فنية', 'تحليلات',
  'جداول بيانات', 'خريطة حرارية', 'متعدد الشاشات', 'عمق السوق',
  'charts', 'chart', 'order book', 'candlestick', 'heatmap',
  'multi-panel', 'analytics', 'kanban', 'gantt', 'real-time', 'realtime',
];

// Keyword scorer sets (honest offline fallback — confidence capped).
export const IMAGE_KEYWORDS = [
  'صورة', 'صور', 'تصميم صورة', 'مشهد', 'خلفية', 'بانر', 'لافتة', 'شعار',
  'لوجو', 'لوغو', 'بوستر', 'غلاف', 'موك اب', 'موكاب', 'إعلان', 'اعلان',
  'منشور', 'تصوير', 'رسمة', 'رسم',
  'image', 'picture', 'photo', 'poster', 'logo', 'banner', 'mockup',
  'wallpaper', 'thumbnail', 'illustration', 'artwork',
];

export const UI_KEYWORDS = [
  'تطبيق', 'واجهة', 'لوحة تحكم', 'داشبورد', 'صفحة', 'موقع', 'منصة',
  'شاشة', 'نموذج', 'متجر إلكتروني', 'متجر الكتروني', 'تداول', 'محفظة',
  'ابني', 'ابنِ', 'ابن',
  'app', 'application', 'dashboard', 'interface', ' ui', 'website',
  'web page', 'landing page', 'trading platform', 'admin panel', 'form',
];

export const HYBRID_HINTS = [
  'بصور', 'بالصور', 'مع صور', 'صور منتجات', 'صور حقيقية', 'صور واقعية',
  'with images', 'with photos', 'product photos', 'real images',
];

export const EDIT_HINTS = [
  'عدّل', 'عدل', 'غيّر', 'غير', 'أضف', 'اضف', 'أزل', 'ازل', 'احذف',
  'حسّن', 'حسن', 'ظلم', 'أغمق', 'اغمق', 'أفتح', 'افتح',
  'edit', 'tweak', 'adjust', 'remove', 'recolor',
];

// Scene nouns -> English (deterministic asset prompt builder, Layer 6).
export const SCENE_EN = {
  'صحراء': 'desert dunes',
  'خيمة': 'a tent',
  'بحر': 'the sea',
  'شاطئ': 'a beach',
  'جبال': 'mountains',
  'جبل': 'a mountain',
  'غروب': 'sunset',
  'شروق': 'sunrise',
  'ليل': 'night sky',
  'ثلج': 'snow',
  'مدينة': 'a city skyline',
  'مزرعة': 'a farm',
  'حديقة': 'a garden',
  'قمر': 'the moon',
  'نجوم': 'stars',
};

export const DOMAIN_EN = {
  coffee: 'specialty coffee',
  trading: 'financial trading',
  food: 'restaurant & food',
  realestate: 'real estate',
  fashion: 'fashion',
  health: 'health & fitness',
  education: 'education',
  travel: 'travel',
};

export const THEME_EN = {
  dark: 'dark theme, moody warm lighting',
  light: 'light theme, bright clean lighting',
};

export const SLOT_EN = {
  main_image: 'hero-quality image, strong focal composition',
  hero_banner: 'hero banner, wide composition, clean negative space on one side for UI headline',
  product_image: 'product photo, centered, studio softbox lighting',
  logo: 'minimal logo mark, vector style, flat background',
  storefront_image: 'storefront photo, eye-level, inviting entrance',
};

// Asset slot detection for hybrid decomposition (Layer 5).
export const SLOT_HINTS = [
  { slot: 'hero_banner', preset: 'marketing_banner', hints: ['بانر', 'هيرو', 'لافتة', 'رئيسية', 'banner', 'hero'] },
  { slot: 'product_image', preset: 'product_studio', hints: ['منتج', 'منتجات', 'سلعة', 'product'] },
  { slot: 'logo', preset: 'ui_assets', hints: ['شعار', 'لوجو', 'لوغو', 'logo'] },
  { slot: 'storefront_image', preset: 'commercial_storefront', hints: ['واجهة محل', 'واجهة المتجر', 'المحل من الخارج', 'storefront'] },
];

// Ambiguity quick-option labels (Layer 4) — UI strings, both languages.
export function buildAmbiguityOptions(lang, snippet) {
  const short = String(snippet || '').slice(0, 40);
  if (lang === 'en') {
    return [
      { id: 'image_generate', label: `Image: ${short}`, intent: 'image_generate' },
      { id: 'ui_generate', label: `App / website UI: ${short}`, intent: 'ui_generate' },
    ];
  }
  return [
    { id: 'image_generate', label: `صورة: ${short}`, intent: 'image_generate' },
    { id: 'ui_generate', label: `واجهة تطبيق أو موقع: ${short}`, intent: 'ui_generate' },
  ];
}

export const ROUTER_LABELS = {
  ar: {
    override_badge_prefix: 'تم التوجيه كـ:',
    override_badge_change: 'تغيير المسار',
    ambiguity_question: 'ماذا تقصد بالضبط؟ اختر لنكمل فوراً:',
  },
  en: {
    override_badge_prefix: 'Routed as:',
    override_badge_change: 'Change route',
    ambiguity_question: 'What exactly do you mean? Pick one to continue:',
  },
};

export function routerLabels(lang) {
  return ROUTER_LABELS[lang === 'en' ? 'en' : 'ar'];
}
