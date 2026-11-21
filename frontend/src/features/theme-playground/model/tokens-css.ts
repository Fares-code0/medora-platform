import { formatColor, mixSrgb, parseColor } from './color';
import { WEB_TOKENS, type Palette, type WebToken } from './tokens';

/**
 * Reads the light (`:root`) and dark (`.dark`) values out of tokens.css.
 *
 * This is how the playground's "Original Medora" preset stays equal to the
 * file you edit by hand: it is not a copy of tokens.css, it IS tokens.css,
 * re-read every time Vite reloads it. Change `--color-primary` in the
 * stylesheet, save, and the playground's Original changes with the app.
 *
 * Dark inherits from light for anything `.dark` does not redeclare — the
 * cascade does exactly that for `--color-control-knob` and
 * `--color-scrollbar-track` — so both palettes come out complete.
 *
 * ## Tokens are resolved to the colour the browser computes
 *
 * A token may be a literal (`#2c5282`, `rgba(…)`), a reference to another
 * custom property (`var(--palette-700)`), or a `color-mix(in srgb, …)` of two
 * such values — the six-colour palette on `main` writes every brand token
 * that way. Everything downstream (the contrast rules, the colour picker,
 * Copy, the exports) works on colours, so a reference is followed and a mix
 * is computed here, once, the way the cascade does: both selectors sit on
 * `<html>`, so in dark mode a reference sees `.dark`'s declarations over
 * `:root`'s. A literal is returned exactly as written. Anything this cannot
 * evaluate is returned as written too, so `isValidColor` flags it rather
 * than the playground measuring a guess.
 */

export interface ParsedTokens {
  readonly light: Palette;
  readonly dark: Palette;
  /** `--shadow-*` per mode; the preview re-declares them so they track its colours. */
  readonly shadows: { readonly light: Readonly<Record<string, string>>; readonly dark: Readonly<Record<string, string>> };
}

/** The first `selector { … }` block, comments stripped. Token blocks hold no nested braces. */
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function declarations(body: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(String.raw`--${prefix}-([a-z0-9-]+)\s*:\s*([^;]+);`, 'g');
  for (const m of body.matchAll(re)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) out[name] = value.trim().replace(/\s+/g, ' ');
  }
  return out;
}

/** Every custom property a block declares, `{ 'palette-700': '#303d59', … }`. */
function customProperties(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = m;
    if (name !== undefined && value !== undefined) out[name] = value.trim().replace(/\s+/g, ' ');
  }
  return out;
}

/** Splits on the commas that are not inside parentheses: `a, rgba(1, 2, 3), b`. */
function topLevelArguments(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

const VAR_REFERENCE = /^var\(\s*--([a-z0-9-]+)\s*\)$/;
const COLOR_MIX = /^color-mix\(\s*in\s+srgb\s*,([\s\S]*)\)$/;
const WEIGHTED = /^([\s\S]*?)\s+(\d+(?:\.\d+)?)%$/;

/**
 * The colour a declared value computes to, as a string `parseColor` reads;
 * `null` when it cannot be evaluated (an unknown reference, a cycle, another
 * colour space, a mix of more than two colours).
 */
function resolveColor(
  value: string,
  scope: Record<string, string>,
  seen: ReadonlySet<string>,
): string | null {
  const input = value.trim();
  if (parseColor(input) !== null) return input;

  const reference = VAR_REFERENCE.exec(input);
  if (reference) {
    const name = reference[1] ?? '';
    const target = scope[name];
    if (target === undefined || seen.has(name)) return null;
    return resolveColor(target, scope, new Set([...seen, name]));
  }

  const mix = COLOR_MIX.exec(input);
  if (mix) {
    const parts = topLevelArguments(mix[1] ?? '');
    if (parts.length !== 2) return null;
    const [first, second] = parts.map((part) => {
      const weighted = WEIGHTED.exec(part);
      return weighted
        ? { color: weighted[1] ?? '', percent: Number(weighted[2]) }
        : { color: part, percent: undefined };
    });
    if (!first || !second) return null;
    // CSS Color 5: a missing percentage is the complement of the other; both
    // missing is an even mix. A sum other than 100% would also scale alpha;
    // tokens.css never writes one, so it is left unevaluated.
    const p1 = first.percent ?? (second.percent === undefined ? 50 : 100 - second.percent);
    const p2 = second.percent ?? 100 - p1;
    if (p1 + p2 !== 100) return null;
    const a = resolveColor(first.color, scope, seen);
    const b = resolveColor(second.color, scope, seen);
    const [ca, cb] = [a === null ? null : parseColor(a), b === null ? null : parseColor(b)];
    if (!ca || !cb) return null;
    return formatColor(mixSrgb(ca, cb, p1 / 100));
  }

  return null;
}

export function parseTokensCss(css: string): ParsedTokens {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rootBody = block(clean, ':root');
  const darkBody = block(clean, '.dark');

  // Both selectors apply to <html>, so dark mode sees `.dark` over `:root`.
  const lightScope = customProperties(rootBody);
  const darkScope = { ...lightScope, ...customProperties(darkBody) };

  const pick = (scope: Record<string, string>): Palette => {
    const out = {} as Record<WebToken, string>;
    for (const token of WEB_TOKENS) {
      const declared = scope[token.slice('--'.length)] ?? '';
      out[token] = resolveColor(declared, scope, new Set()) ?? declared;
    }
    return out;
  };

  const lightShadows = declarations(rootBody, 'shadow');
  return {
    light: pick(lightScope),
    dark: pick(darkScope),
    shadows: { light: lightShadows, dark: { ...lightShadows, ...declarations(darkBody, 'shadow') } },
  };
}

/** Every `--color-*` name `:root` declares — used to prove the catalogue is complete. */
export function declaredColorTokens(css: string): readonly string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.keys(declarations(block(clean, ':root'), 'color')).map((name) => `--color-${name}`);
}
