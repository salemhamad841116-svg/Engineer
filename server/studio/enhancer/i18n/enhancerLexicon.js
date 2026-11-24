/**
 * Prompt Enhancer Engine — Arabic lexicon (i18n).
 *
 * CODEBASE RULE: this is the ONLY enhancer file allowed to contain Arabic
 * strings. Every other engine file stays 100% English (regex build gate).
 * Test language samples live in server_backend/tests/fixtures/*.cjs.
 */

/* ------------------------- Layer 1: normalization ------------------------- */

// Common Arabic spell-fix dictionary (token -> corrected token).
export const SPELL_FIX = {
  'سحراء': 'صحراء',
  'سحره': 'صحراء',
  'صحرة': 'صحراء',
  'إعلان': 'اعلان',
  'إقتصادي': 'اقتصادي',
  'إستثمار': 'استثمار',
  'أزياء': 'ازياء',
};

// Gulf/colloquial dialect tokens -> technical MSA descriptors (Layer 1.2).
// Token-level matching: JS \b never matches Arabic boundaries.
export const DIALECT_TECH_TOKENS = {
  'فخم': 'فاخر راقٍ بتشطيبات ممتازة',
  'فخمة': 'فاخرة راقية بتشطيبات ممتازة',
  'رايق': 'هادئ متزن بألوان مريحة',
  'رايقه': 'هادئة متزنة بألوان مريحة',
  'مرتبة': 'منظمة نظيفة الشبكة',
  'مرتب': 'منظم نظيف الشبكة',
  'شي': 'عنصر',
  'زين': 'احترافي عالي الجودة',
  'حلو': 'احترافي عالي الجودة',
  'خيالي': 'استثنائي الجودة',
  'خيالية': 'استثنائية الجودة',
  'دحين': 'الآن',
  'الحين': 'الآن',
  'واجب': 'كثير',
  'مرة': 'جداً',
  'مره': 'جداً',
};

/* ---------------------- Layer 2: context & resolution --------------------- */

// Follow-up delta detectors (Layer 2.2). Each: regex on the follow-up message
// -> structured delta applied over the previous accepted contract.
export const DELTA_RULES = [
  {
    id: 'lighting_night',
    patterns: [/(?:خلّ|خلي|اجعل|حوّل|خلها)?\s*(?:ال)?إضاءة\s+ليلية/, /ليل[يي]ً?$/, /بليل/],
    apply: { lighting: 'night' },
  },
  {
    id: 'lighting_day',
    patterns: [/(?:ال)?إضاءة\s+نهارية/, /نهار[يي]ً?$/, /بنهار/],
    apply: { lighting: 'day' },
  },
  {
    id: 'lighting_golden',
    patterns: [/ساعة\s+ذهبية/, /غروب/],
    apply: { lighting: 'golden_hour' },
  },
];

// Element-addition delta ("أضف X" / "ضيف X") — captured noun phrase appended
// to the scene elements without disturbing the rest of the contract.
export const DELTA_ADD_ELEMENT = /(?:أضف|اضف|ضيف|زد)\s+([^\s،.]+(?:\s+[^\s،.]+){0,3})/;

// Contradiction lexicon (Layer 2.4): cue groups that cannot coexist in one
// coherent brief. Resolution keeps the SETTING cue (last explicit time/mood
// instruction) and rewrites the conflicting element cue.
export const CONTRADICTION_GROUPS = {
  time_of_day: {
    day_cues: ['شمس', 'مشمس', 'نهار', 'ضهر', 'ظهر', 'صباح'],
    night_cues: ['ليل', 'ليلي', 'ليلية', 'مظلم', 'قمر', 'مساء'],
    // When night is the setting, day elements transform instead of conflict.
    night_transforms: {
      'شمس ساطعة': 'أضواء دافئة',
      'شمس': 'قمر',
    },
  },
  density: {
    minimal_cues: ['بسيط', 'فارغ', 'نظيف', 'هادئ', 'خالٍ', 'خالي'],
    crowded_cues: ['مزدحم', 'مليان', 'كثير العناصر', 'صاخب'],
  },
};

/* ----------------------- Layer 2: cultural grounding ---------------------- */

// Regional grounding profiles (Layer 2.3): visual environment + sample data
// cues injected so generated scenes match the request language/region.
export const REGION_PROFILES = {
  ar: {
    id: 'gulf_arab',
    environment_en: 'Arabian Gulf setting: warm desert hues, modern Gulf architecture, subtle arabesque accents',
    data_cues_en: 'Arabic names, SAR/AED price tags, right-to-left layout conventions',
  },
  en: {
    id: 'international',
    environment_en: 'neutral international setting with contemporary architecture',
    data_cues_en: 'English names, USD price tags, left-to-right layout conventions',
  },
};

/* ------------------------- Layer 5: safety rewrite ------------------------ */

// Pre-flight policy-safe rewrites (Layer 5.3): benign phrases that image APIs
// commonly mis-flag, rewritten to unambiguous equivalents BEFORE sending.
export const SAFETY_REWRITES = [
  { probe: /دم/g, replacement: 'عصير رمان', reason: 'false-positive-blood' },
  { probe: /سلاح|مسدس|بندقية/g, replacement: 'أداة زينة', reason: 'false-positive-weapon' },
  { probe: /قنبلة/g, replacement: 'عبوة زينة', reason: 'false-positive-explosive' },
];

/* -------------------- Layer 1: entity locking patterns -------------------- */

// Name-entity pattern source (Layer 1.3): matches "called X / named X" lead-ins
// followed by a 1-3 word entity. Exported as a SOURCE STRING so engine files
// can build the RegExp without containing Arabic literals themselves.
export const ENTITY_NAME_PATTERN_SOURCE =
  '(?:باسم|اسمها|اسمه|بعنوان|مكتوب عليها|مكتوب عليه)\\s+([^\\s،,.«»"\']{2,40}(?:\\s[^\\s،,.«»"\']{1,40}){0,2})';

/* ------------------- Layer 1: brand entity heuristics -------------------- */

// Business-type lead nouns: a brand candidate may follow one of these.
export const BRAND_LEAD_NOUNS = [
  'متجر', 'مقهى', 'محل', 'مطعم', 'شركة', 'فندق', 'صالون', 'مخبز', 'معرض',
  'تطبيق', 'منصة', 'موقع', 'ماركة', 'علامة', 'براند',
];

// Words that TERMINATE a brand candidate (prepositions, locations, and
// descriptive adjectives — a descriptor is never part of the locked brand).
export const BRAND_STOP_WORDS = new Set([
  'في', 'على', 'عن', 'الي', 'إلى', 'من', 'مع', 'ب', 'ل', 'و', 'او', 'أو',
  'صحراء', 'مدينة', 'شارع', 'حي', 'جدة', 'الرياض', 'دبي', 'الدمام',
  'فاخر', 'فاخرة', 'فخم', 'فخمة', 'راقي', 'راقية', 'جديد', 'جديدة',
  'احترافي', 'احترافية', 'عصري', 'عصرية', 'حديث', 'حديثة', 'جميل', 'جميلة',
  'بسيط', 'بسيطة', 'كبير', 'كبيرة', 'صغير', 'صغيرة',
]);

// Generic product words may appear INSIDE a brand but cannot alone prove one.
export const BRAND_GENERIC_WORDS = new Set([
  'قهوة', 'شاي', 'عطور', 'عطر', 'ملابس', 'حلويات', 'مجوهرات', 'ورود',
  'مطاعم', 'اكل', 'أكل', 'مأكولات', 'ازياء', 'أزياء', 'ساعات',
]);
