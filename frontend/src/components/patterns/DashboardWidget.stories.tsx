import type { Meta, StoryObj } from '@storybook/react-vite';
import { Table, Trash2 } from 'lucide-react';

import { EmptyState } from '../feedback/EmptyState';
import { LinkButton } from '../ui/LinkButton';

import { DashboardWidget } from './DashboardWidget';

/**
 * A dashboard card with the four states every widget must have — content,
 * loading, error and empty (UX §1.4) — plus the ⋯ menu and the header slot.
 */
const MENU = [
  { id: 'table', label: 'View as table', icon: Table, onSelect: () => {} },
  { type: 'separator' as const, id: 'sep' },
  {
    id: 'remove',
    label: 'Remove from dashboard',
    icon: Trash2,
    destructive: true,
    onSelect: () => {},
  },
];

const meta = {
  title: 'Patterns/DashboardWidget',
  component: DashboardWidget,
  args: {
    title: 'Today’s appointments',
    subtitle: '5 booked · 2 checked in',
    menu: MENU,
    children: (
      <ul className="flex flex-col gap-2 text-body-sm text-text-secondary">
        <li>09:00 · Khaled Mansour · Follow-up</li>
        <li>09:30 · Layla Haddad · New patient</li>
        <li>10:15 · Omar Saleh · Results review</li>
      </ul>
    ),
  },
} satisfies Meta<typeof DashboardWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Content: Story = {};

export const Loading: Story = { args: { loading: true } };

export const ErrorWithRetry: Story = { args: { error: { onRetry: () => {} } } };

export const Empty: Story = {
  args: {
    empty: <EmptyState title="Nothing booked today" description="Your diary is clear." />,
  },
};

export const HeaderAction: Story = {
  args: {
    menu: undefined,
    actions: (
      <LinkButton href="#" size="sm">
        View all
      </LinkButton>
    ),
  },
};

export const AiTone: Story = {
  args: {
    tone: 'ai',
    title: 'AI summary',
    subtitle: 'Generated · review before use',
    children: (
      <p className="text-body-sm text-text-secondary">
        Blood pressure trending down over the last three visits.
      </p>
    ),
  },
};
