/**
 * Studio i18n labels — the ONLY place Arabic preset/modifier labels may live.
 * Registry and engine files stay 100% English (codebase gate).
 */

const LABELS = {
  en: {
    presets: {
      cinematic_photo: 'Cinematic Photo',
      commercial_storefront: 'Commercial Storefront',
      product_studio: 'Product Studio',
      ui_assets: 'UI Assets',
      fintech_tech: 'Fintech & Tech',
      marketing_banner: 'Marketing Banner',
    },
    modifiers: {
      lighting: 'Lighting', lens: 'Lens', timing: 'Timing', style: 'Style',
      surface: 'Surface', camera_angle: 'Camera angle', background: 'Background',
      theme: 'Theme', text_space: 'Text space',
      day: 'Day', golden_hour: 'Golden hour', neon_night: 'Neon night',
      wide: 'Wide', portrait: 'Portrait', lit_night: 'Lit night',
      modern: 'Modern', luxury: 'Luxury', heritage: 'Heritage', classic: 'Classic',
      marble: 'Marble', wood: 'Wood', dark: 'Dark', pure_white: 'Pure white',
      front: 'Front', top_down: 'Top-down', three_quarter: 'Three-quarter',
      '3d': '3D', glassmorphism: 'Glassmorphism', flat: 'Flat',
      transparent: 'Transparent', light: 'Light',
      dark_neon: 'Dark neon', corporate_blue: 'Corporate blue', glassy: 'Glassy',
      right: 'Right', left: 'Left', center: 'Center',
    },
    intensity: { subtle: 'Subtle', balanced: 'Balanced', strong: 'Strong' },
    badge_auto_detected: 'Auto-detected mode',
    badge_change: 'Change',
  },
  ar: {
    presets: {
      cinematic_photo: 'تصوير سينمائي واقعي',
      commercial_storefront: 'تصميم تجاري وواجهات متاجر',
      product_studio: 'استوديو المنتجات',
      ui_assets: 'أصول واجهات التطبيقات',
      fintech_tech: 'مشاهد تقنية ومالية',
      marketing_banner: 'بانرات وسوشيال ميديا',
    },
    modifiers: {
      lighting: 'الإضاءة', lens: 'العدسة', timing: 'التوقيت', style: 'الطراز',
      surface: 'السطح', camera_angle: 'زاوية التصوير', background: 'الخلفية',
      theme: 'الثيم', text_space: 'مساحة النص',
      day: 'نهار', golden_hour: 'غروب ذهبي', neon_night: 'ليل نيون',
      wide: 'واسعة', portrait: 'بورتريه', lit_night: 'ليل مضيء',
      modern: 'عصري', luxury: 'فاخر', heritage: 'تراثي', classic: 'كلاسيكي',
      marble: 'رخام', wood: 'خشب', dark: 'داكن فاخر', pure_white: 'أبيض نقي',
      front: 'أمامية', top_down: 'علوية', three_quarter: 'ثلاثة أرباع',
      '3d': 'ثلاثي الأبعاد', glassmorphism: 'زجاجي', flat: 'مسطّح',
      transparent: 'شفافة', light: 'فاتحة',
      dark_neon: 'داكن نيون', corporate_blue: 'أزرق مؤسسي', glassy: 'زجاجي',
      right: 'يمين', left: 'يسار', center: 'وسط',
    },
    intensity: { subtle: 'خفيف', balanced: 'متوازن', strong: 'قوي' },
    badge_auto_detected: 'الوضع المختار تلقائياً',
    badge_change: 'تغيير',
  },
};

export function labelsFor(lang = 'ar') {
  return LABELS[lang] || LABELS.en;
}

export function presetLabel(presetId, lang = 'ar') {
  const l = labelsFor(lang);
  return l.presets[presetId] || LABELS.en.presets[presetId] || presetId;
}

export function modifierLabel(id, lang = 'ar') {
  const l = labelsFor(lang);
  return l.modifiers[id] || LABELS.en.modifiers[id] || id;
}

/**
 * Auto-detect keywords per preset, per language. Language data lives here
 * (not in the registry) so registry files stay 100% English.
 */
export const PRESET_KEYWORDS = {
  cinematic_photo: [
    'صحراء', 'سحراء', 'طبيعة', 'منظر', 'مشهد', 'مدينة', 'غروب', 'شاطئ', 'جبال',
    'desert', 'nature', 'landscape', 'city', 'sunset', 'beach', 'cinematic', 'scene',
  ],
  commercial_storefront: [
    'واجهة محل', 'واجهة متجر', 'محل', 'متجر', 'كافيه', 'مقهى', 'لافتة', 'ديكور',
    'storefront', 'shop', 'store', 'cafe', 'signage', 'facade', 'interior',
  ],
  product_studio: [
    'منتج', 'عطر', 'عطور', 'جهاز', 'زجاجة', 'علبة', 'موك اب', 'تصوير منتج',
    'product', 'perfume', 'device', 'bottle', 'packaging', 'mockup', 'e-commerce',
  ],
  ui_assets: [
    'أيقونة', 'ايقونة', 'أيقونات', 'زر', 'بطاقة', 'خلفية هيرو', 'خلفية واجهة',
    'icon', 'icons', 'button', 'card', 'hero background', 'ui asset', 'vector', 'illustration', 'glassmorphism',
  ],
  fintech_tech: [
    'تداول', 'منصة تداول', 'أسهم', 'عملات', 'كريبتو', 'محفظة', 'بنك', 'مصرف', 'تقني',
    'trading', 'stocks', 'crypto', 'fintech', 'banking', 'dashboard', 'chart', 'finance',
  ],
  marketing_banner: [
    'بانر', 'إعلان', 'اعلان', 'منشور', 'بوستر', 'غلاف', 'سوشيال',
    'banner', 'ad', 'advertisement', 'poster', 'social media', 'cover', 'campaign',
  ],
};
