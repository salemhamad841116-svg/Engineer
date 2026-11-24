// ==============================================================================
// routerFixtures.cjs — Arabic/English test language data for the Smart Intent
// Router suite. Acceptance rule: code files stay 100% English; test language
// samples live ONLY in fixtures files like this one.
// ==============================================================================
"use strict";

module.exports = {
  // Acceptance: brand protection + Arabic typo correction.
  brandMessage: "ابني لي واجهة متجر قهوة الأصالة في سحراء",
  brandExpected: "قهوة الأصالة",
  typoFrom: "سحراء",
  typoTo: "صحراء",
  sceneEn: "desert",

  // Acceptance: direct deterministic commands (Layer 2 fast-path).
  cmdRemoveBg: "فرّغ الخلفية",
  cmdUpscale: "ارفع الدقة 4K",
  cmdExportCode: "صدّر الكود",

  // Acceptance: follow-up turns (Layer 3 context).
  followupImage: "أضف خيمة على اليمين",
  followupUi: "اجعل الألوان أغمق وأضف جدول العملات",

  // Acceptance: ambiguous request (Layer 4 gate).
  ambiguousMessage: "ابني لي متجر عطور",

  // Layer 5: complexity-based model tier.
  complexUi: "أريد منصة تداول فيها رسوم بيانية ودفتر أوامر",
  simpleUi: "أريد صفحة هبوط بسيطة",

  // Hybrid decomposition (Layer 5/6).
  hybridMessage: "أريد تطبيق متجر قهوة فاخرة مع بانر وصور منتجات",

  // Guardrail probes.
  emptyMessage: "   ",

  // Fast-path with mask: any text works, the mask decides.
  maskMessage: "عدل هذه المنطقة",

  // Chat intent (no build signals at all).
  chatMessage: "كيف أضيف مصادقة المستخدمين؟",
};
