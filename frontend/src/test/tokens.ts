import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves a colour token from `styles/tokens.css` to the hex a browser
 * computes for it — for the suites that assert contrast against real values
 * (contrast.test.ts, status-encoding.test.ts).
 *
 * Tokens are no longer literals: each one points at a `--palette-*`
 * primitive or a `color-mix(in srgb, …)` of two (see the tokens.css header).
 * A regex for `#rrggbb` after the colon would find nothing to measure, so
 * this follows the references the way the cascade does. `in srgb` mixes the
 * gamma-encoded channels linearly, which is what is done here.
 */

export type Theme = 'light' | 'dark';

export const TOKENS_CSS = readFileSync(join(__dirname, '..', 'styles', 'tokens.css'), 'utf8');

/** Declarations of the first rule whose selector is exactly `selector`. */
function declarations(selector: string): Map<string, string> {
  const start = TOKENS_CSS.search(new RegExp(String.raw`(^|\n)${selector.replace('.', '\\.')}\s*\{`));
  if (start === -1) throw new Error(`tokens.css has no ${selector} rule`);
  const open = TOKENS_CSS.indexOf('{', start);
  const body = TOKENS_CSS.slice(open + 1, TOKENS_CSS.indexOf('\n}', open))
    // Comments may quote a declaration; only real ones count.
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) out.set(name, value.replace(/\s+/g, ' ').trim());
  }
  return out;
}

const ROOT = declarations(':root');
const DARK = declarations('.dark');

/** The raw declared value — `.dark` overrides `:root`, as the cascade does. */
export function declared(name: string, theme: Theme): string {
  const value = (theme === 'dark' ? DARK.get(name) : undefined) ?? ROOT.get(name);
  if (value === undefined) throw new Error(`token --${name} is not declared in tokens.css`);
  return value;
}

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const full =
    hex.length === 4
      ? `#${hex[1]!}${hex[1]!}${hex[2]!}${hex[2]!}${hex[3]!}${hex[3]!}`
      : hex.slice(0, 7);
  return [
    Number.parseInt(full.slice(1, 3), 16),
    Number.parseInt(full.slice(3, 5), 16),
    Number.parseInt(full.slice(5, 7), 16),
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function resolveValue(value: string, theme: Theme): Rgb {
  if (/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value)) return parseHex(value);

  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (ref) return resolveValue(declared(ref[1]!, theme), theme);

  const mix = /^color-mix\(in srgb, (\S+) (\d+(?:\.\d+)?)%, (\S+)\)$/.exec(value);
  if (mix) {
    const [, a, pct, b] = mix;
    const weight = Number(pct) / 100;
    const [x, y] = [resolveValue(a!, theme), resolveValue(b!, theme)];
    return [0, 1, 2].map((i) => x[i]! * weight + y[i]! * (1 - weight)) as unknown as Rgb;
  }

  throw new Error(`cannot resolve "${value}" to an opaque colour`);
}

/** `resolveToken('color-surface', 'dark')` → `'#1b252e'`. */
export function resolveToken(name: string, theme: Theme): string {
  return toHex(resolveValue(declared(name, theme), theme));
}
