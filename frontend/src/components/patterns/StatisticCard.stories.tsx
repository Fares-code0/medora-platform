import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarCheck, FlaskConical, Pill, Users } from 'lucide-react';

import { KpiWidget } from './KpiWidget';
import { StatisticCard, type StatisticTone } from './StatisticCard';

/**
 * One figure with its label, delta and hint. A delta's colour follows its
 * `tone` (good news or bad), not its direction, and its accessible text
 * carries the comparison, so the arrow is never the only signal.
 */
const TONES: readonly StatisticTone[] = [
  'primary',
  'secondary',
  'success',
  'warning',
  'error',
  'info',
  'ai',
  'neutral',
];

const meta = {
  title: 'Patterns/StatisticCard',
  component: StatisticCard,
  args: {
    label: 'Patients seen',
    value: '128',
    icon: Users,
    tone: 'primary',
    delta: { direction: 'up', label: '12%', tone: 'positive', comparison: 'vs last week' },
    hint: 'This week',
  },
} satisfies Meta<typeof StatisticCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {};

export const Stacked: Story = { args: { layout: 'stacked', size: 'lg' } };

export const WithUnit: Story = {
  args: {
    label: 'Average wait',
    value: '14',
    unit: 'min',
    icon: CalendarCheck,
    delta: { direction: 'down', label: '3 min', tone: 'positive', comparison: 'vs yesterday' },
  },
};

export const BadNews: Story = {
  args: {
    label: 'Critical results',
    value: '4',
    icon: FlaskConical,
    tone: 'error',
    delta: { direction: 'up', label: '2', tone: 'negative', comparison: 'vs yesterday' },
  },
};

export const Flat: Story = {
  args: { delta: { direction: 'flat', label: '0%', tone: 'neutral', comparison: 'vs last week' } },
};

export const OverlineLabel: Story = { args: { labelVoice: 'overline', caption: 'Last 7 days' } };

export const Loading: Story = { args: { loading: true } };

export const AllTones: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {TONES.map((tone) => (
        <StatisticCard key={tone} label={`Tone: ${tone}`} value="42" icon={Pill} tone={tone} />
      ))}
    </div>
  ),
};

/** `KpiWidget` — a statistic card with a sparkline, optionally a link. */
export const Kpi: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <KpiWidget
        label="Appointments"
        value="36"
        icon={CalendarCheck}
        tone="primary"
        sparkline={[12, 18, 15, 22, 26, 24, 36]}
        delta={{ direction: 'up', label: '8%', tone: 'positive', comparison: 'vs last week' }}
      />
      <KpiWidget
        label="Pending results"
        value="9"
        icon={FlaskConical}
        tone="warning"
        sparkline={[14, 12, 13, 10, 11, 9, 9]}
        href="#"
      />
      <KpiWidget label="Loading" value="—" icon={Users} loading sparkline={[1, 2, 3]} />
    </div>
  ),
};
