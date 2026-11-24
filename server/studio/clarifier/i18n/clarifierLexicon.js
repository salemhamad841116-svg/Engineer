/**
 * clarifierLexicon.js — i18n data file (Arabic strings + answer keywords).
 *
 * Quick Clarifiers Engine (official 7th annex): this is the ONLY file in the
 * clarifier engine allowed to carry Arabic text, keeping the rest of the
 * codebase 100% English per the mandatory codebase-hygiene rule.
 *
 * Exports:
 *  - CLARIFIER_I18N: question/option/badge text keyed by the i18n keys the
 *    card contract carries (the frontend resolves keys → text from here).
 *  - SLOT_ANSWER_KEYWORDS: per-slot keyword lists used by the deterministic
 *    already-answered scanner (Layer 3 core — Already-Answered Suppression).
 */

export const CLARIFIER_I18N = {
  questions: {
    'clarifiers.intent_track': 'ماذا تريد أن نبني بالضبط؟',
    'clarifiers.aspect_ratio': 'ما المقاس الأنسب للصورة؟',
    'clarifiers.lighting': 'ما الإضاءة المطلوبة في المشهد؟',
    'clarifiers.protected_text': 'هل يوجد اسم مكتوب يجب أن يظهر حرفياً؟',
    'clarifiers.style': 'ما الأسلوب البصري المفضل؟',
    'clarifiers.theme': 'ما الثيم المفضل للواجهة؟',
    'clarifiers.platform': 'على أي جهاز ستعمل الواجهة؟',
    'clarifiers.direction': 'ما اتجاه اللغة في الواجهة؟',
    'clarifiers.density': 'ما كثافة المحتوى المطلوبة؟',
  },
  options: {
    'options.storefront_photo': 'صورة واجهة محل',
    'options.store_ui': 'واجهة تطبيق متجر',
    'options.full_store_app': 'تطبيق كامل مع صور المنتجات',
    'options.ratio_square': 'مربع 1:1',
    'options.ratio_wide': 'عريض 16:9',
    'options.ratio_tall': 'طولي 9:16',
    'options.light_day': 'نهاري',
    'options.light_golden': 'غروب ذهبي',
    'options.light_night': 'ليلي',
    'options.text_yes': 'نعم، يوجد اسم',
    'options.text_no': 'بدون نص',
    'options.style_realistic': 'واقعي',
    'options.style_3d': 'ثلاثي الأبعاد',
    'options.style_glass': 'زجاجي',
    'options.dark_mode': 'داكن',
    'options.light_mode': 'فاتح',
    'options.glass_mode': 'زجاجي',
    'options.device_web': 'ويب',
    'options.device_mobile': 'جوال',
    'options.device_responsive': 'متجاوب',
    'options.dir_rtl': 'عربي RTL',
    'options.dir_ltr': 'إنجليزي LTR',
    'options.dir_both': 'ثنائي الاتجاه',
    'options.density_simple': 'مبسّطة',
    'options.density_pro': 'احترافية متقدمة',
  },
  badges: {
    recommended: 'موصى به',
    'cost.1_credit': 'رصيد واحد',
    'cost.2_credits': 'رصيدان',
    'cost.4_credits': '4 أرصدة',
    'cost.free': 'بدون تكلفة',
  },
  actions: {
    skip: 'تخطَّ وابدأ البناء',
    start: 'ابدأ البناء',
    custom_other: 'تخصيص آخر...',
  },
};

/**
 * Deterministic already-answered detection (Layer 3 core). Keys are slot
 * names; each value maps a canonical option value to the surface keywords a
 * client may type. Matching runs on the normalized Arabic form of the
 * message (diacritics/hamza/alef-maqsura unified by the enhancer normalizer).
 */
export const SLOT_ANSWER_KEYWORDS = {
  theme: {
    dark: ['داكن', 'داكنه', 'ليلي', 'ليليه', 'مظلم', 'مظلمه', 'غامق', 'غامقه', 'اسود', 'سوداء'],
    light: ['فاتح', 'فاتحه', 'نهاري', 'نهاريه', 'مضيء', 'مضيئه', 'ابيض', 'بيضاء'],
    glass: ['زجاجي', 'زجاجيه', 'زجاج'],
  },
  platform: {
    mobile: ['للجوال', 'جوال', 'موبايل', 'للموبايل', 'هاتف', 'للهاتف', 'تطبيق جوال'],
    web: ['للويب', 'ويب', 'متصفح', 'للمتصفح', 'موقع'],
    responsive: ['متجاوب', 'متجاوبه', 'كل الاجهزه', 'جميع الاجهزه'],
  },
  lighting: {
    day: ['نهاري', 'نهاريه', 'نهار', 'صباحي', 'شمس', 'ضوء النهار'],
    golden: ['غروب', 'ذهبي', 'ذهبيه', 'العصر', 'مغيب'],
    night: ['ليلي', 'ليل', 'مسائي', 'ليليه', 'اضاءه ليليه'],
  },
  aspect_ratio: {
    '1:1': ['مربع', 'مربعه', '1:1'],
    '16:9': ['عريض', 'عريضه', '16:9', 'بانورامي'],
    '9:16': ['طولي', 'طوليه', '9:16', 'ستوري', 'ريلز'],
  },
  style: {
    realistic: ['واقعي', 'واقعيه', 'فوتوغرافي', 'تصوير'],
    '3d': ['ثلاثي', '3d', 'ثري دي'],
    glass: ['زجاجي', 'زجاجيه'],
  },
  direction: {
    rtl: ['عربي', 'عربيه', 'بالعربي', 'rtl'],
    ltr: ['انجليزي', 'انجليزيه', 'بالانجليزي', 'إنجليزي', 'ltr'],
    both: ['ثنائي', 'لغتين', 'عربي وانجليزي'],
  },
  density: {
    simple: ['مبسط', 'مبسطه', 'بسيط', 'بسيطه', 'خفيف'],
    pro: ['احترافي', 'احترافيه', 'متقدم', 'متقدمه', 'كامل'],
  },
};

/**
 * Sector inference hints (Layer 5 — AI Recommended Pre-Selection): the
 * recommended option per sector keyword group. Kept here (data) so the card
 * builder stays language-agnostic.
 */
export const SECTOR_HINTS = {
  store: ['متجر', 'محل', 'عطور', 'قهوه', 'مطعم', 'صيدليه', 'بقاله', 'ماركت'],
  trading: ['تداول', 'فوركس', 'عملات', 'رقميه', 'ذهب', 'شموع', 'اسهم', 'بورصه'],
  clinic: ['عياده', 'طبي', 'مستشفى', 'دكتور', 'اسنان'],
  realestate: ['عقار', 'عقارات', 'شقق', 'فلل', 'مكتب عقاري'],
};
