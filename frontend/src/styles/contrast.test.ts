import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveToken } from '@/test/tokens';

/**
 * Contrast invariants over the real token values — ADR-0001 "text roles",
 * WCAG 1.4.3 (text, 4.5:1) and 1.4.11 (non-text, 3:1).
 *
 * **The defect this was written for.** `--color-text-disabled` is `#828b99`,
 * the *same value* as `--color-border-strong` — which `tokens.css` sets to
 * exactly that because 1.4.11 asks 3:1 of a control's boundary. It was also
 * being used for placeholder text, on every input, textarea and select in the
 * app, at 3.23:1 in light and 3.84:1 in dark. Both below the 4.5:1 that text
 * needs, and not covered by 1.4.3's exemption for INACTIVE components: a
 * placeholder in a field the user can type into is content.
 *
 * The fix gave the placeholder its own role rather than folding it into
 * `--color-text-tertiary`, and these assertions are what keep that role
 * meaningful: it must clear the text bar, and it must stay quieter than
 * tertiary. A placeholder as loud as metadata stops looking like an empty
 * field, which is the usability problem the too-faint colour was solving
 * badly.
 *
 * A browser sweep found one instance of it (`Select`, which renders its
 * placeholder as a real element). The `<input>` and `<textarea>` cases were
 * invisible to that sweep, because placeholder text lives in a shadow
 * pseudo-element with no text node to measure — so the rule is asserted here,
 * against the token file, where every case is visible at once.
 *
 * These are assertions about the *values*, so a re-tone that quietly drops a
 * role below its threshold fails here rather than in an audit months later.
 */

/**
 * The resolved value of a colour token in each theme. Tokens point at the
 * palette primitives (or a mix of two) rather than holding a literal, so
 * this follows the references the way the browser does — see
 * test/tokens.ts.
 */
function token(name: string, theme: 'light' | 'dark'): string {
  return resolveToken(name, theme);
}

function channels(hex: string): readonly [number, number, number] {
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

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The three grounds any of these roles is painted on. */
const GROUNDS = ['color-surface', 'color-surface-sunken', 'color-background'] as const;

/**
 * Text roles and the minimum each must clear on every ground.
 *
 * `text-disabled` is deliberately absent: it paints inactive components,
 * which 1.4.3 exempts, and it is held to the 3:1 non-text bar below instead.
 */
const TEXT_ROLES = [
  { role: 'color-text-primary', min: 4.5 },
  { role: 'color-text-secondary', min: 4.5 },
  { role: 'color-text-tertiary', min: 4.5 },
  { role: 'color-text-placeholder', min: 4.5 },
] as const;

describe.each(['light', 'dark'] as const)('token contrast — %s', (theme) => {
  it.each(TEXT_ROLES)('$role clears $min:1 on every surface', ({ role, min }) => {
    for (const ground of GROUNDS) {
      const measured = ratio(token(role, theme), token(ground, theme));
      expect(
        measured,
        `--${role} on --${ground} (${theme}) is ${measured.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(min);
    }
  });

  it('keeps the placeholder role quieter than tertiary, but above the text bar', () => {
    // Both halves matter. Above 4.5:1 or every field in the app fails 1.4.3;
    // below tertiary or the role has no reason to exist and a placeholder
    // stops reading as an empty field.
    const surface = token('color-surface', theme);
    const placeholder = ratio(token('color-text-placeholder', theme), surface);
    const tertiary = ratio(token('color-text-tertiary', theme), surface);

    expect(placeholder).toBeGreaterThanOrEqual(4.5);
    expect(placeholder).toBeLessThan(tertiary);
  });

  it('text-disabled clears only the 3:1 non-text bar, which is why it is not a text role', () => {
    // Asserted in both directions: it must be legible enough for an inactive
    // control (3:1), and it must NOT be quietly good enough for text — if it
    // ever were, the distinction this file draws would be worth revisiting
    // rather than silently ignored.
    const measured = ratio(token('color-text-disabled', theme), token('color-surface', theme));
    expect(measured).toBeGreaterThanOrEqual(3);
    expect(measured).toBeLessThan(4.5);
  });

  it('border-strong clears WCAG 1.4.11 against every surface it bounds', () => {
    for (const ground of GROUNDS) {
      const measured = ratio(token('color-border-strong', theme), token(ground, theme));
      expect(
        measured,
        `--color-border-strong on --${ground} (${theme}) is ${measured.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('scrollbar-thumb clears 3:1 on every ground a scroll container is painted on', () => {
    // The overlay is included because modals, drawers and menus scroll too —
    // and it is the ground border-strong misses in dark (2.98:1), which is why
    // the thumb is its own token rather than an alias of it.
    for (const ground of [...GROUNDS, 'color-surface-overlay'] as const) {
      const measured = ratio(token('color-scrollbar-thumb', theme), token(ground, theme));
      expect(
        measured,
        `--color-scrollbar-thumb on --${ground} (${theme}) is ${measured.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

/**
 * ADR-0005's two new role families.
 *
 * `primary-fill` is the brand blue behind white ink — the primary button. It
 * was split from `primary` because #1677c8 holds 4.5:1 under white but not on
 * the page or its own selection tint, where `primary` is read as text.
 *
 * The sidebar is charcoal in BOTH themes, so its roles must hold the same
 * thresholds in each — `.dark` does not redeclare them, and these assert that
 * they still clear the bar whichever theme is on.
 */
describe.each(['light', 'dark'] as const)('ADR-0005 roles — %s', (theme) => {
  it('the primary button carries its own label at 4.5:1 at rest, hovered and pressed', () => {
    for (const fill of ['color-primary-fill', 'color-primary-fill-hover', 'color-primary-pressed'] as const) {
      const measured = ratio(token('color-primary-fill-text', theme), token(fill, theme));
      expect(measured, `--color-primary-fill-text on --${fill} (${theme}) is ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary reads as text on the card, the page and its own selection tint', () => {
    for (const ground of ['color-surface', 'color-background', 'color-primary-subtle'] as const) {
      const measured = ratio(token('color-primary', theme), token(ground, theme));
      expect(measured, `--color-primary on --${ground} (${theme}) is ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('sidebar text roles clear 4.5:1 on every sidebar ground', () => {
    for (const fg of ['color-sidebar-text', 'color-sidebar-text-muted'] as const) {
      for (const ground of ['color-sidebar', 'color-sidebar-raised', 'color-sidebar-hover'] as const) {
        const measured = ratio(token(fg, theme), token(ground, theme));
        expect(measured, `--${fg} on --${ground} (${theme}) is ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the active sidebar item carries its label at 4.5:1 and stands 3:1 off the rail', () => {
    const label = ratio(token('color-sidebar-active-text', theme), token('color-sidebar-active', theme));
    expect(label).toBeGreaterThanOrEqual(4.5);
    const indicator = ratio(token('color-sidebar-active', theme), token('color-sidebar', theme));
    expect(indicator).toBeGreaterThanOrEqual(3);
  });

  it('the sidebar holds one look in both themes', () => {
    for (const role of [
      'color-sidebar',
      'color-sidebar-raised',
      'color-sidebar-hover',
      'color-sidebar-border',
      'color-sidebar-text',
      'color-sidebar-text-muted',
      'color-sidebar-active',
      'color-sidebar-active-text',
    ] as const) {
      expect(token(role, theme), `--${role}`).toBe(token(role, 'light'));
    }
  });

  it('the navbar AI button keeps one fill and a 3:1 boundary on the navbar', () => {
    expect(token('color-ai-launcher', theme), '--color-ai-launcher').toBe(
      token('color-ai-launcher', 'light'),
    );
    // The edge is a subtle neutral gray, re-pointed per theme so it stays
    // visible on each navbar — never the near-black it used to be.
    expect(token('color-ai-launcher-border', theme)).toBe(token('color-border-strong', theme));
    // The navbar is `surface`. The edge carries the boundary on a light bar,
    // the white fill on a dark one — at least one of the two must hold 3:1.
    const edge = ratio(token('color-ai-launcher-border', theme), token('color-surface', theme));
    const fill = ratio(token('color-ai-launcher', theme), token('color-surface', theme));
    expect(Math.max(edge, fill), `AI launcher boundary (${theme})`).toBeGreaterThanOrEqual(3);
  });

  it('the navbar AI button draws its icon in a colour that reads on its white tile', () => {
    // Found in a real browser: once the logo became a currentColor icon, the
    // `ai` variant's text-inverse (white in light) drew it white on white.
    // The icon gets its own role, fixed in both themes like the fill.
    expect(token('color-ai-launcher-icon', theme)).toBe(token('color-ai-launcher-icon', 'light'));
    const icon = ratio(token('color-ai-launcher-icon', theme), token('color-ai-launcher', theme));
    expect(icon, `AI launcher icon on its fill (${theme})`).toBeGreaterThanOrEqual(4.5);
  });
});

/** sRGB × k per channel — what CSS `brightness(k)` does to a flat colour. */
function brightness(hex: string, k: number): string {
  return `#${channels(hex)
    .map((c) => Math.round(Math.min(255, c * k)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The component roles of ADR-0005 and the shared roles each component
 * reuses, held to WCAG AA in both themes — every state a component paints.
 */
describe.each(['light', 'dark'] as const)('component roles — %s', (theme) => {
  const t = (name: string) => token(name, theme);
  const expectAtLeast = (fg: string, bg: string, min: number, fgValue = t(fg)) => {
    const measured = ratio(fgValue, t(bg));
    expect(measured, `--${fg} on --${bg} (${theme}) is ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  };

  it('checked checkbox, radio and switch stand 3:1 off the card, and their tick 3:1 on the fill', () => {
    expectAtLeast('color-primary-fill', 'color-surface', 3);
    expectAtLeast('color-primary-fill-text', 'color-primary-fill', 3);
  });

  /*
   * Regression: the dark switch drew a WHITE knob on the blue 400 track —
   * 2.60:1 (1.85:1 before ADR-0005), short of 1.4.11's 3:1. The checked knob
   * now takes the fill's own ink; the unchecked one stays the light knob.
   */
  it('the switch knob stands 3:1 off its track, checked and unchecked', () => {
    expectAtLeast('color-primary-fill-text', 'color-primary-fill', 3);
    expectAtLeast('color-control-knob', 'color-border-strong', 3);
  });

  it('secondary and ghost buttons and links read at 4.5:1, at rest and hovered', () => {
    for (const ground of ['color-surface', 'color-surface-sunken', 'color-background'] as const) {
      expectAtLeast('color-primary', ground, 4.5);
    }
    expectAtLeast('color-primary-hover', 'color-surface', 4.5);
  });

  it('the destructive button carries its label at 4.5:1, at rest and hovered', () => {
    expectAtLeast('color-text-inverse', 'color-error', 4.5);
    expectAtLeast('color-text-inverse', 'color-error-hover', 4.5);
  });

  it('the selected tab: label 4.5:1, indicator 3:1', () => {
    expectAtLeast('color-tab-active-text', 'color-surface', 4.5);
    expectAtLeast('color-tab-active-text', 'color-background', 4.5);
    expectAtLeast('color-tab-indicator', 'color-surface', 3);
  });

  it('selected rows and menu options keep body and blue text at 4.5:1', () => {
    expectAtLeast('color-text-primary', 'color-primary-subtle', 4.5);
    expectAtLeast('color-primary', 'color-primary-subtle', 4.5);
  });

  it('the filled AI button carries its label at 4.5:1, hovered included', () => {
    expectAtLeast('color-text-inverse', 'color-accent', 4.5);
    // Hover is `brightness-90` on the fill, not a token: measure the result.
    const hovered = brightness(t('color-accent'), 0.9);
    const measured = ratio(t('color-text-inverse'), hovered);
    expect(measured, `AI button label on its hover fill (${theme})`).toBeGreaterThanOrEqual(4.5);
  });

  it('the AI badge label reads at 4.5:1, filled and outlined', () => {
    expectAtLeast('color-ai-badge-text', 'color-ai-badge', 4.5);
    expectAtLeast('color-ai-badge-text', 'color-surface', 4.5);
  });

  it('every chart series outline stands 3:1 off the card', () => {
    for (const slot of [1, 2, 3, 4, 5]) expectAtLeast(`color-chart-${String(slot)}-edge`, 'color-surface', 3);
  });
});

/**
 * The value assertions above say `text-disabled` is not a text role. This
 * says nobody uses it as one — the half a token file cannot enforce, and the
 * half the defect actually lived in.
 *
 * Scoped to `placeholder:` deliberately. `text-text-disabled` on a
 * `disabled:` variant is correct and stays; it is the unconditional
 * placeholder that was wrong.
 *
 * `Select` is checked separately below: it renders its placeholder as a real
 * element rather than through the pseudo-class, so no `placeholder:` prefix
 * appears there to scan for.
 */
const SRC = join(__dirname, '..');

function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

describe('placeholder text', () => {
  it('is never painted in the disabled token', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) =>
        /placeholder:text-text-(?:disabled|tertiary|secondary)/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(SRC, file).split(sep).join('/'));

    expect(offenders).toStrictEqual([]);
  });

  it('is painted in the placeholder role wherever a field renders one', () => {
    // The floor, not a count: it catches a refactor that drops the rule from
    // the shared field builder and leaves every input inheriting body text.
    const users = sourceFiles(SRC).filter((file) =>
      /text-text-placeholder/.test(readFileSync(file, 'utf8')),
    );

    expect(users.map((file) => relative(SRC, file).split(sep).join('/')).sort()).toStrictEqual([
      'components/ui/Select.tsx',
      'components/ui/internal/styles.ts',
      'features/doctor/messaging/components/MessageComposer.tsx',
    ]);
  });
});
