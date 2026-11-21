import { contrastRatio, hueDistance, hueOf, suggestAccessible } from './color';
import type { Palette, WebToken } from './tokens';

/**
 * The accessibility checks the playground runs on every edit.
 *
 * They restate, against an arbitrary palette, the assertions the test suites
 * hold the shipped tokens to — `styles/contrast.test.ts` and
 * `features/status-encoding.test.ts` on the web,
 * `patient-app/src/theme/theme.test.tsx` on mobile — plus a few the
 * component comments in tokens.css call load-bearing (chart edges, the
 * focus ring). A palette with no `fail` here passes those suites' contrast
 * assertions; a `warn` is a design heuristic, never a WCAG failure.
 *
 * WCAG 2.2 AA thresholds: 4.5:1 text (1.4.3), 3:1 for UI boundaries and
 * meaningful graphics (1.4.11), 3:1 for the focus indicator.
 */

export type Severity = 'fail' | 'warn';

export interface ContrastFinding {
  readonly id: string;
  readonly severity: Severity;
  readonly message: string;
  /** The tokens involved — the first one is the one a suggestion would change. */
  readonly tokens: readonly WebToken[];
  readonly ratio: number | null;
  readonly min: number | null;
  /** A nearby value for `tokens[0]` that passes. Shown, never auto-applied. */
  readonly suggestion: string | null;
}

interface PairRule {
  readonly fg: WebToken;
  readonly bg: WebToken;
  readonly min: number;
  readonly why: string;
}

const GROUNDS: readonly WebToken[] = ['--color-surface', '--color-surface-sunken', '--color-background'];

function pairs(): PairRule[] {
  const out: PairRule[] = [];
  const onGrounds = (fg: WebToken, min: number, why: string, grounds = GROUNDS) => {
    for (const bg of grounds) out.push({ fg, bg, min, why });
  };

  for (const fg of ['--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-text-placeholder'] as const) {
    onGrounds(fg, 4.5, 'body text (WCAG 1.4.3)');
  }
  out.push({ fg: '--color-text-primary', bg: '--color-surface-overlay', min: 4.5, why: 'text in modals and menus' });
  out.push({ fg: '--color-text-secondary', bg: '--color-surface-overlay', min: 4.5, why: 'text in modals and menus' });

  // --color-scrollbar-thumb is a copy of border-strong, so one rule covers both.
  onGrounds('--color-border-strong', 3, 'input/checkbox boundary and scrollbar thumb (WCAG 1.4.11)', [
    ...GROUNDS,
    '--color-surface-overlay',
  ]);
  out.push({ fg: '--color-text-disabled', bg: '--color-surface', min: 3, why: 'disabled control (WCAG 1.4.11)' });
  onGrounds('--color-focus-ring', 3, 'focus indicator (WCAG 2.4.13 / 1.4.11)', ['--color-surface', '--color-background']);

  for (const bg of ['--color-primary', '--color-primary-hover', '--color-error', '--color-error-hover', '--color-success', '--color-accent', '--color-warning'] as const) {
    out.push({ fg: '--color-text-inverse', bg, min: 4.5, why: 'label on a filled button/badge' });
  }

  // Components (ADR-0005). The primary button, in every state, and the
  // checked controls that share its fill.
  for (const bg of ['--color-primary-fill', '--color-primary-fill-hover', '--color-primary-pressed'] as const) {
    out.push({ fg: '--color-primary-fill-text', bg, min: 4.5, why: 'primary button label' });
  }
  out.push({ fg: '--color-primary-fill', bg: '--color-surface', min: 3, why: 'checked checkbox/radio/switch against the card (WCAG 1.4.11)' });
  out.push({ fg: '--color-primary-fill-text', bg: '--color-primary-fill', min: 3, why: 'checkbox tick and switch knob on the checked fill (WCAG 1.4.11)' });
  out.push({ fg: '--color-control-knob', bg: '--color-border-strong', min: 3, why: 'switch knob on the unchecked track (WCAG 1.4.11)' });
  onGrounds('--color-tab-active-text', 4.5, 'selected tab label', ['--color-surface', '--color-background']);
  out.push({ fg: '--color-tab-indicator', bg: '--color-surface', min: 3, why: 'selected tab indicator (WCAG 1.4.11)' });

  // The sidebar (ADR-0005): its own grounds, the same text bar.
  for (const fg of ['--color-sidebar-text', '--color-sidebar-text-muted'] as const) {
    for (const bg of ['--color-sidebar', '--color-sidebar-raised', '--color-sidebar-hover'] as const) {
      out.push({ fg, bg, min: 4.5, why: 'sidebar label (WCAG 1.4.3)' });
    }
  }
  out.push({ fg: '--color-sidebar-active-text', bg: '--color-sidebar-active', min: 4.5, why: 'active sidebar item label' });
  out.push({ fg: '--color-sidebar-active', bg: '--color-sidebar', min: 3, why: 'active sidebar item against the rail (WCAG 1.4.11)' });

  out.push({ fg: '--color-primary', bg: '--color-surface', min: 4.5, why: 'link / secondary-button text' });
  out.push({ fg: '--color-primary', bg: '--color-background', min: 4.5, why: 'link text on the page' });
  out.push({ fg: '--color-primary', bg: '--color-primary-subtle', min: 4.5, why: 'selected nav item / row text' });
  out.push({ fg: '--color-text-primary', bg: '--color-primary-subtle', min: 4.5, why: 'body text in a selected row or menu option' });
  out.push({ fg: '--color-accent', bg: '--color-surface', min: 4.5, why: 'AI label text' });
  out.push({ fg: '--color-accent', bg: '--color-accent-subtle', min: 4.5, why: 'AI text on the AI panel tint' });
  out.push({ fg: '--color-ai-badge-text', bg: '--color-ai-badge', min: 4.5, why: 'AI badge label' });
  out.push({ fg: '--color-ai-badge-text', bg: '--color-surface', min: 4.5, why: 'outline AI badge label' });

  for (const tone of ['--color-success', '--color-warning', '--color-error', '--color-info'] as const) {
    out.push({ fg: tone, bg: '--color-surface', min: 4.5, why: 'status text' });
    out.push({ fg: tone, bg: `${tone}-subtle`, min: 4.5, why: 'status text on its own tint' });
    out.push({ fg: tone, bg: '--color-surface-sunken', min: 3, why: 'status outline ring on sunken rows' });
  }

  const edges = [
    '--color-chart-1-edge',
    '--color-chart-2-edge',
    '--color-chart-3-edge',
    '--color-chart-4-edge',
    '--color-chart-5-edge',
  ] as const;
  for (const edge of edges) {
    out.push({ fg: edge, bg: '--color-surface', min: 3, why: 'chart mark outline (WCAG 1.4.11)' });
  }
  return out;
}

const PAIR_RULES = pairs();

/** Hue pairs that must stay apart so a brand colour never reads as a status or as AI. */
const DISTINCT: readonly { a: WebToken; b: WebToken; min: number; why: string }[] = [
  { a: '--color-accent', b: '--color-primary', min: 40, why: 'AI accent must not read as an ordinary brand control' },
  { a: '--color-primary', b: '--color-error', min: 30, why: 'brand must not read as an error' },
  { a: '--color-primary', b: '--color-warning', min: 30, why: 'brand must not read as a warning' },
  { a: '--color-primary', b: '--color-success', min: 20, why: 'brand close to success green — rely on icons and labels' },
  { a: '--color-accent', b: '--color-error', min: 30, why: 'AI accent must not read as an error' },
];

export function checkPalette(palette: Palette): ContrastFinding[] {
  const base = palette['--color-surface'];
  const findings: ContrastFinding[] = [];

  for (const rule of PAIR_RULES) {
    const ratio = contrastRatio(palette[rule.fg], palette[rule.bg], base);
    if (ratio !== null && ratio >= rule.min) continue;
    findings.push({
      id: `${rule.fg}/${rule.bg}`,
      severity: 'fail',
      message:
        ratio === null
          ? `${rule.fg} or ${rule.bg} is not a valid colour`
          : `${rule.fg} on ${rule.bg} is ${ratio.toFixed(2)}:1 — needs ${String(rule.min)}:1 (${rule.why})`,
      tokens: [rule.fg, rule.bg],
      ratio,
      min: rule.min,
      suggestion: suggestAccessible(palette[rule.fg], palette[rule.bg], rule.min, base)?.color ?? null,
    });
  }

  // Placeholder must stay QUIETER than tertiary, or it stops reading as empty.
  const placeholder = contrastRatio(palette['--color-text-placeholder'], palette['--color-surface'], base);
  const tertiary = contrastRatio(palette['--color-text-tertiary'], palette['--color-surface'], base);
  if (placeholder !== null && tertiary !== null && placeholder >= tertiary) {
    findings.push({
      id: 'placeholder/tertiary',
      severity: 'warn',
      message: `Placeholder (${placeholder.toFixed(2)}:1) is as loud as tertiary text (${tertiary.toFixed(2)}:1) — an empty field will look filled`,
      tokens: ['--color-text-placeholder', '--color-text-tertiary'],
      ratio: placeholder,
      min: null,
      suggestion: null,
    });
  }

  // Disabled must NOT be good enough for text — otherwise it is not visibly disabled.
  const disabled = contrastRatio(palette['--color-text-disabled'], palette['--color-surface'], base);
  if (disabled !== null && disabled >= 4.5) {
    findings.push({
      id: 'disabled/strength',
      severity: 'warn',
      message: `Disabled text is ${disabled.toFixed(2)}:1 — as strong as enabled text, so disabled controls will not look disabled`,
      tokens: ['--color-text-disabled'],
      ratio: disabled,
      min: null,
      suggestion: null,
    });
  }

  for (const rule of DISTINCT) {
    const [ha, hb] = [hueOf(palette[rule.a]), hueOf(palette[rule.b])];
    if (ha === null || hb === null) continue;
    const distance = hueDistance(ha, hb);
    if (distance >= rule.min) continue;
    findings.push({
      id: `hue:${rule.a}/${rule.b}`,
      severity: 'warn',
      message: `${rule.a} and ${rule.b} are only ${distance.toFixed(0)}° apart in hue (want ${String(rule.min)}°): ${rule.why}`,
      tokens: [rule.a, rule.b],
      ratio: null,
      min: null,
      suggestion: null,
    });
  }
  return findings;
}
