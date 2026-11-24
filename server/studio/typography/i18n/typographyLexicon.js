/**
 * typographyLexicon.js — the ONLY Arabic file in the Bilingual Typography
 * Engine (8th annex). UI strings, diagnosis messages, and the Arabic half
 * of the bilingual policy denylist live here; all engine code stays
 * 100% English.
 */

export const TYPOGRAPHY_I18N = {
  ar: {
    'typography.layer.headline': 'العنوان الرئيسي',
    'typography.layer.subheadline': 'العنوان الفرعي',
    'typography.layer.tagline': 'الشعار النصي',
    'typography.layer.badge': 'شارة العرض',
    'typography.layer.signage': 'نص اللافتة',
    'typography.strategy.native_generative': 'توليد مباشر داخل المشهد',
    'typography.strategy.deterministic_compositor': 'تركيب حتمي بدقة 100%',
    'typography.strategy.two_pass_hybrid': 'هجين ثنائي التمرير',
    'typography.strategy.fallback_compositor': 'التركيب الاحتياطي المحلي',
    'typography.status.passed': 'اجتاز فحص OCR',
    'typography.status.retry_scheduled': 'إعادة محاولة موجهة بالتشخيص',
    'typography.status.fallback_recovered': 'تعافٍ بالتركيب المحلي المجاني',
    'typography.status.failed_unverified': 'تعذر التحقق (مخزون OCR غير متاح)',
    'typography.status.skipped': 'لا نص مطلوب — تخطّي الفحص',
    'typography.policy.rejected': 'النص المطلوب يخالف حارس السياسات',
  },
  en: {
    'typography.layer.headline': 'Headline',
    'typography.layer.subheadline': 'Subheadline',
    'typography.layer.tagline': 'Tagline',
    'typography.layer.badge': 'Badge',
    'typography.layer.signage': 'Signage text',
    'typography.strategy.native_generative': 'Native in-scene generation',
    'typography.strategy.deterministic_compositor': '100%-accuracy deterministic compositing',
    'typography.strategy.two_pass_hybrid': 'Two-pass hybrid',
    'typography.strategy.fallback_compositor': 'Local fallback compositor',
    'typography.status.passed': 'OCR gate passed',
    'typography.status.retry_scheduled': 'Diagnostic-driven retry scheduled',
    'typography.status.fallback_recovered': 'Recovered via local compositor',
    'typography.status.failed_unverified': 'Verification unavailable',
    'typography.status.skipped': 'No text requested — gate skipped',
    'typography.policy.rejected': 'Requested text violates the policy guardrail',
  },
};

/**
 * Arabic half of the Bilingual Text Policy & Trademark Guardrail (Layer 10
 * core). Categories only — the engine reports the category, never echoes
 * the matched phrase back into prompts.
 */
export const POLICY_DENYLIST_AR = {
  hate_violence: ['عنف', 'كراهية', 'ارهاب', 'إرهاب'],
  explicit: ['اباحي', 'إباحي', 'جنس صريح'],
  counterfeit_logo: ['تقليد شعار', 'شعار مزيف', 'نسخة مقلدة من شعار'],
};
