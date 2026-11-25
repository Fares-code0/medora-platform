import type { Config } from 'tailwindcss';

/**
 * Tailwind theme mapped to the Medora Design System CSS variables.
 * Source of truth: DESIGN_SYSTEM.md §12 — do not add raw hex values here.
 * Theme switching (light/dark) happens by swapping the semantic variable
 * layer on <html> (`.dark`), never by changing utility classes.
 */

/**
 * Maps a DS token to a colour Tailwind can also apply `/opacity` to.
 *
 * The tokens hold whole colours (`--color-primary: #2563eb`), not channel
 * triplets, so the `<alpha-value>` placeholder has nothing to interpolate
 * into. Left as a bare `var(...)` string, Tailwind silently drops every
 * modified utility — `bg-primary/40` emitted no CSS at all, which is what
 * flattened the Heatmap intensity ramp. `color-mix()` applies the alpha off
 * the same variable, so the tokens stay single-valued and theme swapping
 * keeps working.
 */
function token(name: string): string {
  const color = `var(--color-${name})`;
  const resolve = ({ opacityValue }: { opacityValue?: string }): string => {
    if (opacityValue === undefined) return color;
    const alpha = Number(opacityValue);
    // Arbitrary modifiers (`bg-primary/[var(--x)]`) are not numeric; fall back
    // to the opaque colour rather than emitting invalid CSS.
    if (!Number.isFinite(alpha)) return color;
    return `color-mix(in srgb, ${color} ${String(alpha * 100)}%, transparent)`;
  };
  // Tailwind resolves functional colour values at build time, but its public
  // `Config` type only admits plain strings, so the shape is asserted here
  // rather than dropping `satisfies Config` for the whole theme.
  return resolve as unknown as string;
}

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /*
       * `touch:` — a primary pointer that is a finger (DEC-008). Keyed on the
       * input device, not the viewport: a narrow desktop window keeps its
       * mouse-sized controls, and a tablet wider than `lg` still gets
       * 44px targets. Pairs with `.touch-target` in globals.css.
       */
      screens: {
        touch: { raw: '(pointer: coarse)' },
      },
      colors: {
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          pressed: token('primary-pressed'),
          subtle: token('primary-subtle'),
          // The brand blue as a FILL behind white ink — the primary button
          // (ADR-0005). DEFAULT is the interactive tone, read as text.
          fill: token('primary-fill'),
          'fill-hover': token('primary-fill-hover'),
          // Ink ON the fill: button label, checkbox tick, checked switch knob.
          'fill-text': token('primary-fill-text'),
        },
        secondary: {
          DEFAULT: token('secondary'),
          hover: token('secondary-hover'),
          subtle: token('secondary-subtle'),
        },
        accent: {
          DEFAULT: token('accent'),
          subtle: token('accent-subtle'),
        },
        // Component roles (ADR-0005): re-themed without moving shared roles.
        'ai-badge': {
          DEFAULT: token('ai-badge'),
          text: token('ai-badge-text'),
        },
        /* The navbar's Medora AI button — its own roles, fixed across themes. */
        'ai-launcher': {
          DEFAULT: token('ai-launcher'),
          border: token('ai-launcher-border'),
          icon: token('ai-launcher-icon'),
        },
        tab: {
          'active-text': token('tab-active-text'),
          indicator: token('tab-indicator'),
        },
        success: {
          DEFAULT: token('success'),
          subtle: token('success-subtle'),
        },
        warning: {
          DEFAULT: token('warning'),
          subtle: token('warning-subtle'),
        },
        error: {
          DEFAULT: token('error'),
          hover: token('error-hover'),
          subtle: token('error-subtle'),
        },
        info: {
          DEFAULT: token('info'),
          subtle: token('info-subtle'),
        },
        /*
         * Categorical chart ramp — NOT a semantic tone. Charts pick from this
         * so a series can never borrow an alarm colour (ADR-0001 §9). Each
         * slot carries `edge`, the darker same-hue outline; slots 4 and 5 are
         * deliberately pale and depend on it for contrast.
         */
        chart: {
          1: { DEFAULT: token('chart-1'), edge: token('chart-1-edge') },
          2: { DEFAULT: token('chart-2'), edge: token('chart-2-edge') },
          3: { DEFAULT: token('chart-3'), edge: token('chart-3-edge') },
          4: { DEFAULT: token('chart-4'), edge: token('chart-4-edge') },
          5: { DEFAULT: token('chart-5'), edge: token('chart-5-edge') },
        },
        background: token('background'),
        surface: {
          DEFAULT: token('surface'),
          sunken: token('surface-sunken'),
          overlay: token('surface-overlay'),
        },
        border: {
          DEFAULT: token('border'),
          strong: token('border-strong'),
        },
        text: {
          primary: token('text-primary'),
          secondary: token('text-secondary'),
          tertiary: token('text-tertiary'),
          placeholder: token('text-placeholder'),
          disabled: token('text-disabled'),
          inverse: token('text-inverse'),
        },
        /*
         * The application sidebar — charcoal in BOTH themes (ADR-0005). Its
         * own roles, because none of the theme surfaces holds still across
         * the light/dark switch.
         */
        sidebar: {
          DEFAULT: token('sidebar'),
          raised: token('sidebar-raised'),
          hover: token('sidebar-hover'),
          border: token('sidebar-border'),
          text: token('sidebar-text'),
          'text-muted': token('sidebar-text-muted'),
          active: token('sidebar-active'),
          'active-text': token('sidebar-active-text'),
        },
        'control-knob': token('control-knob'),
        'focus-ring': token('focus-ring'),
        scrim: token('scrim'),
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        // DS §3.2 type scale — size + line height pairs
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)' }],
        h1: ['var(--text-h1)', { lineHeight: 'var(--leading-h1)' }],
        h2: ['var(--text-h2)', { lineHeight: 'var(--leading-h2)' }],
        h3: ['var(--text-h3)', { lineHeight: 'var(--leading-h3)' }],
        h4: ['var(--text-h4)', { lineHeight: 'var(--leading-h4)' }],
        h5: ['var(--text-h5)', { lineHeight: 'var(--leading-h5)' }],
        h6: ['var(--text-h6)', { lineHeight: 'var(--leading-h6)' }],
        body: ['var(--text-body)', { lineHeight: 'var(--leading-body)' }],
        'body-sm': ['var(--text-body-sm)', { lineHeight: 'var(--leading-body-sm)' }],
        caption: ['var(--text-caption)', { lineHeight: 'var(--leading-caption)' }],
        // Large numerals (KPI values, chart centre labels) and the
        // dense-data floor for axis ticks — the two steps the scale was
        // missing, which is why 13 `text-[Npx]` one-offs had escaped it.
        metric: ['var(--text-metric)', { lineHeight: 'var(--leading-metric)' }],
        micro: ['var(--text-micro)', { lineHeight: 'var(--leading-micro)' }],
      },
      /*
       * Named for role, not size (ADR-0001 §11). `pill` is declared here so
       * the token is actually consumed — `rounded-full` had been resolving
       * to Tailwind's built-in 9999px, leaving --radius-pill dead.
       */
      borderRadius: {
        control: 'var(--radius-control)',
        surface: 'var(--radius-surface)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        popover: 'var(--shadow-popover)',
        modal: 'var(--shadow-modal)',
        focus: 'var(--shadow-focus)',
      },
      transitionDuration: {
        fast: '100ms',
        base: '150ms',
        moderate: '200ms',
        slow: '250ms',
        entrance: '300ms',
        // Interaction scale — tokens.css / styles/motion.ts.
        popover: '250ms',
        menu: '350ms',
        panel: '600ms',
        expand: '700ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0, 0, 0.2, 1)',
        in: 'cubic-bezier(0.4, 0, 1, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
        emphasized: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      zIndex: {
        sticky: '100',
        dropdown: '1000',
        drawer: '1100',
        modal: '1200',
        toast: '1300',
      },
      maxWidth: {
        // DS §4.3 container widths
        'container-sm': '640px',
        'container-md': '768px',
        'container-lg': '1024px',
        'container-xl': '1280px',
        'container-2xl': '1440px',
        prose: '65ch',
      },
    },
  },
  plugins: [],
} satisfies Config;
