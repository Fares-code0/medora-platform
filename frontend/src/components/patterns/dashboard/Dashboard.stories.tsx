import { useRef, useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarCheck, FlaskConical, MessageSquare, Pill, Table } from 'lucide-react';

import { Button } from '../../ui/Button';
import { DashboardWidget } from '../DashboardWidget';

import { CustomizeDashboardDrawer } from './CustomizeDashboardDrawer';
import { CustomizeDashboardButton, DashboardEmptyState } from './DashboardEmptyState';
import { DashboardGreeting } from './DashboardGreeting';
import { DashboardWidgetGrid } from './DashboardWidgetGrid';
import type {
  DashboardWidgetChrome,
  DashboardWidgetDefinition,
  DashboardWidgetGroupDefinition,
} from './types';
import { WidgetMenu } from './WidgetMenu';

/**
 * The customizable dashboard the Doctor and Admin Overviews share: greeting
 * band, widget grid, ⋯ menu, customize drawer and the empty state. The
 * "Interactive" story wires them together the way an Overview does — remove a
 * widget from its menu, add it back from the drawer, or remove them all.
 */
type WidgetId = 'appointments' | 'labs' | 'prescriptions' | 'messages';
type GroupId = 'clinical' | 'communication';

const GROUPS: readonly DashboardWidgetGroupDefinition<GroupId>[] = [
  { id: 'clinical', label: 'Clinical', tone: 'bg-primary-subtle text-primary' },
  { id: 'communication', label: 'Communication', tone: 'bg-info-subtle text-info' },
];

function Metric({ title, value }: { title: string; value: string }) {
  return function MetricWidget({ menu, className }: DashboardWidgetChrome) {
    return (
      <DashboardWidget title={title} menu={menu} className={className}>
        <p className="text-h2 font-semibold text-text-primary tabular-nums">{value}</p>
      </DashboardWidget>
    );
  };
}

const CATALOGUE: Record<WidgetId, DashboardWidgetDefinition<WidgetId, GroupId>> = {
  appointments: {
    id: 'appointments',
    title: 'Appointments',
    description: 'Today’s booked visits',
    icon: CalendarCheck,
    size: 'compact',
    group: 'clinical',
    source: 'sample',
    component: Metric({ title: 'Appointments', value: '12' }),
  },
  labs: {
    id: 'labs',
    title: 'Pending labs',
    description: 'Results awaiting review',
    icon: FlaskConical,
    size: 'compact',
    group: 'clinical',
    source: 'sample',
    component: Metric({ title: 'Pending labs', value: '7' }),
  },
  prescriptions: {
    id: 'prescriptions',
    title: 'Prescriptions',
    description: 'Renewals due this week',
    icon: Pill,
    size: 'standard',
    group: 'clinical',
    source: 'unavailable',
    component: Metric({ title: 'Prescriptions', value: '3' }),
  },
  messages: {
    id: 'messages',
    title: 'Messages',
    description: 'Unread patient messages',
    icon: MessageSquare,
    size: 'wide',
    group: 'communication',
    source: 'none',
    component: Metric({ title: 'Messages', value: '5' }),
  },
};

const ALL = Object.keys(CATALOGUE) as WidgetId[];

function Interactive({ initial }: { initial: readonly WidgetId[] }) {
  const [active, setActive] = useState<readonly WidgetId[]>(initial);
  // The drawer edits a draft; only Done copies it onto the dashboard.
  const [draft, setDraft] = useState<readonly WidgetId[] | null>(null);
  const open = draft !== null;
  const setOpen = (next: boolean) => setDraft(next ? [...active] : null);
  const customizeRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <DashboardGreeting
        name="Dr. Chen"
        summary={`${String(active.length)} widgets`}
        actions={
          <CustomizeDashboardButton onClick={() => setOpen(true)} widgetCount={active.length} />
        }
      />
      {active.length === 0 ? (
        <DashboardEmptyState
          title="Your dashboard is empty"
          description="Add the widgets you want to see first thing."
          onCustomize={() => setOpen(true)}
          customizeRef={customizeRef}
          secondaryAction={<Button variant="ghost">Go to schedule</Button>}
        />
      ) : (
        <DashboardWidgetGrid
          activeIds={active}
          getWidget={(id) => CATALOGUE[id]}
          onRemove={(id) => setActive((current) => current.filter((entry) => entry !== id))}
          widgetProps={{}}
        />
      )}
      <CustomizeDashboardDrawer
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => {
          if (draft !== null) setActive(draft);
          setDraft(null);
        }}
        widgets={ALL.map((id) => CATALOGUE[id])}
        groups={GROUPS}
        isActive={(id) => draft?.includes(id) ?? false}
        activeCount={draft?.length ?? 0}
        onToggle={(id, on) =>
          setDraft((current) =>
            current === null ? current : on ? [...current, id] : current.filter((e) => e !== id),
          )
        }
        onClear={() => setDraft((current) => (current === null ? current : []))}
      />
    </div>
  );
}

const meta = { title: 'Patterns/Dashboard' } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive_: Story = {
  name: 'Interactive',
  render: () => <Interactive initial={ALL} />,
};

export const Empty: Story = { render: () => <Interactive initial={[]} /> };

/*
 * One greeting per story: its `<header>` is the page banner when nothing
 * wraps it, and two on one page are two banners. In the app it sits inside
 * `<main>`, where a header is not a landmark at all.
 */
export const Greeting: Story = { render: () => <DashboardGreeting name="Dr. Chen" /> };

export const GreetingWithSummaryAndAction: Story = {
  render: () => (
    <DashboardGreeting
      name="Sara"
      summary="3 accounts awaiting approval"
      actions={<Button size="sm">Review</Button>}
    />
  ),
};

export const CustomizeDrawer: Story = {
  render: () => (
    <CustomizeDashboardDrawer
      open
      onClose={() => {}}
      onDone={() => {}}
      widgets={ALL.map((id) => CATALOGUE[id])}
      groups={GROUPS}
      isActive={(id) => id !== 'messages'}
      activeCount={3}
      onToggle={() => {}}
      onClear={() => {}}
    />
  ),
};

export const Menu: Story = {
  render: () => (
    <WidgetMenu
      title="Appointments"
      entries={[{ id: 'table', label: 'View as table', icon: Table, onSelect: () => {} }]}
    />
  ),
};
