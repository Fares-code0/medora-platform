/**
 * Colour maths for the Theme Playground — parsing, WCAG contrast, alpha
 * compositing and an accessible-alternative search.
 *
 * Pure functions, no DOM: the presets test runs every rule here against every
 * palette without a browser. The WCAG formulas are the same ones
 * `styles/contrast.test.ts` applies to tokens.css, so a ratio shown in the
 * playground is the ratio that test would measure.
 */

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0–1. */
  readonly a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` and `transparent`. */
export function parseColor(value: string): Rgba | null {
  const input = value.trim();
  if (input.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = HEX.exec(input);
  if (hex) {
    let digits = hex[1] ?? '';
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('');
    const channel = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16);
    return {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: digits.length === 8 ? channel(6) / 255 : 1,
    };
  }

  const fn = RGB_FN.exec(input);
  if (fn) {
    const [r, g, b] = [fn[1], fn[2], fn[3]].map((c) => Number(c));
    const a = fn[4] === undefined ? 1 : Number(fn[4]);
    if ([r, g, b].some((c) => c === undefined || c > 255) || a > 1) return null;
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a };
  }
  return null;
}

export function isValidColor(value: string): boolean {
  return parseColor(value) !== null;
}

const two = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** `#rrggbb`, alpha dropped. */
export function toHex({ r, g, b }: Rgba): string {
  return `#${two(r)}${two(g)}${two(b)}`;
}

/** The opaque `#rrggbb` a colour picker can show; `null` if unparseable. */
export function hexOf(value: string): string | null {
  const parsed = parseColor(value);
  return parsed ? toHex(parsed) : null;
}

/** Translucent colours print as `rgba()` (as tokens.css writes them), opaque ones as hex. */
export function formatColor(color: Rgba): string {
  if (color.a >= 1) return toHex(color);
  const alpha = Math.round(color.a * 100) / 100;
  return `rgba(${String(Math.round(color.r))}, ${String(Math.round(color.g))}, ${String(Math.round(color.b))}, ${String(alpha)})`;
}

/**
 * A new opaque hue for a token, keeping the token's existing alpha. Picking a
 * colour for `--color-primary-subtle` in dark mode (16% alpha) keeps it a
 * 16% tint instead of turning it into a solid block.
 */
export function withHexKeepingAlpha(previous: string, hex: string): string {
  const next = parseColor(hex);
  if (!next) return previous;
  const alpha = parseColor(previous)?.a ?? 1;
  return formatColor({ ...next, a: alpha });
}

/** Paints `top` over an opaque `bottom` — how the browser shows a translucent token. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/**
 * `color-mix(in srgb, first p%, second)` as CSS Color 5 defines it: the two
 * weights are normalised to sum to 1, the gamma-encoded channels are
 * interpolated linearly, and alpha is premultiplied — so mixing with
 * `transparent` keeps the first colour's hue and scales only its alpha
 * (`color-mix(in srgb, #111522 55%, transparent)` is `#111522` at 0.55, not a
 * darkened grey). For two opaque colours this is the plain per-channel mix
 * `styles/contrast.test.ts` measures tokens.css with.
 *
 * `firstWeight` is 0–1. Weights summing below 100% would also scale alpha;
 * tokens.css never writes them, so they are not accepted here.
 */
export function mixSrgb(first: Rgba, second: Rgba, firstWeight: number): Rgba {
  const w1 = Math.min(1, Math.max(0, firstWeight));
  const w2 = 1 - w1;
  const a = first.a * w1 + second.a * w2;
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (c1: number, c2: number) => (c1 * first.a * w1 + c2 * second.a * w2) / a;
  return {
    r: channel(first.r, second.r),
    g: channel(first.g, second.g),
    b: channel(first.b, second.b),
    a,
  };
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Contrast ratio of `fg` on `bg`. Translucent colours are composited first —
 * `bg` over `base` (the surface it actually sits on), then `fg` over that.
 * Returns `null` when any input does not parse.
 */
export function contrastRatio(fg: string, bg: string, base = '#ffffff'): number | null {
  const [f, b, under] = [parseColor(fg), parseColor(bg), parseColor(base)];
  if (!f || !b || !under) return null;
  const ground = composite(b, { ...under, a: 1 });
  const ink = composite(f, ground);
  const [x, y] = [luminance(ink), luminance(ground)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

function toHsl({ r, g, b }: Rgba): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgba {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: 1 };
}

/** Hue in degrees, or `null` for a near-grey whose hue carries no meaning. */
export function hueOf(value: string): number | null {
  const parsed = parseColor(value);
  if (!parsed) return null;
  const hsl = toHsl(parsed);
  return hsl.s < 0.15 ? null : hsl.h;
}

/** Shortest distance between two hues, 0–180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * The nearest colour to `fg` (same hue and saturation, lightness moved away
 * from the background) that reaches `min` on `bg`. A SUGGESTION only — the
 * playground shows it and applies it when asked, never on its own.
 */
export function suggestAccessible(
  fg: string,
  bg: string,
  min: number,
  base = '#ffffff',
): { readonly color: string; readonly ratio: number } | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const under = parseColor(base);
  if (!f || !b || !under) return null;
  const ground = composite(b, { ...under, a: 1 });
  const goDarker = luminance(ground) > 0.18;
  const start = toHsl({ ...f, a: 1 });
  for (let step = 0; step <= 100; step += 1) {
    const l = goDarker ? start.l - step / 100 : start.l + step / 100;
    if (l < 0 || l > 1) break;
    const candidate = formatColor({ ...fromHsl({ ...start, l }), a: f.a });
    const ratio = contrastRatio(candidate, bg, base);
    if (ratio !== null && ratio >= min) return { color: candidate, ratio };
  }
  return null;
}
