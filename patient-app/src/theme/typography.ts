import { PixelRatio, Platform, type TextStyle } from 'react-native';

/**
 * Typography.
 *
 * The web scale is enterprise-dense by design — 13px body, 11px caption —
 * because a clinician reads a table at desk distance. Shrinking that onto
 * a phone is the specific mistake the audit warns against (§2: "it must
 * not reuse layout, navigation, density"), so this scale is rebuilt from
 * the mobile floor: 16 body, 14 small, 12 caption. The role *names* and
 * the relative rhythm are the web's; the values are not.
 *
 * ── Dynamic type ─────────────────────────────────────────────────────
 * RN's `<Text>` scales with the OS text size by default and RN 0.76 has no
 * hard cap, so a patient on the largest accessibility size gets text ~2x
 * the base — which overlaps and clips inside a 375pt layout. `scale()`
 * below applies the OS factor with a ceiling, so text grows a long way and
 * still lands inside its container. Every style here is pre-scaled and
 * every component sets `allowFontScaling={false}`, because scaling twice
 * (once here, once by the platform) compounds.
 *
 * The ceiling is deliberately generous (1.6x, so 16 -> 25) rather than the
 * 1.2x that is common in RN codebases: capping tightly is how an app
 * technically "supports" dynamic type while remaining unreadable to the
 * person who needed it. S-03 is the checklist row.
 */

const MAX_FONT_SCALE = 1.6;

/** The OS font scale, clamped. Read once per style-sheet build. */
export function fontScale(): number {
  return Math.min(PixelRatio.getFontScale(), MAX_FONT_SCALE);
}

function scale(size: number): number {
  return Math.round(size * fontScale());
}

/**
 * Open Sans Variable is the Medora face (DESIGN_SYSTEM §3.1). Bundling a
 * variable font is Phase W work (`expo-font` + an asset), so until then
 * this resolves to the platform's own UI face, which is what a system
 * font stack does on the web side too.
 */
export const fontFamily = {
  sans: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

export type TypographyRole =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'body'
  | 'bodyStrong'
  | 'bodySm'
  | 'caption'
  | 'label'
  | 'metric'
  | 'button';

/**
 * Built as a function, not a constant: `PixelRatio.getFontScale()` changes
 * when the patient changes the OS text size, and a module-level constant
 * would freeze the value read at import time.
 */
export function buildTypography(): Record<TypographyRole, TextStyle> {
  return {
    display: {
      fontFamily: fontFamily.sans,
      fontSize: scale(32),
      lineHeight: scale(40),
      fontWeight: weight.bold,
    },
    h1: {
      fontFamily: fontFamily.sans,
      fontSize: scale(26),
      lineHeight: scale(32),
      fontWeight: weight.bold,
    },
    h2: {
      fontFamily: fontFamily.sans,
      fontSize: scale(20),
      lineHeight: scale(26),
      fontWeight: weight.semibold,
    },
    h3: {
      fontFamily: fontFamily.sans,
      fontSize: scale(17),
      lineHeight: scale(23),
      fontWeight: weight.semibold,
    },
    h4: {
      fontFamily: fontFamily.sans,
      fontSize: scale(15),
      lineHeight: scale(21),
      fontWeight: weight.semibold,
    },
    body: {
      fontFamily: fontFamily.sans,
      fontSize: scale(16),
      lineHeight: scale(23),
      fontWeight: weight.regular,
    },
    bodyStrong: {
      fontFamily: fontFamily.sans,
      fontSize: scale(16),
      lineHeight: scale(23),
      fontWeight: weight.semibold,
    },
    bodySm: {
      fontFamily: fontFamily.sans,
      fontSize: scale(14),
      lineHeight: scale(20),
      fontWeight: weight.regular,
    },
    caption: {
      fontFamily: fontFamily.sans,
      fontSize: scale(12),
      lineHeight: scale(17),
      fontWeight: weight.regular,
    },
    /** Field labels, section eyebrows. Never below the caption floor. */
    label: {
      fontFamily: fontFamily.sans,
      fontSize: scale(13),
      lineHeight: scale(18),
      fontWeight: weight.semibold,
    },
    /** Large numerals — a KPI, a countdown, a result value. */
    metric: {
      fontFamily: fontFamily.sans,
      fontSize: scale(24),
      lineHeight: scale(30),
      fontWeight: weight.bold,
    },
    button: {
      fontFamily: fontFamily.sans,
      fontSize: scale(16),
      lineHeight: scale(21),
      fontWeight: weight.semibold,
    },
  };
}

export type Typography = ReturnType<typeof buildTypography>;
