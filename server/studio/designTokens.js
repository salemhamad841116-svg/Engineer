/**
 * UI Builder Mode — Layer 1: Design Tokens Engine.
 *
 * Central token store rendered into a single CSS-variables block:
 * colors, Arabic/English font stacks, radius, shadows, and the three
 * theme modes (dark / light / glassmorphism). Palettes auto-pull from
 * the project's Brand Lock (presetStore) when present.
 *
 * ensureContrast() deterministically adjusts text tokens until the
 * WCAG AA 4.5:1 body-text ratio holds (auto-fix, $0).
 */

export const THEMES = Object.freeze(['dark', 'light', 'glass']);

const THEME_BASE = {
  dark: {
    bg: '#0b1220', surface: '#111a2e', border: '#22304a',
    text: '#e8eefc', muted: '#8fa3c8', shadow: '0 8px 30px rgba(0,0,0,0.45)',
  },
  light: {
    bg: '#f7f8fb', surface: '#ffffff', border: '#e3e7ef',
    text: '#17202e', muted: '#5b6b84', shadow: '0 6px 24px rgba(23,32,46,0.08)',
  },
  glass: {
    bg: '#101828', surface: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.18)',
    text: '#f2f6ff', muted: '#aab8d8', shadow: '0 8px 32px rgba(0,0,0,0.30)',
    backdrop: 'blur(14px)',
  },
};

const DEFAULT_ACCENT = { primary: '#3b82f6', onPrimary: '#ffffff', accent: '#f59e0b' };

const FONT_STACKS = {
  ar: "'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif",
  en: "'Inter','Segoe UI',Roboto,sans-serif",
};

/* ------------------------------ WCAG math ------------------------------ */

function channelToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = channelToLinear((n >> 16) & 255);
  const g = channelToLinear((n >> 8) & 255);
  const b = channelToLinear(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA, hexB) {
  const [la, lb] = [luminance(hexA), luminance(hexB)];
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken/lighten a hex color by amount in [-1, 1]. */
export function shade(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#000000';
  const n = parseInt(m[1], 16);
  const f = (c) => {
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  const r = f((n >> 16) & 255); const g = f((n >> 8) & 255); const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Deterministic WCAG-AA auto-fix: nudges tokens until body text AND the
 * primary button pair reach ratio >= 4.5. Prefers adjusting the primary
 * color (keeps the brand hue family) then falls back to flipping the
 * on-primary ink. Muted text is nudged the same way as body text.
 */
export function ensureContrast(tokens) {
  const t = { ...tokens, colors: { ...tokens.colors } };
  const target = 4.5;
  let guard = 0;
  while (contrastRatio(t.colors.text, t.colors.bg) < target && guard < 24) {
    const bgDark = luminance(t.colors.bg) < 0.4;
    t.colors.text = shade(t.colors.text, bgDark ? 0.08 : -0.08);
    guard += 1;
  }
  guard = 0;
  while (contrastRatio(t.colors.muted, t.colors.bg) < target && guard < 24) {
    const bgDark = luminance(t.colors.bg) < 0.4;
    t.colors.muted = shade(t.colors.muted, bgDark ? 0.08 : -0.08);
    guard += 1;
  }
  guard = 0;
  while (contrastRatio(t.colors.onPrimary, t.colors.primary) < target && guard < 24) {
    t.colors.primary = shade(t.colors.primary, -0.06); // darken brand towards AA
    guard += 1;
    if (guard >= 24) {
      // Last resort: pick whichever ink wins on the current primary.
      t.colors.onPrimary = contrastRatio('#ffffff', t.colors.primary) >= contrastRatio('#0b1220', t.colors.primary)
        ? '#ffffff' : '#0b1220';
    }
  }
  return t;
}

/* ---------------------------- token building --------------------------- */

function paletteFromBrandLock(brandLock) {
  if (!brandLock) return null;
  try {
    const palette = JSON.parse(brandLock.palette_json || 'null');
    if (Array.isArray(palette) && palette.length >= 2) {
      return { primary: palette[0], accent: palette[1], onPrimary: DEFAULT_ACCENT.onPrimary };
    }
  } catch (_) { /* malformed palette — fall through to defaults */ }
  return null;
}

/**
 * @param {object} arg
 * @param {'dark'|'light'|'glass'} [arg.theme]
 * @param {object|null} [arg.brandLock] row from presetStore.getBrandLock
 * @param {string} [arg.lang] 'ar' | 'en'
 */
export function buildTokens({ theme = 'light', brandLock = null, lang = 'ar' } = {}) {
  const mode = THEMES.includes(theme) ? theme : 'light';
  const accent = paletteFromBrandLock(brandLock) || DEFAULT_ACCENT;
  const base = THEME_BASE[mode];
  const tokens = {
    theme: mode,
    colors: {
      primary: accent.primary, onPrimary: accent.onPrimary, accent: accent.accent,
      bg: base.bg, surface: base.surface, border: base.border,
      text: base.text, muted: base.muted,
    },
    fonts: { body: lang === 'en' ? FONT_STACKS.en : FONT_STACKS.ar },
    radius: { card: '14px', control: '10px' },
    shadow: base.shadow,
    backdrop: base.backdrop || null,
  };
  return ensureContrast(tokens);
}

/** Render tokens as the single CSS-variables block (both theme overrides). */
export function tokensToCss(tokens) {
  const c = tokens.colors;
  const lines = [
    `--ui-primary:${c.primary}`, `--ui-on-primary:${c.onPrimary}`, `--ui-accent:${c.accent}`,
    `--ui-bg:${c.bg}`, `--ui-surface:${c.surface}`, `--ui-border:${c.border}`,
    `--ui-text:${c.text}`, `--ui-muted:${c.muted}`,
    `--ui-font:${tokens.fonts.body}`,
    `--ui-radius-card:${tokens.radius.card}`, `--ui-radius-control:${tokens.radius.control}`,
    `--ui-shadow:${tokens.shadow}`,
  ];
  if (tokens.backdrop) lines.push(`--ui-backdrop:${tokens.backdrop}`);
  const dark = THEME_BASE.dark;
  const light = THEME_BASE.light;
  return [
    `:root{${lines.join(';')}}`,
    `[data-theme="dark"]{--ui-bg:${dark.bg};--ui-surface:${dark.surface};--ui-border:${dark.border};--ui-text:${dark.text};--ui-muted:${dark.muted};--ui-shadow:${dark.shadow}}`,
    `[data-theme="light"]{--ui-bg:${light.bg};--ui-surface:${light.surface};--ui-border:${light.border};--ui-text:${light.text};--ui-muted:${light.muted};--ui-shadow:${light.shadow}}`,
  ].join('\n');
}

/** WCAG report over the token pairs that gate acceptance. */
export function contrastReport(tokens) {
  const c = tokens.colors;
  const pairs = [
    { name: 'body-text', fg: c.text, bg: c.bg },
    { name: 'muted-text', fg: c.muted, bg: c.bg },
    { name: 'primary-button', fg: c.onPrimary, bg: c.primary },
  ];
  return pairs.map((p) => ({ ...p, ratio: Number(contrastRatio(p.fg, p.bg).toFixed(2)), pass: contrastRatio(p.fg, p.bg) >= 4.5 }));
}
