import { render, screen } from '@testing-library/react';
import { Activity, FlaskConical } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { StatisticCard, type StatisticDelta } from './StatisticCard';

/**
 * StatisticCard contract — DS §8.18, pinned in Wave 2d-a.
 *
 * The metric family had no tests at all, which is the same position the
 * tables were in before 2c-a. The "existing behaviour" blocks were written
 * against the component as it stood, so the additive props cannot move a
 * default underneath the five platform sites already rendering it.
 *
 * One deliberate exception: the value's type step. `text-[20px] leading-7`
 * was an arbitrary size that escaped the scale, and `--text-metric` exists
 * precisely for it — see the type-scale block at the end.
 */

const DELTA: StatisticDelta = {
  direction: 'up',
  label: '12%',
  tone: 'positive',
  comparison: 'vs last week',
};

describe('StatisticCard · structure', () => {
  it('sets the text block and the icon side by side, unlike MetricTile which stacks them', () => {
    const { container } = render(<StatisticCard label="Total tests" value="1,284" icon={FlaskConical} />);
    const row = container.querySelector('.flex.items-start.justify-between');
    expect(row).not.toBeNull();
  });

  it('renders the label as an uppercase overline in the platform voice', () => {
    render(<StatisticCard label="Total tests" value="1,284" />);
    const label = screen.getByText('Total tests');
    expect(label.tagName).toBe('P');
    expect(label.className).toContain('uppercase');
    expect(label.className).toContain('tracking-wider');
    expect(label.className).toContain('text-text-tertiary');
  });

  it('renders the value in bold tabular figures', () => {
    render(<StatisticCard label="L" value="1,284" />);
    const value = screen.getByText('1,284');
    expect(value.className).toContain('font-bold');
    expect(value.className).toContain('tabular-nums');
    expect(value.className).toContain('text-text-primary');
  });

  it('takes a pre-formatted string — formatting is the caller job', () => {
    render(<StatisticCard label="L" value="96.2%" />);
    expect(screen.getByText('96.2%')).toBeInTheDocument();
  });

  it('renders the icon in a 32px tone chip, defaulting to primary', () => {
    const { container } = render(<StatisticCard label="L" value="1" icon={Activity} />);
    const chip = container.querySelector('span.h-8.w-8');
    expect(chip?.className).toContain('bg-primary-subtle');
    expect(chip?.className).toContain('text-primary');
  });

  it('omits the icon chip when no icon is given', () => {
    const { container } = render(<StatisticCard label="L" value="1" />);
    expect(container.querySelector('span.h-8.w-8')).toBeNull();
  });

  it('supports the platform tone scale, including ai and neutral', () => {
    const { container: ai } = render(<StatisticCard label="L" value="1" icon={Activity} tone="ai" />);
    expect(ai.querySelector('span.h-8.w-8')?.className).toContain('bg-accent-subtle');

    const { container: neutral } = render(
      <StatisticCard label="L" value="1" icon={Activity} tone="neutral" />,
    );
    expect(neutral.querySelector('span.h-8.w-8')?.className).toContain('bg-surface-sunken');
  });
});

describe('StatisticCard · delta', () => {
  it('renders the delta as a badge with a direction glyph', () => {
    const { container } = render(<StatisticCard label="L" value="1" delta={DELTA} />);
    expect(screen.getByText('12%')).toBeInTheDocument();
    // TrendingUp for `up`.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('spells the direction and comparison out for screen readers', () => {
    render(<StatisticCard label="L" value="1" delta={DELTA} />);
    expect(screen.getByText(/up vs last week/)).toBeInTheDocument();
  });

  it('colours the badge by whether the movement is good news, not by direction', () => {
    // A fall can be positive news; tone is the caller's judgement.
    const { container } = render(
      <StatisticCard label="L" value="1" delta={{ ...DELTA, direction: 'down', tone: 'positive' }} />,
    );
    expect(container.innerHTML).toContain('success');
  });

  it('omits the delta entirely when absent', () => {
    render(<StatisticCard label="L" value="1" />);
    expect(screen.queryByText('12%')).not.toBeInTheDocument();
  });

  it('renders a caption beside the delta', () => {
    render(<StatisticCard label="L" value="1" delta={DELTA} caption="last 30 days" />);
    const caption = screen.getByText('last 30 days');
    expect(caption.className).toContain('text-caption');
    expect(caption.className).toContain('text-text-tertiary');
  });
});

describe('StatisticCard · loading', () => {
  it('renders skeletons in place of label, value and delta', () => {
    const { container } = render(<StatisticCard label="Total" value="1,284" loading />);
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
    expect(screen.queryByText('1,284')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('keeps the card shell while loading, so the grid does not reflow', () => {
    const { container } = render(<StatisticCard label="L" value="1" loading />);
    expect(container.firstElementChild).not.toBeNull();
  });
});

/* ── Type scale — the one deliberate change in 2d-a ───────────── */

describe('StatisticCard · type scale', () => {
  /**
   * Wave 1 added `--text-metric` (20px/26px) for exactly this numeral —
   * "Large numerals (KPI values, chart centre labels)… the two steps the
   * scale was missing, which is why 13 `text-[Npx]` one-offs had escaped
   * it". The token then shipped with zero consumers and this card kept its
   * arbitrary `text-[20px] leading-7`.
   *
   * Adopting it changes the line box from 28px to 26px. That is a real 2px
   * change, measured and reported rather than absorbed silently.
   */
  it('sizes the value from the scale, not an arbitrary pixel value', () => {
    render(<StatisticCard label="L" value="1,284" />);
    const value = screen.getByText('1,284');
    expect(value.className).toContain('text-metric');
    expect(value.className).not.toMatch(/text-\[\d+px\]/);
    expect(value.className).not.toContain('leading-7');
  });

  it('keeps the value colour alongside the size', () => {
    /*
     * Regression guard for the tailwind-merge trap: `cn` reads `text-metric`
     * as a colour and drops it in favour of `text-text-primary`, leaving the
     * numeral at the inherited size. The same defect cost DataTable its
     * `text-body-sm`. Both classes must survive.
     */
    render(<StatisticCard label="L" value="1,284" />);
    const value = screen.getByText('1,284');
    expect(value.className).toContain('text-metric');
    expect(value.className).toContain('text-text-primary');
  });
});

/* ── Wave 2d-a additions ──────────────────────────────────────── */

describe('StatisticCard · layout (2d-a)', () => {
  it('defaults to inline, exactly as before', () => {
    const { container } = render(<StatisticCard label="L" value="1" icon={Activity} />);
    expect(container.querySelector('.flex.items-start.justify-between')).not.toBeNull();
    expect(container.querySelector('.flex.flex-col.gap-3')).toBeNull();
  });

  it('stacks label+icon above the value when asked', () => {
    const { container } = render(
      <StatisticCard label="Total doctors" value={42} icon={Activity} layout="stacked" />,
    );
    const body = container.querySelector('.flex.flex-col.gap-3');
    expect(body).not.toBeNull();
    const header = body?.firstElementChild;
    expect(header?.className).toContain('justify-between');
    expect(header?.textContent).toBe('Total doctors');
  });

  it('keeps the icon chip in both layouts', () => {
    const { container: inline } = render(<StatisticCard label="L" value="1" icon={Activity} />);
    const { container: stacked } = render(
      <StatisticCard label="L" value="1" icon={Activity} layout="stacked" />,
    );
    expect(inline.querySelector('span.h-8.w-8')).not.toBeNull();
    expect(stacked.querySelector('span.h-8.w-8')).not.toBeNull();
  });
});

describe('StatisticCard · unit, hint, size, labelVoice (2d-a)', () => {
  it('renders a unit baseline-aligned beside the numeral', () => {
    render(<StatisticCard label="L" value={62} unit="%" />);
    const unit = screen.getByText('%');
    expect(unit.className).toContain('text-text-tertiary');
    expect(unit.parentElement?.className).toContain('items-baseline');
  });

  it('omits the unit element when there is none', () => {
    render(<StatisticCard label="L" value={62} />);
    expect(screen.getByText('62').parentElement?.children).toHaveLength(1);
  });

  it('renders the hint below the value in tabular figures', () => {
    render(<StatisticCard label="L" value={12} hint="3 pending verification" />);
    const hint = screen.getByText('3 pending verification');
    expect(hint.tagName).toBe('P');
    expect(hint.className).toContain('tabular-nums');
  });

  it('keeps hint and caption distinct — one below the value, one beside the delta', () => {
    render(
      <StatisticCard label="L" value={12} hint="3 pending" caption="last 30 days" delta={DELTA} />,
    );
    expect(screen.getByText('3 pending').tagName).toBe('P');
    expect(screen.getByText('last 30 days').tagName).toBe('SPAN');
  });

  it('offers the admin headline size without moving the default', () => {
    const { unmount } = render(<StatisticCard label="L" value={42} size="lg" />);
    expect(screen.getByText('42').className).toContain('text-h2');
    unmount();
    render(<StatisticCard label="L" value={42} />);
    expect(screen.getByText('42').className).toContain('text-metric');
  });

  it('offers the admin label voice without moving the default', () => {
    const { unmount } = render(<StatisticCard label="Doctors" value={1} labelVoice="overline" />);
    expect(screen.getByText('Doctors').className).toContain('tracking-[0.12em]');
    unmount();
    render(<StatisticCard label="Doctors" value={1} />);
    expect(screen.getByText('Doctors').className).toContain('tracking-wider');
  });

  it('accepts a raw number and renders it verbatim', () => {
    render(<StatisticCard label="L" value={1284} />);
    expect(screen.getByText('1284')).toBeInTheDocument();
  });
});

describe('StatisticCard · the admin migration configuration (2d-a)', () => {
  /**
   * Not a migration — the 37 tiles move in 2d-b. This pins the prop set that
   * reproduces MetricTile, so 2d-b applies one configuration rather than
   * seven judgement calls.
   */
  const adminConfig = { layout: 'stacked', size: 'lg', labelVoice: 'overline' } as const;

  it('reproduces the MetricTile arrangement', () => {
    const { container } = render(
      <StatisticCard
        {...adminConfig}
        label="Total doctors"
        value={42}
        icon={Activity}
        hint="3 pending verification"
      />,
    );
    const body = container.querySelector('.flex.flex-col.gap-3');
    expect(body?.firstElementChild?.textContent).toBe('Total doctors');
    expect(screen.getByText('Total doctors').className).toContain('tracking-[0.12em]');
    expect(screen.getByText('42').className).toContain('text-h2');
    expect(screen.getByText('3 pending verification').className).toContain('tabular-nums');
  });

  it('adds loading and delta — capabilities MetricTile never had', () => {
    const { container } = render(<StatisticCard {...adminConfig} label="L" value={1} loading />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });
});
