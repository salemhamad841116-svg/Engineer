/**
 * UI Builder Mode — Layer 1: Domain Blueprints Registry.
 *
 * Server-side architectural blueprints per business domain. A blueprint
 * fixes the component list, default theme, and the semantic asset slots
 * (with aspect ratio + studio preset) so the first synthesis is already
 * professional. Detection runs on router ui_params.domain first, then on
 * lexicon keywords inside the normalized message.
 *
 * 100% English codebase: human-facing strings come from i18n/uiLexicon.js.
 */
import { DOMAIN_KEYWORDS } from './i18n/uiLexicon.js';

export const DOMAIN_IDS = Object.freeze(['fintech_trading', 'ecommerce', 'dashboard_saas', 'generic']);

/**
 * Asset slot roles:
 *  - photo: paid image generation (bounded by the Smart Asset Budget Cap)
 *  - svg:   free inline vector icon ($0)
 *  - css:   free CSS gradient/pattern background ($0)
 */
export const DOMAIN_BLUEPRINTS = Object.freeze({
  fintech_trading: {
    id: 'fintech_trading',
    defaultTheme: 'dark',
    components: [
      { id: 'ticker_strip', label: 'Symbol ticker strip' },
      { id: 'candle_chart', label: 'Interactive candlestick chart' },
      { id: 'order_book', label: 'Order book (bids/asks)' },
      { id: 'trade_panel', label: 'Buy/sell execution panel' },
      { id: 'portfolio_card', label: 'Portfolio summary card' },
    ],
    assetSlots: [
      { slot: 'hero_banner', role: 'photo', presetId: 'fintech_tech', aspectRatio: '16:9', textOverlay: true },
      { slot: 'icon_secure', role: 'svg', presetId: null, aspectRatio: null },
      { slot: 'icon_globe', role: 'svg', presetId: null, aspectRatio: null },
      { slot: 'bg_gradient', role: 'css', presetId: null, aspectRatio: null },
    ],
  },
  ecommerce: {
    id: 'ecommerce',
    defaultTheme: 'light',
    components: [
      { id: 'store_header', label: 'Store header with navigation' },
      { id: 'hero_banner', label: 'Hero banner' },
      { id: 'product_grid', label: 'Product grid with filter + search' },
      { id: 'cart_drawer', label: 'Slide-out cart drawer' },
      { id: 'product_detail', label: 'Product detail modal' },
    ],
    assetSlots: [
      { slot: 'hero_banner', role: 'photo', presetId: 'marketing_banner', aspectRatio: '16:9', textOverlay: true },
      { slot: 'product_1', role: 'photo', presetId: 'product_studio', aspectRatio: '1:1' },
      { slot: 'product_2', role: 'photo', presetId: 'product_studio', aspectRatio: '1:1' },
      { slot: 'product_3', role: 'photo', presetId: 'product_studio', aspectRatio: '1:1' },
      { slot: 'product_4', role: 'photo', presetId: 'product_studio', aspectRatio: '1:1' },
      { slot: 'icon_cart', role: 'svg', presetId: null, aspectRatio: null },
      { slot: 'icon_search', role: 'svg', presetId: null, aspectRatio: null },
      { slot: 'icon_leaf', role: 'svg', presetId: null, aspectRatio: null },
      { slot: 'bg_gradient', role: 'css', presetId: null, aspectRatio: null },
    ],
  },
  dashboard_saas: {
    id: 'dashboard_saas',
    defaultTheme: 'light',
    components: [
      { id: 'sidebar', label: 'Collapsible sidebar' },
      { id: 'kpi_cards', label: 'KPI indicator cards' },
      { id: 'analytics_chart', label: 'Analytics chart' },
      { id: 'data_table', label: 'Searchable/sortable data table' },
    ],
    assetSlots: [
      { slot: 'hero_banner', role: 'photo', presetId: 'fintech_tech', aspectRatio: '21:9', textOverlay: true },
      { slot: 'avatar_1', role: 'photo', presetId: 'ui_assets', aspectRatio: '1:1', transparent: true },
      { slot: 'icon_bell', role: 'svg', presetId: null, aspectRatio: null },
      { slot: 'bg_gradient', role: 'css', presetId: null, aspectRatio: null },
    ],
  },
  generic: {
    id: 'generic',
    defaultTheme: 'light',
    components: [
      { id: 'app_header', label: 'App header' },
      { id: 'hero_banner', label: 'Hero section' },
      { id: 'content_grid', label: 'Content grid' },
      { id: 'app_footer', label: 'Footer' },
    ],
    assetSlots: [
      { slot: 'hero_banner', role: 'photo', presetId: 'marketing_banner', aspectRatio: '16:9', textOverlay: true },
      { slot: 'icon_star', role: 'svg', presetId: null, aspectRatio: null },
      { slot: 'bg_gradient', role: 'css', presetId: null, aspectRatio: null },
    ],
  },
});

export function getBlueprint(domainId) {
  return DOMAIN_BLUEPRINTS[domainId] || DOMAIN_BLUEPRINTS.generic;
}

/**
 * Detect the domain from the router contract ui_params.domain first,
 * then from keywords in the normalized message. Returns a DOMAIN_IDS value.
 */
export function detectDomain({ uiDomain = null, normalized = '' } = {}) {
  const fromContract = String(uiDomain || '').toLowerCase();
  if (DOMAIN_BLUEPRINTS[fromContract]) return fromContract;
  const hay = `${fromContract} ${String(normalized || '').toLowerCase()}`;
  for (const id of DOMAIN_IDS) {
    if (id === 'generic') continue;
    if ((DOMAIN_KEYWORDS[id] || []).some((k) => hay.includes(k.toLowerCase()))) return id;
  }
  return 'generic';
}
