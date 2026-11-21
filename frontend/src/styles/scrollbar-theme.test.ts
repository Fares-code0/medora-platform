import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Scrollbars follow the theme — everywhere, from one place.
 *
 * **The defect.** Nothing declared `color-scheme`, so the browser painted
 * every native scrollbar in its light default whatever the theme: a white bar
 * down the dark sidebar, the page, every table, drawer and modal. A per-pane
 * fix would have left the next scroll container white, so these pin the
 * app-wide wiring instead:
 *
 * - `:root` and `.dark` each declare their `color-scheme`, so native chrome
 *   (and Safari, which has no `scrollbar-color`) switches with the theme;
 * - `<html>` sets `scrollbar-color` from the scrollbar tokens, and it
 *   inherits into every container, portals included;
 * - no source re-colours a scrollbar on its own, which is how a hardcoded
 *   light bar would come back.
 *
 * The thumb's contrast is asserted with the other roles in contrast.test.ts.
 */

const STYLES = __dirname;
const SRC = join(__dirname, '..');
const TOKENS = readFileSync(join(STYLES, 'tokens.css'), 'utf8');
const GLOBALS = readFileSync(join(STYLES, 'globals.css'), 'utf8');

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const start = css.search(new RegExp(String.raw`(^|\n)${selector.replace('.', '\\.')}\s*\{`));
  expect(start, `no ${selector} rule`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('\n}', open));
}

function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(tsx?|css)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

describe('scrollbar theme', () => {
  it('declares a colour scheme for each theme, so native scrollbars switch with it', () => {
    expect(ruleBody(TOKENS, ':root')).toMatch(/^\s*color-scheme:\s*light;/m);
    expect(ruleBody(TOKENS, '.dark')).toMatch(/^\s*color-scheme:\s*dark;/m);
  });

  it('colours every scrollbar from the tokens, on <html> where it inherits', () => {
    expect(GLOBALS).toMatch(
      /html\s*\{[^}]*scrollbar-color:\s*var\(--color-scrollbar-thumb\)\s+var\(--color-scrollbar-track\);/,
    );
  });

  it('is not re-coloured anywhere else', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== join(STYLES, 'globals.css'))
      .filter((file) => /scrollbar-color|::-webkit-scrollbar/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).split(sep).join('/'));

    expect(offenders).toStrictEqual([]);
  });
});

/**
 * The sidebar’s navigation list scrolls with no visible scrollbar — no
 * track, thumb or arrows, and no gutter left where the bar was. One opt-in
 * class in globals.css, the only file allowed to style scrollbars, on the
 * sidebar’s scroll area alone: every other container keeps its bar.
 */
describe('sidebar scrollbar', () => {
  const SIDEBAR = readFileSync(join(SRC, 'components', 'ui', 'Sidebar.tsx'), 'utf8');

  it('is hidden by one class, for every engine', () => {
    // Firefox, Chromium 121+ and Safari 18.2+; also returns the bar’s width.
    expect(GLOBALS).toMatch(/\.scrollbar-hidden\s*\{\s*scrollbar-width:\s*none;\s*\}/);
    // Older Chromium and Safari.
    expect(GLOBALS).toMatch(/\.scrollbar-hidden::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/);
  });

  it('is applied to the sidebar’s scroll area, which still scrolls', () => {
    expect(SIDEBAR).toContain("className={cn('flex-1 overflow-y-auto p-3 scrollbar-hidden'");
    expect(SIDEBAR).not.toMatch(/scrollbar-width:thin/);
  });

  it('is used nowhere else', () => {
    const users = sourceFiles(SRC)
      .filter((file) => file !== join(STYLES, 'globals.css'))
      .filter((file) => readFileSync(file, 'utf8').includes('scrollbar-hidden'))
      .map((file) => relative(SRC, file).split(sep).join('/'));
    expect(users).toStrictEqual(['components/ui/Sidebar.tsx']);
  });
});
