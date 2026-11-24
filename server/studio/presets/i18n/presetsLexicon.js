/**
 * presetsLexicon.js — the ONLY Arabic file in the Smart Presets Engine v2.
 *
 * Contents:
 *  - PRESETS_V2_I18N: labels + descriptions for the 7 system presets,
 *    modifier labels, and the auto-badge strings (ar/en).
 *  - PRESET_DETECTION_HINTS: keyword hints per preset used by Zero-Click
 *    Auto-Preset Detection (Layer 3 core). `style` hints carry override
 *    weight — a heritage/style word outranks a plain domain noun, so
 *    "heritage cafe storefront" resolves to regional_heritage.
 */

export const PRESETS_V2_I18N = {
  ar: {
    'presets.cinematic_photo.label': 'التصوير السينمائي',
    'presets.cinematic_photo.desc': 'مشاهد طبيعية وصحراء ومدن ورحلات بعدسات سينمائية وإضاءة واقعية',
    'presets.commercial_storefront.label': 'واجهات المتاجر',
    'presets.commercial_storefront.desc': 'واجهات محلات وكافيهات ولافتات مضيئة بوضوح تام لاسم المتجر',
    'presets.product_studio.label': 'استوديو المنتجات',
    'presets.product_studio.desc': 'عرض العطور والأجهزة والأطعمة بإضاءة استوديو ناعمة وانعكاسات حقيقية',
    'presets.ui_assets.label': 'أصول الواجهات',
    'presets.ui_assets.desc': 'أيقونات ثلاثية الأبعاد ورسوم مسطحة وبطاقات زجاجية وخلفيات نظيفة',
    'presets.fintech_tech.label': 'التقنية والمالية',
    'presets.fintech_tech.desc': 'خلفيات داكنة لمنصات التداول ولوحات التحكم',
    'presets.marketing_banner.label': 'البانر الإعلاني',
    'presets.marketing_banner.desc': 'بانرات إعلانية بمساحات نصية هادئة للعنوان والدعوة للإجراء',
    'presets.regional_heritage.label': 'التراث المعماري',
    'presets.regional_heritage.desc': 'تراث معماري خليجي وعربي أصيل بإضاءة ذهبية دافئة',
    'badge.auto_detected': 'الوضع المختار تلقائياً',
    'badge.change': 'تغيير',
    'badge.manual': 'الوضع المختار يدوياً',
    'badge.fallback': 'عدنا للوضع النظامي تلقائياً',
  },
  en: {
    'presets.cinematic_photo.label': 'Cinematic Photo',
    'presets.cinematic_photo.desc': 'Natural scenes, desert, cities and travel with cinematic lenses',
    'presets.commercial_storefront.label': 'Commercial Storefront',
    'presets.commercial_storefront.desc': 'Shop and cafe facades with crisp illuminated signage',
    'presets.product_studio.label': 'Product Studio',
    'presets.product_studio.desc': 'Perfumes, devices and food with soft studio lighting',
    'presets.ui_assets.label': 'UI Assets',
    'presets.ui_assets.desc': '3D icons, flat vectors, glassmorphism cards and clean backgrounds',
    'presets.fintech_tech.label': 'Fintech & Tech',
    'presets.fintech_tech.desc': 'Dark backdrops for trading platforms and dashboards',
    'presets.marketing_banner.label': 'Marketing Banner',
    'presets.marketing_banner.desc': 'Ad banners with quiet negative space for headline and CTA',
    'presets.regional_heritage.label': 'Regional Heritage',
    'presets.regional_heritage.desc': 'Authentic Gulf and Arabian architectural heritage',
    'badge.auto_detected': 'Auto-detected preset',
    'badge.change': 'Change',
    'badge.manual': 'Manually selected preset',
    'badge.fallback': 'Returned to the system preset automatically',
  },
};

export const PRESET_DETECTION_HINTS = {
  cinematic_photo: {
    domain: ['صحراء', 'طبيعة', 'منظر', 'مشهد طبيعي', 'مدينة', 'غروب', 'شاطئ', 'جبال', 'سفر', 'رحلة',
      'desert', 'nature', 'landscape', 'city', 'sunset', 'beach', 'mountain', 'travel', 'cinematic'],
    style: ['سينمائي', 'سينمائية', 'cinematic'],
  },
  commercial_storefront: {
    domain: ['واجهة محل', 'واجهة متجر', 'محل', 'متجر', 'كافيه', 'مقهى', 'لافتة', 'ديكور', 'مطعم',
      'storefront', 'shop', 'store', 'cafe', 'signage', 'facade', 'interior', 'restaurant'],
    style: [],
  },
  product_studio: {
    domain: ['منتج', 'عطر', 'عطور', 'جهاز', 'زجاجة', 'علبة', 'تغليف', 'موك اب', 'ساعة', 'حذاء',
      'product', 'perfume', 'device', 'bottle', 'packaging', 'mockup', 'watch', 'ecommerce'],
    style: [],
  },
  ui_assets: {
    domain: ['ايقونة', 'أيقونة', 'ايقونات', 'شعار ابستراكت', 'خلفية واجهة', 'عنصر واجهة', 'ثري دي',
      'icon', 'icons', '3d icon', 'ui asset', 'flat', 'vector', 'glassmorphism'],
    style: ['زجاجي', 'مسطح', 'glassmorphism', 'flat'],
  },
  fintech_tech: {
    domain: ['تداول', 'منصة تداول', 'لوحة تحكم', 'عملات', 'كريبتو', 'بنك', 'مصرف', 'تقنية مالية',
      'trading', 'dashboard', 'crypto', 'stocks', 'bank', 'fintech', 'finance'],
    style: ['داكن تقني', 'نيون داكن'],
  },
  marketing_banner: {
    domain: ['بانر', 'اعلان', 'إعلان', 'منشور', 'بوستر', 'غلاف', 'حملة', 'سوشيال',
      'banner', 'ad', 'ads', 'poster', 'campaign', 'social media', 'cta'],
    style: [],
  },
  regional_heritage: {
    domain: ['قصر تراثي', 'عمارة قديمة', 'احياء قديمة', 'مبنى قديم', 'heritage architecture'],
    style: ['تراث', 'تراثي', 'تراثية', 'اصيل', 'أصيل', 'اصالة', 'أصالة', 'نجدي', 'حجازي', 'سدو',
      'شعبي', 'قديم اهلنا', 'خليجي اصيل', 'عربي اصيل', 'heritage', 'arabian', 'traditional', 'authentic'],
  },
};
