/**
 * UI Builder Mode — i18n lexicon & realistic domain seed data.
 *
 * This is the ONLY UI-builder module allowed to contain Arabic text
 * (100% English Codebase gate: Arabic lives in i18n + test fixtures).
 *
 * Contents:
 *  - DOMAIN_KEYWORDS: Arabic/English signals used to detect the ui domain.
 *  - SEED_DATA: realistic, domain-appropriate demo records per language.
 *    Absolutely no lorem-ipsum / random placeholder text (0% gate).
 */

export const DOMAIN_KEYWORDS = {
  fintech_trading: [
    'تداول', 'منصة تداول', 'أسهم', 'عملات', 'الذهب', 'شموع', 'محفظة', 'بورصة',
    'trading', 'stocks', 'forex', 'crypto', 'candlestick', 'portfolio',
  ],
  ecommerce: [
    'متجر', 'تسوق', 'منتجات', 'سلة', 'قهوة', 'عطور', 'ساعات', 'متجر إلكتروني',
    'shop', 'store', 'ecommerce', 'e-commerce', 'cart', 'products',
  ],
  dashboard_saas: [
    'لوحة تحكم', 'لوحة', 'إحصائيات', 'تقارير', 'إدارة',
    'dashboard', 'analytics', 'saas', 'admin', 'metrics', 'reports',
  ],
};

/**
 * Realistic seed records. Numbers are plausible market values, names are
 * culturally aligned with the request language, currencies match region.
 */
export const SEED_DATA = {
  fintech_trading: {
    ar: {
      tickers: [
        { symbol: 'BTC/USD', price: '97,240.50', change: '+2.41%' },
        { symbol: 'ETH/USD', price: '3,418.20', change: '+1.12%' },
        { symbol: 'XAU/USD', price: '2,915.30', change: '-0.34%' },
        { symbol: 'EUR/USD', price: '1.0842', change: '+0.08%' },
        { symbol: 'SAR/USD', price: '0.2664', change: '0.00%' },
      ],
      orderBook: {
        bids: [
          { price: '97,230.0', amount: '0.842' },
          { price: '97,225.5', amount: '1.310' },
          { price: '97,210.0', amount: '0.455' },
        ],
        asks: [
          { price: '97,250.0', amount: '0.620' },
          { price: '97,262.5', amount: '1.025' },
          { price: '97,280.0', amount: '0.390' },
        ],
      },
      candles: [96210, 96480, 95890, 97120, 96850, 97330, 97240],
      portfolioName: 'المحفظة الرئيسية',
    },
    en: {
      tickers: [
        { symbol: 'BTC/USD', price: '97,240.50', change: '+2.41%' },
        { symbol: 'ETH/USD', price: '3,418.20', change: '+1.12%' },
        { symbol: 'XAU/USD', price: '2,915.30', change: '-0.34%' },
        { symbol: 'EUR/USD', price: '1.0842', change: '+0.08%' },
        { symbol: 'GBP/USD', price: '1.2718', change: '-0.15%' },
      ],
      orderBook: {
        bids: [
          { price: '97,230.0', amount: '0.842' },
          { price: '97,225.5', amount: '1.310' },
          { price: '97,210.0', amount: '0.455' },
        ],
        asks: [
          { price: '97,250.0', amount: '0.620' },
          { price: '97,262.5', amount: '1.025' },
          { price: '97,280.0', amount: '0.390' },
        ],
      },
      candles: [96210, 96480, 95890, 97120, 96850, 97330, 97240],
      portfolioName: 'Main Portfolio',
    },
  },
  ecommerce: {
    ar: {
      storeName: 'متجر الأصالة',
      products: [
        { name: 'بن أرابيكا فاخر — 250غ', category: 'قهوة مختصة', price: '68 ر.س' },
        { name: 'خلطة الإسبريسو الداكنة — 500غ', category: 'قهوة مختصة', price: '112 ر.س' },
        { name: 'مقطرة يدوية V60', category: 'أدوات التحضير', price: '145 ر.س' },
        { name: 'مطحنة يدوية احترافية', category: 'أدوات التحضير', price: '230 ر.س' },
      ],
    },
    en: {
      storeName: 'Asalah Store',
      products: [
        { name: 'Premium Arabica Beans — 250g', category: 'Specialty Coffee', price: 'SAR 68' },
        { name: 'Dark Espresso Blend — 500g', category: 'Specialty Coffee', price: 'SAR 112' },
        { name: 'V60 Pour-Over Dripper', category: 'Brew Gear', price: 'SAR 145' },
        { name: 'Pro Hand Grinder', category: 'Brew Gear', price: 'SAR 230' },
      ],
    },
  },
  dashboard_saas: {
    ar: {
      kpis: [
        { label: 'الإيرادات الشهرية', value: '184,200 ر.س', delta: '+12.4%' },
        { label: 'المستخدمون النشطون', value: '8,432', delta: '+5.1%' },
        { label: 'معدل التحويل', value: '3.86%', delta: '+0.4%' },
        { label: 'متوسط قيمة الطلب', value: '212 ر.س', delta: '-1.2%' },
      ],
      rows: [
        { name: 'اشتراك الباقة الاحترافية', owner: 'سارة العتيبي', status: 'نشط', total: '4,900 ر.س' },
        { name: 'تجديد ترخيص الفريق', owner: 'محمد الحربي', status: 'قيد المعالجة', total: '12,300 ر.س' },
        { name: 'باقة الانطلاق السنوية', owner: 'نورة القحطاني', status: 'نشط', total: '2,150 ر.س' },
      ],
      series: [42, 55, 48, 61, 73, 69, 84],
    },
    en: {
      kpis: [
        { label: 'Monthly Revenue', value: 'SAR 184,200', delta: '+12.4%' },
        { label: 'Active Users', value: '8,432', delta: '+5.1%' },
        { label: 'Conversion Rate', value: '3.86%', delta: '+0.4%' },
        { label: 'Avg. Order Value', value: 'SAR 212', delta: '-1.2%' },
      ],
      rows: [
        { name: 'Pro Plan Subscription', owner: 'Sara Alotaibi', status: 'Active', total: 'SAR 4,900' },
        { name: 'Team License Renewal', owner: 'Mohammed Alharbi', status: 'Processing', total: 'SAR 12,300' },
        { name: 'Starter Annual Plan', owner: 'Noura Alqahtani', status: 'Active', total: 'SAR 2,150' },
      ],
      series: [42, 55, 48, 61, 73, 69, 84],
    },
  },
};

export function seedFor(domain, lang) {
  const d = SEED_DATA[domain] || SEED_DATA.ecommerce;
  return d[lang === 'en' ? 'en' : 'ar'] || d.ar;
}

/** UI chrome strings for the deterministic mock synthesizer (tests/dev). */
export const MOCK_UI_STRINGS = {
  ar: { open: 'فتح', details: 'عرض التفاصيل', empty: 'لا نتائج بعد', loading: 'جارٍ التحميل…' },
  en: { open: 'Open', details: 'Details view', empty: 'No results yet', loading: 'Loading…' },
};

export function mockStrings(lang) {
  return MOCK_UI_STRINGS[lang === 'en' ? 'en' : 'ar'];
}
