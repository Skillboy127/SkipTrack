/**
 * Poster design tokens — the single source of truth for colour, type, spacing
 * and the heavy rules this direction is built on. Screens import from here;
 * nothing hardcodes a colour.
 */

export const colors = {
  /** Page background. */
  paper: '#F2EEE3',
  /** Text, rules, and dark surfaces. */
  ink: '#0E0E0E',
  /** Active-session field, fills, active tab. Never use as text on paper. */
  accent: '#FF4F1F',
  /** Darkened accent for the rare case accent-coloured text sits on paper (4.7:1). */
  accentDeep: '#C2390F',
  /** Row press state. */
  rowPress: '#E9E3D4',
  /** Text and icons on ink or accent surfaces. */
  onInk: '#F2EEE3',
  /** Hairline divider on an ink surface. */
  inkDivider: '#333333',
  /** Press state on an ink surface. */
  inkPress: '#1C1C1C',
  /** Muted text on paper (6.9:1). */
  inkMuted: '#5A554B',
  /** Destructive actions. */
  danger: '#B3261E',
  /** Placeholder text in inputs (4.8:1). */
  placeholder: '#7A7466',
} as const;

export const font = {
  display: 'Anton_400Regular',
  body: 'Archivo_400Regular',
  medium: 'Archivo_500Medium',
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
  black: 'Archivo_800ExtraBold',
} as const;

/** Display sizes (Anton). Leading is deliberately tight — see `leading`. */
export const display = {
  timer: 420,
  exercise: 118,
  hero: 92,
  stat: 40,
  chip: 36,
  numeral: 34,
  /** Row index numeral on list rows. */
  rowNumeral: 44,
  control: 30,
  rowTitle: 26,
  cta: 24,
  entryTitle: 22,
  wordmark: 20,
} as const;

/** Label sizes (Archivo), always uppercase with wide tracking. */
export const label = {
  cue: 15,
  base: 13,
  small: 12,
  micro: 11,
} as const;

export const leading = {
  /** Multiplier for the giant numerals. */
  tight: 0.76,
  /** Multiplier for display headings. */
  display: 0.86,
  /** Multiplier for stacked display rows. */
  snug: 1.0,
} as const;

export const tracking = {
  display: -0.9,
  label: 0.8,
  wide: 1.3,
} as const;

export const space = {
  /** Horizontal page gutter. */
  gutter: 18,
  row: 12,
  block: 14,
  tight: 8,
  hair: 4,
} as const;

/** Heavy poster rules. Everything is square — there are no corner radii. */
export const rule = {
  heavy: 2.5,
  thin: 1.5,
} as const;

export const band = {
  statusBar: 44,
  cta: 58,
  tabBar: 54,
  transport: 88,
  control: 44,
  actionHeight: 48,
  search: 46,
  play: 60,
  numeralCol: 64,
  /** List row height. */
  row: 72,
} as const;

/**
 * Display text is laid out tightly, so a large system font setting would break
 * it. Body text scales normally.
 */
export const DISPLAY_MAX_SCALE = 1.2;
