import { CTAS_CONFIG } from '@triagepulse/clinical';

/**
 * CTAS colour helpers for the UI. Colours come only from CTAS_CONFIG in the
 * clinical package (the standard scale), so every screen shows the same level
 * in the same colour, with readable text on top.
 */

export const CTAS_LEVELS = [1, 2, 3, 4, 5];

const UNKNOWN = { hex: '#DCE2E8', ink: '#14202B', outline: null, en: 'Not yet assigned', ar: 'لم يُحدد بعد' };

export function ctasMeta(level) {
  return CTAS_CONFIG[level] || UNKNOWN;
}

/** Solid fill with readable text, e.g. a level badge or the acuity block. */
export function ctasFill(level) {
  const m = ctasMeta(level);
  return {
    backgroundColor: m.hex,
    color: m.ink,
    boxShadow: m.outline ? `inset 0 0 0 2px ${m.outline}` : undefined,
  };
}

/** A small swatch square next to text (works on white for every level). */
export function ctasSwatch(level) {
  const m = ctasMeta(level);
  return {
    backgroundColor: m.hex,
    boxShadow: `inset 0 0 0 ${m.outline ? 1.5 : 0}px ${m.outline || 'transparent'}`,
  };
}

/** A thin top bar / accent stripe in the level colour (level 5 gets an outline). */
export function ctasBar(level) {
  const m = ctasMeta(level);
  return { backgroundColor: m.hex, borderBottom: m.outline ? `1px solid #DCE2E8` : undefined };
}
