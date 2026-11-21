import type { Meta, StoryObj } from '@storybook/react-vite';
import { Activity, CalendarCheck, FlaskConical, Pill } from 'lucide-react';

import { MetricStrip } from './MetricStrip';

/** A row of compact figures above a list. Values are pre-formatted by the caller. */
const meta = {
  title: 'Patterns/MetricStrip',
  component: MetricStrip,
  args: {
    items: [
      { id: 'booked', label: 'Booked', value: '24', icon: CalendarCheck, tone: 'primary' },
      { id: 'labs', label: 'Pending labs', value: '7', icon: FlaskConical, tone: 'warning' },
      { id: 'rx', label: 'Active prescriptions', value: '112', icon: Pill, tone: 'success' },
      { id: 'critical', label: 'Critical', value: '2', icon: Activity, tone: 'error' },
    ],
  },
} satisfies Meta<typeof MetricStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutIcons: Story = {
  args: {
    items: [
      { id: 'a', label: 'Today', value: '12' },
      { id: 'b', label: 'This week', value: '58' },
      { id: 'c', label: 'This month', value: '231' },
    ],
  },
};

export const Loading: Story = { args: { loading: true } };
