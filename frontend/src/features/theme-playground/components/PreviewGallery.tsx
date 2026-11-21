import { useState } from 'react';

import {
  Bell,
  CalendarDays,
  ChevronDown,
  FlaskConical,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';

import { BarChart, LineAreaChart, PieChart } from '@/components/charts';
import { Alert, EmptyState, Progress, Skeleton, Spinner, Toast } from '@/components/feedback';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  CountBadge,
  DataTable,
  Dropdown,
  IconButton,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Switch,
  Tabs,
  Textarea,
  TopNavbar,
  type DataTableColumn,
} from '@/components/ui';

/**
 * Everything the preview shows, built from the project's REAL components —
 * the same Button, DataTable and BarChart the app renders — so a colour that
 * looks right here looks right in Medora. Nothing below names a colour: each
 * component paints from the tokens of the scope it is mounted in.
 *
 * `scope` keeps ids unique when the light and dark panes render side by side.
 */

interface Row {
  readonly id: string;
  readonly patient: string;
  readonly status: 'Confirmed' | 'Pending' | 'Cancelled';
  readonly time: string;
}

const ROWS: readonly Row[] = [
  { id: 'r1', patient: 'Amal Haddad', status: 'Confirmed', time: '09:00' },
  { id: 'r2', patient: 'Jonas Weber', status: 'Pending', time: '09:30' },
  { id: 'r3', patient: 'Leila Nasser', status: 'Cancelled', time: '10:15' },
  { id: 'r4', patient: 'Omar Farouk', status: 'Confirmed', time: '11:00' },
];

const STATUS_BADGE = {
  Confirmed: 'success',
  Pending: 'warning',
  Cancelled: 'error',
} as const;

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { id: 'patient', header: 'Patient', cell: (row) => row.patient, rowHeader: true },
  { id: 'time', header: 'Time', cell: (row) => row.time, numeric: true },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <Badge variant={STATUS_BADGE[row.status]} dot>
        {row.status}
      </Badge>
    ),
  },
];

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

export function PreviewGallery({ scope }: { scope: string }) {
  const [tab, setTab] = useState('overview');
  const [selected, setSelected] = useState<readonly string[]>(['r2']);
  const [checked, setChecked] = useState(true);
  const [switchOn, setSwitchOn] = useState(true);
  const [radio, setRadio] = useState('in-person');
  const [select, setSelect] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* ── Shell: navbar + sidebar + page ─────────────────────── */}
      <Section title="Navbar · Sidebar · Page">
        <div className="overflow-hidden rounded-surface border border-border">
          <TopNavbar
            start={<span className="text-h5 font-semibold text-text-primary">Medora</span>}
            end={
              <div className="flex items-center gap-2">
                <IconButton icon={Bell} aria-label="Notifications" variant="neutral" />
                <Avatar name="Dr. Sara Ali" size="sm" decorative />
              </div>
            }
          />
          <div className="flex h-72">
            <Sidebar aria-label={`Preview navigation (${scope})`}>
              <SidebarSection label="Workspace">
                <SidebarItem icon={LayoutDashboard} label="Overview" active onClick={() => undefined} />
                <SidebarItem icon={Users} label="Patients" onClick={() => undefined} />
                <SidebarItem icon={CalendarDays} label="Appointments" badgeCount={3} onClick={() => undefined} />
                <SidebarItem icon={MessageSquare} label="Messages" onClick={() => undefined} />
                <SidebarItem icon={FlaskConical} label="Labs (disabled)" disabled />
                <SidebarItem icon={Settings} label="Settings" onClick={() => undefined} />
              </SidebarSection>
            </Sidebar>
            <div className="flex flex-1 flex-col gap-3 overflow-auto bg-background p-4">
              <h4 className="text-h3 font-semibold text-text-primary">Good morning, Dr. Ali</h4>
              <p className="text-body text-text-secondary">
                Secondary copy sits here. <span className="text-text-tertiary">Tertiary metadata · 2 min ago</span>
              </p>
              <Card title="Today" subtitle="4 appointments" tone="primary">
                <p className="text-body-sm text-text-secondary">A card on the page background.</p>
              </Card>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Typography & surfaces ───────────────────────────────── */}
      <Section title="Text & surfaces">
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['bg-background', 'Background'],
              ['bg-surface', 'Surface'],
              ['bg-surface-sunken', 'Sunken'],
            ] as const
          ).map(([bg, label]) => (
            <div key={bg} className={`rounded-surface border border-border p-3 ${bg}`}>
              <p className="text-body-sm font-semibold text-text-primary">{label}</p>
              <p className="text-body-sm text-text-secondary">Secondary text</p>
              <p className="text-body-sm text-text-tertiary">Tertiary text</p>
              <p className="text-body-sm text-text-disabled">Disabled text</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-caption text-text-tertiary">Scrollbar tokens:</span>
          <span
            aria-hidden="true"
            className="flex h-16 w-3 items-start rounded-pill border border-border bg-[var(--color-scrollbar-track)] p-0.5"
          >
            <span className="h-7 w-full rounded-pill bg-[var(--color-scrollbar-thumb)]" />
          </span>
        </div>
      </Section>

      {/* ── Buttons ─────────────────────────────────────────────── */}
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" leadingIcon={Plus}>
            Primary
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive" leadingIcon={Trash2}>
            Delete
          </Button>
          <Button variant="destructive-secondary">Remove</Button>
          <Button variant="ai" leadingIcon={Sparkles}>
            Ask AI
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <IconButton icon={Settings} aria-label="Settings" variant="secondary" />
        </div>
      </Section>

      {/* ── Forms ───────────────────────────────────────────────── */}
      <Section title="Inputs · Select · Checkbox · Switch · Radio">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Patient name" placeholder="Placeholder text" helperText="Helper text" />
          <Input label="Email" defaultValue="not-an-email" error="Enter a valid email" />
          <Input label="Disabled" placeholder="Disabled field" disabled />
          <Input label="Read-only" defaultValue="Read-only value" readOnly />
          <Select
            label="Department"
            placeholder="Choose a department"
            value={select}
            onChange={setSelect}
            options={[
              { value: 'cardio', label: 'Cardiology' },
              { value: 'derma', label: 'Dermatology' },
              { value: 'neuro', label: 'Neurology' },
            ]}
          />
          <Textarea label="Notes" placeholder="Clinical notes…" rows={2} />
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <Checkbox
            label="Send reminder"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <Checkbox label="Unchecked" checked={false} onChange={() => undefined} />
          <Switch label="Notifications" checked={switchOn} onCheckedChange={setSwitchOn} />
          <Switch label="Disabled" checked={false} onCheckedChange={() => undefined} disabled />
          <RadioGroup
            label="Visit type"
            name={`visit-${scope}`}
            value={radio}
            onChange={setRadio}
            orientation="horizontal"
          >
            <Radio value="in-person" label="In person" />
            <Radio value="video" label="Video" />
          </RadioGroup>
        </div>
      </Section>

      {/* ── Tabs, badges ────────────────────────────────────────── */}
      <Section title="Tabs · Badges">
        <Tabs
          aria-label={`Preview tabs (${scope})`}
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'history', label: 'History', count: 12 },
            { value: 'labs', label: 'Labs' },
            { value: 'locked', label: 'Locked', disabled: true },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          {(['success', 'warning', 'error', 'info', 'neutral', 'ai'] as const).map((variant) => (
            <Badge key={variant} variant={variant} dot>
              {variant}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['success', 'warning', 'error', 'info', 'neutral', 'ai'] as const).map((variant) => (
            <Badge key={variant} variant={variant} emphasis="outline">
              {variant}
            </Badge>
          ))}
          <CountBadge count={7} aria-label="7 unread" />
        </div>
      </Section>

      {/* ── Alerts & toasts ─────────────────────────────────────── */}
      <Section title="Alerts · Toasts">
        <div className="grid gap-2">
          <Alert variant="info" title="Info">Lab results are ready for review.</Alert>
          <Alert variant="success" title="Success">Prescription sent to the pharmacy.</Alert>
          <Alert variant="warning" title="Warning">Allergy on file: penicillin.</Alert>
          <Alert variant="error" title="Error">The appointment could not be saved.</Alert>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['success', 'info', 'warning', 'error'] as const).map((variant) => (
            <Toast
              key={variant}
              toast={{ id: `${scope}-${variant}`, variant, title: `${variant} toast`, description: 'Toast description' }}
              onDismiss={() => undefined}
            />
          ))}
        </div>
      </Section>

      {/* ── Overlays ────────────────────────────────────────────── */}
      <Section title="Modal · Dropdown">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
          <Dropdown
            menuLabel="Preview actions"
            align="start"
            trigger={
              <Button variant="secondary" trailingIcon={ChevronDown}>
                Open dropdown
              </Button>
            }
            entries={[
              { id: 'edit', label: 'Edit', onSelect: () => undefined },
              { id: 'share', label: 'Share', onSelect: () => undefined },
              { type: 'separator', id: 'sep' },
              { id: 'delete', label: 'Delete', destructive: true, onSelect: () => undefined },
            ]}
          />
        </div>
        {/* A static copy of an open menu, so overlay colours are visible without clicking. */}
        <div className="w-56 rounded-surface border border-border bg-surface-overlay p-1 shadow-popover">
          <p className="rounded-control px-2 py-1.5 text-body-sm text-text-primary">Menu item</p>
          <p className="rounded-control bg-surface-sunken px-2 py-1.5 text-body-sm text-text-primary">Hovered item</p>
          <p className="rounded-control bg-primary-subtle px-2 py-1.5 text-body-sm font-semibold text-primary">Selected item</p>
          <p className="rounded-control px-2 py-1.5 text-body-sm text-error">Destructive item</p>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Cancel appointment?"
          description="The patient will be notified."
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Keep
              </Button>
              <Button variant="destructive" onClick={() => setModalOpen(false)}>
                Cancel appointment
              </Button>
            </div>
          }
        >
          <p className="text-body text-text-secondary">Modal body on the overlay surface, over the scrim.</p>
        </Modal>
      </Section>

      {/* ── Table ───────────────────────────────────────────────── */}
      <Section title="Table (zebra, hover, selected row)">
        <DataTable
          caption={`Preview appointments (${scope})`}
          columns={COLUMNS}
          rows={ROWS}
          getRowId={(row) => row.id}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
        />
      </Section>

      {/* ── Charts ──────────────────────────────────────────────── */}
      <Section title="Charts (chart-1 … chart-5)">
        <div className="grid gap-4">
          <Card title="Visits by weekday" padding="compact">
            <BarChart
              ariaLabel="Visits by weekday"
              series={{ name: 'Visits', tone: 'chart1', points: WEEK.map((label, i) => ({ label, value: [12, 18, 9, 15, 21][i] ?? 0 })) }}
              barTones={['chart1', 'chart2', 'chart3', 'chart4', 'chart5']}
            />
          </Card>
          <Card title="Specialty mix" padding="compact">
            <PieChart
              ariaLabel="Specialty mix"
              variant="donut"
              centerLabel="Visits"
              slices={[
                { label: 'Cardiology', value: 34, tone: 'chart1' },
                { label: 'Dermatology', value: 22, tone: 'chart2' },
                { label: 'Neurology', value: 18, tone: 'chart3' },
                { label: 'Pediatrics', value: 14, tone: 'chart4' },
                { label: 'Other', value: 12, tone: 'chart5' },
              ]}
            />
          </Card>
          <Card title="Trend" padding="compact">
            <LineAreaChart
              ariaLabel="Weekly trend"
              variant="area"
              series={[
                { name: 'This week', tone: 'chart1', points: WEEK.map((label, i) => ({ label, value: [5, 9, 7, 12, 10][i] ?? 0 })) },
                { name: 'Last week', tone: 'chart3', points: WEEK.map((label, i) => ({ label, value: [4, 6, 8, 7, 9][i] ?? 0 })) },
              ]}
            />
          </Card>
        </div>
      </Section>

      {/* ── Loading & empty ─────────────────────────────────────── */}
      <Section title="Loading · Empty">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Loading" padding="compact">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Spinner />
                <span className="text-body-sm text-text-secondary">Loading patients…</span>
              </div>
              <Progress value={62} label="Upload" showValue />
              <Progress label="Indeterminate" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </Card>
          <EmptyState
            icon={CalendarDays}
            title="No appointments today"
            description="New bookings will appear here."
            action={<Button variant="secondary">Book appointment</Button>}
          />
        </div>
      </Section>
    </div>
  );
}
