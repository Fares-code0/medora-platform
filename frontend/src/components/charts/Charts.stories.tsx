import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { BarChart } from './BarChart';
import { ChartLegend } from './ChartLegend';
import { DistributionBars } from './DistributionBars';
import { Heatmap } from './Heatmap';
import { LineAreaChart } from './LineAreaChart';
import { PieChart } from './PieChart';
import type { NamedSeries, Slice } from './types';

/**
 * The hand-rolled chart library (no chart dependency). Each chart is one
 * labelled figure with native tooltips; multi-series and pie charts toggle
 * series from a legend. Colour is never the only carrier: values reach a
 * reader through the figure's label and each mark's title.
 */
const meta = { title: 'Charts/Charts' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const VISITS: NamedSeries = {
  name: 'Visits',
  tone: 'chart1',
  points: WEEK.map((label, index) => ({ label, value: [32, 41, 38, 45, 52, 18, 9][index] ?? 0 })),
};

const NO_SHOWS: NamedSeries = {
  name: 'No-shows',
  tone: 'chart3',
  points: WEEK.map((label, index) => ({ label, value: [4, 6, 3, 5, 7, 2, 1][index] ?? 0 })),
};

const SLICES: readonly Slice[] = [
  { label: 'Cardiology', value: 42, tone: 'chart1' },
  { label: 'Endocrinology', value: 27, tone: 'chart2' },
  { label: 'Neurology', value: 18, tone: 'chart3' },
  { label: 'General', value: 13, tone: 'chart4' },
];

const frame = 'max-w-2xl';

export const Line: Story = {
  render: () => (
    <div className={frame}>
      <LineAreaChart series={[VISITS, NO_SHOWS]} ariaLabel="Visits and no-shows this week" />
    </div>
  ),
};

export const Area: Story = {
  render: () => (
    <div className={frame}>
      <LineAreaChart series={[VISITS]} variant="area" ariaLabel="Visits this week" />
    </div>
  ),
};

export const Bars: Story = {
  render: () => (
    <div className={frame}>
      <BarChart series={VISITS} ariaLabel="Visits per day" formatValue={(v) => `${String(v)}`} />
    </div>
  ),
};

export const Pie: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <PieChart slices={SLICES} ariaLabel="Referrals by specialty" />
      <PieChart
        slices={SLICES}
        variant="donut"
        centerLabel="100 referrals"
        ariaLabel="Referrals by specialty, donut"
        formatValue={(v) => `${String(v)}%`}
      />
    </div>
  ),
};

export const Distribution: Story = {
  render: () => (
    <div className={frame}>
      <DistributionBars
        series={{
          name: 'Age',
          tone: 'chart2',
          points: [
            { label: '18–34', value: 12 },
            { label: '35–49', value: 20 },
            { label: '50–64', value: 8 },
            { label: '65+', value: 15 },
          ],
        }}
        ariaLabel="Patient age distribution"
      />
    </div>
  ),
};

export const HeatmapGrid: Story = {
  name: 'Heatmap',
  render: () => (
    <div className={frame}>
      <Heatmap
        ariaLabel="Appointments by weekday and hour"
        data={{
          rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          columns: ['8am', '10am', '12pm', '2pm', '4pm'],
          cells: [
            [1, 4, 2, 3, 0],
            [0, 3, 5, 2, 1],
            [2, 2, 4, 4, 3],
            [3, 5, 1, 2, 2],
            [1, 1, 3, 5, 4],
          ],
          max: 5,
        }}
      />
    </div>
  ),
};

/** Empty data — a chart with nothing to plot still renders a labelled figure. */
export const EmptySeries: Story = {
  render: () => (
    <div className={frame}>
      <BarChart series={{ name: 'Visits', tone: 'chart1', points: [] }} ariaLabel="No visits" />
    </div>
  ),
};

function Legend() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set(['no-shows']));
  return (
    <ChartLegend
      items={[
        { key: 'visits', label: 'Visits', tone: 'chart1' },
        { key: 'no-shows', label: 'No-shows', tone: 'chart3' },
      ]}
      hidden={hidden}
      onToggle={(key) =>
        setHidden((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
    />
  );
}

export const LegendToggle: Story = { render: () => <Legend /> };
