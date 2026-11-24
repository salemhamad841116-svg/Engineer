// ==============================================================================
// enhancerFixtures.cjs — Arabic/English test language data for the Prompt
// Enhancer Engine suite. Acceptance rule: code files stay 100% English; test
// language samples live ONLY in fixture files like this one.
// ==============================================================================
"use strict";

module.exports = {
  // Annex Layer-1 acceptance sentence: typo fix + dialect mapping + RTL +
  // verbatim brand locking (unquoted brand mention).
  acceptanceMessage: "ابني لي صورة متجر قهوة الأصالة في سحراء بشي فخم ورايق",
  acceptanceBrand: "قهوة الأصالة",
  typoFrom: "سحراء",
  typoTo: "صحراء",
  dialectFrom: "فخم",

  // False-positive guards for the brand heuristic.
  genericStore: "ابني لي متجر عطور",
  hybridNoBrand: "أريد تطبيق متجر قهوة فاخرة مع بانر وصور منتجات",
  cityStore: "تصميم متجر ملابس في الرياض",
  quotedCafe: "مقهى ركن البن في جدة",
  quotedCafeBrand: "ركن البن",

  // Layer-2 acceptance: follow-up delta merge (night lighting switch).
  followupNight: "خلّ الإضاءة ليلية",
  followupAdd: "أضف خيمة على اليمين",

  // Layer-2 acceptance: contradiction resolution (sun vs dark night).
  contradictory: "صورة مقهى مع شمس ساطعة في ليل مظلم",

  // Normalization probes (hamza / alef-maqsura / ta-marbuta).
  hamzaForms: "أحمد إبراهيم آية",
  maqsura: "مقهى",
  taMarbuta: "قهوة",

  // Three-word gap-filling probe.
  threeWords: "متجر عطور فاخر",

  // Safety rewrite probe (false-positive policy avoidance).
  safetyProbe: "صورة عصير رمان مع دم",

  // English LTR probe.
  englishMessage: "modern coffee shop storefront in the desert, luxury calm vibe",
};
