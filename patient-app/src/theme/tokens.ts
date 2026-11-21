/**
 * Medora design tokens, ported to React Native.
 *
 * Source of truth: `frontend/src/styles/tokens.css` (DESIGN_SYSTEM.md §12.1,
 * revalued by ADR-0001). Every colour below is the same hex the web app
 * ships, so the two clients are recognisably one product and a revaluation
 * on either side is a one-file diff here.
 *
 * ── What changed on the way across, and why ──────────────────────────
 *
 * 1. **Type scale.** The web scale is deliberately *enterprise-dense*
 *    (13px body) for data-heavy clinical screens read at desk distance.
 *    A patient reads a phone at arm's length, one-handed, often unwell.
 *    Shrinking the doctor scale onto a 375pt screen is the mistake the
 *    audit (§2) names explicitly, so the mobile scale is rebuilt from
 *    the platform floor up: 16px body, 14px small, 12px caption. The
 *    *ratios* and the semantic role names are preserved; the values are
 *    not. See `typography.ts`.
 *
 * 2. **Elevation.** The web design carries elevation on a 1px border and
 *    keeps two shadows (popover, modal). That decision transfers intact —
 *    it is also the cheapest thing to render on a low-end Android device —
 *    but a shadow has to be expressed twice on RN (`shadow*` on iOS,
 *    `elevation` on Android), so each entry is an object, not a string.
 *
 * 3. **Focus ring.** `--shadow-focus` is a two-layer CSS box-shadow with
 *    no RN equivalent. Focus on mobile is carried by a 2px outline colour
 *    (`focusRing`) drawn as a border, plus the platform's own accessibility
 *    focus indicator.
 *
 * 4. **Chart ramp.** Ported unchanged for completeness, but no patient
 *    screen charts anything today. Kept so a future addition inherits the
 *    ramp's colour-vision reasoning rather than inventing five colours.
 *
 * 5. **Z-index.** Dropped. RN paints in tree order; a numeric ladder
 *    invites the bug it is supposed to prevent.
 */

/** The two palettes. Keys are identical, which is what makes `Theme` safe. */
export interface ColorPalette {
  readonly primary: string;
  readonly primaryHover: string;
  readonly primaryPressed: string;
  readonly primarySubtle: string;
  readonly secondary: string;
  readonly secondaryHover: string;
  readonly secondarySubtle: string;
  /** AI provenance, never decoration. Unused until the AD-4 gate is passed. */
  readonly accent: string;
  readonly accentSubtle: string;

  readonly success: string;
  readonly successSubtle: string;
  readonly warning: string;
  readonly warningSubtle: string;
  readonly error: string;
  readonly errorHover: string;
  readonly errorSubtle: string;
  readonly info: string;
  readonly infoSubtle: string;

  readonly background: string;
  readonly surface: string;
  readonly surfaceSunken: string;
  readonly surfaceOverlay: string;
  readonly border: string;
  readonly borderStrong: string;

  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly textDisabled: string;
  readonly textInverse: string;

  readonly controlKnob: string;
  readonly focusRing: string;
  readonly scrim: string;

  readonly chart1: string;
  readonly chart1Edge: string;
  readonly chart2: string;
  readonly chart2Edge: string;
  readonly chart3: string;
  readonly chart3Edge: string;
  readonly chart4: string;
  readonly chart4Edge: string;
  readonly chart5: string;
  readonly chart5Edge: string;
}

/** `:root` in tokens.css. */
export const lightColors: ColorPalette = {
  primary: '#2c5282',
  primaryHover: '#21406a',
  primaryPressed: '#17304e',
  primarySubtle: '#eef2f8',
  secondary: '#35706a',
  secondaryHover: '#2a5a55',
  secondarySubtle: '#eef5f4',
  accent: '#7d4f86',
  accentSubtle: '#f4eff6',

  success: '#136c35',
  successSubtle: '#ecf6f0',
  warning: '#8a5600',
  warningSubtle: '#fdf4e3',
  error: '#c0271f',
  errorHover: '#9d1f18',
  errorSubtle: '#fcefee',
  info: '#0c6291',
  infoSubtle: '#ecf4fa',

  background: '#f6f8fa',
  surface: '#ffffff',
  surfaceSunken: '#f0f3f7',
  surfaceOverlay: '#ffffff',
  border: '#d3dae3',
  borderStrong: '#828b99',

  textPrimary: '#0f172a',
  textSecondary: '#3d4757',
  textTertiary: '#576373',
  textDisabled: '#828b99',
  textInverse: '#ffffff',

  controlKnob: '#ffffff',
  focusRing: '#2c5282',
  scrim: 'rgba(2, 6, 23, 0.55)',

  chart1: '#264a77',
  chart1Edge: '#0e233e',
  chart2: '#6a5caf',
  chart2Edge: '#44358f',
  chart3: '#578dc1',
  chart3Edge: '#2a659c',
  chart4: '#afaad3',
  chart4Edge: '#8078ca',
  chart5: '#caddea',
  chart5Edge: '#4e96ca',
};

/**
 * `.dark` in tokens.css.
 *
 * Two properties of this palette are load-bearing and must survive any
 * future edit, because breaking either produces exactly the defects §8 of
 * the brief lists:
 *
 * - Every *filled* tone (primary, error, success, warning, accent) is
 *   LIGHT here, so `textInverse` inverts with them to the page's own ink
 *   (#0d0d0f). A white `textInverse` in dark mode is white-on-light at
 *   1.68:1 on the primary button — the "white text on white surface"
 *   failure, arrived at by copying one value across.
 * - `borderStrong` is the boundary of every input and secondary button and
 *   is held at >=3:1 against all three grounds (surface 3.40, background
 *   3.84, sunken 3.64). Do not darken it.
 */
export const darkColors: ColorPalette = {
  primary: '#8fb4e0',
  primaryHover: '#a9c6e9',
  primaryPressed: '#7ba3d2',
  primarySubtle: 'rgba(143, 180, 224, 0.16)',
  secondary: '#6fb5ac',
  secondaryHover: '#8ac6be',
  secondarySubtle: 'rgba(111, 181, 172, 0.16)',
  accent: '#b998c2',
  accentSubtle: 'rgba(185, 152, 194, 0.16)',

  success: '#6fc48d',
  successSubtle: 'rgba(111, 196, 141, 0.16)',
  warning: '#e0b055',
  warningSubtle: 'rgba(224, 176, 85, 0.16)',
  error: '#f0908a',
  errorHover: '#f5aca7',
  errorSubtle: 'rgba(240, 144, 138, 0.16)',
  info: '#6fb6dd',
  infoSubtle: 'rgba(111, 182, 221, 0.16)',

  background: '#0d0d0f',
  surface: '#1b1b1e',
  surfaceSunken: '#141416',
  surfaceOverlay: '#26262a',
  border: '#2e2e33',
  borderStrong: '#6e6e76',

  textPrimary: '#f4f4f5',
  textSecondary: '#c9c9ce',
  textTertiary: '#9d9da5',
  textDisabled: '#6e6e76',
  textInverse: '#0d0d0f',

  controlKnob: '#ffffff',
  focusRing: '#8fb4e0',
  scrim: 'rgba(0, 0, 0, 0.72)',

  chart1: '#cedef1',
  chart1Edge: '#8cadd4',
  chart2: '#b2aada',
  chart2Edge: '#877eb6',
  chart3: '#538fc7',
  chart3Edge: '#9dbad5',
  chart4: '#685fb5',
  chart4Edge: '#908bbb',
  chart5: '#27506d',
  chart5Edge: '#467495',
};

export type ColorToken = keyof ColorPalette;
