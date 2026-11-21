import { useEffect, useState } from 'react';

import {
  Activity,
  CalendarCheck,
  Building2,
  Globe,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldAlert,
  Star,
  TrendingUp,
} from 'lucide-react';

import { BarChart, DistributionBars, LineAreaChart } from '@/components/charts';
import { Alert, ErrorState } from '@/components/feedback';
import { StatisticCard, StatusBadge } from '@/components/patterns';
import { Badge, Button, DataTable, type DataTableColumn, Select } from '@/components/ui';

import { useOversightDocument } from '../appointments/api/useOversightQueries';
import { formatSlot, isTerminal, STATUS_KIND, STATUS_LABEL } from '../appointments/oversight';
import type { OversightAppointment } from '../appointments/oversight.types';
import { PatientIdentity } from '../appointments/PatientIdentity';
import { GridEmpty, Overline, Panel } from '../components/primitives';

import {
  CLINICS,
  formatDate,
  formatDateTime,
  hasImpossibleTravel,
  LOGIN_RESULT_LABEL,
  LOGIN_RESULT_KIND,
  ROLE_TEMPLATES,
} from './doctors';
import type { AdministrativeFields, DoctorRecord } from './doctors.types';

/**
 * The four reading tabs of the admin doctor profile (ADM-03 · UX §3.3).
 *
 * Two rules run through all of them. Clinical *content* never appears —
 * activity is counts, appointments are operational fields, and any patient
 * identifier goes through the ADM-10 gate. And nothing here is editable
 * except the two administrative fields §3.3 names, which carry audit
 * attribution when they change.
 */

/* ── Profile ──────────────────────────────────────────────────── */

export function DoctorProfileTab({
  doctor,
  busy,
  onSaveAdministrative,
}: {
  doctor: DoctorRecord;
  busy: boolean;
  onSaveAdministrative: (fields: AdministrativeFields) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="Personal information" icon={Mail} tone="info">
        <dl className="flex flex-col gap-3">
          <Fact icon={Mail} label="Email">
            {doctor.email}
          </Fact>
          <Fact icon={Phone} label="Phone">
            <span dir="ltr">{doctor.phone}</span>
          </Fact>
          <Fact icon={MapPin} label="Joined">
            {formatDate(doctor.joinedAt)}
          </Fact>
        </dl>
      </Panel>

      <Panel title="Professional information" icon={Building2} tone="primary">
        <dl className="flex flex-col gap-3">
          <Fact icon={Building2} label="Specialty">
            {doctor.specialty} · licence {doctor.licenseNumber}
          </Fact>
          <Fact icon={Globe} label="Languages">
            {doctor.languages.length === 0 ? '—' : doctor.languages.join(', ')}
          </Fact>
          <Fact icon={Activity} label="Biography">
            {doctor.bio.length === 0 ? '—' : doctor.bio}
          </Fact>
        </dl>
      </Panel>

      {doctor.administrative === null ? null : (
        <AdministrativePanel
          saved={doctor.administrative}
          busy={busy}
          onSave={onSaveAdministrative}
        />
      )}
    </div>
  );
}

/**
 * The two fields §3.3 lets an administrator change. Absent where the
 * platform keeps no role template or clinic assignment for a doctor — the
 * live API has neither (FE-10.10), and a form that saved to nowhere would
 * be worse than no form.
 */
function AdministrativePanel({
  saved,
  busy,
  onSave,
}: {
  saved: AdministrativeFields;
  busy: boolean;
  onSave: (fields: AdministrativeFields) => void;
}) {
  const [fields, setFields] = useState<AdministrativeFields>(saved);

  // Re-sync when the saved value changes underneath (another tab, a reload).
  useEffect(() => {
    setFields(saved);
  }, [saved]);

  const dirty = fields.roleTemplate !== saved.roleTemplate || fields.clinic !== saved.clinic;

  return (
    <Panel
      title="Administrative fields"
      description="The only fields an administrator may change here. Every change is attributed."
      icon={Save}
      tone="warning"
      className="lg:col-span-2"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Select
          label="Role template"
          options={ROLE_TEMPLATES.map((name) => ({ value: name, label: name }))}
          value={fields.roleTemplate}
          onChange={(value) => setFields({ ...fields, roleTemplate: value })}
          containerClassName="sm:flex-1"
        />
        <Select
          label="Clinic"
          options={CLINICS.map((name) => ({ value: name, label: name }))}
          value={fields.clinic}
          onChange={(value) => setFields({ ...fields, clinic: value })}
          containerClassName="sm:flex-1"
        />
        <Button leadingIcon={Save} disabled={!dirty} loading={busy} onClick={() => onSave(fields)}>
          Save changes
        </Button>
      </div>
      <p className="mt-3 text-caption text-text-secondary">
        Clinical and personal details are the doctor’s to change, not yours — they are read-only
        here by design.
      </p>
    </Panel>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
      <div className="min-w-0">
        <dt className="text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary">
          {label}
        </dt>
        <dd className="mt-0.5 text-body-sm text-text-primary">{children}</dd>
      </div>
    </div>
  );
}

/* ── Activity ─────────────────────────────────────────────────── */

export function DoctorActivityTab({ doctor }: { doctor: DoctorRecord }) {
  const flagged = hasImpossibleTravel(doctor);
  const activity = doctor.activity;
  // The profile hides this tab when there is nothing to show; the guard is
  // for the type, and for a record that lost its counts between renders.
  if (activity === null) return null;

  return (
    <div className="flex flex-col gap-4">
      {flagged ? (
        <Alert variant="error" title="Impossible travel detected">
          Two sign-ins from different countries closer together than anyone could fly. The second
          was blocked; treat this account as potentially compromised.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Records edited"
          value={activity.recordsEdited}
          icon={Activity}
          tone="info"
          hint={`Last ${String(activity.windowDays)} days`}
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Prescriptions"
          value={activity.prescriptionsIssued}
          icon={Activity}
          tone="primary"
          hint="Counts only — never content"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Labs reviewed"
          value={activity.labsReviewed}
          icon={Activity}
          tone="ai"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Messages sent"
          value={activity.messagesSent}
          icon={Activity}
          tone="secondary"
        />
      </div>

      <Panel title="Sign-in activity" icon={ShieldAlert} tone="warning" bodyClassName="p-0">
        <div className="px-2 pb-2">
          <DataTable
            bare
            zebra={false}
            density="admin"
            stickyHeader={false}
            headerVoice="overline"
            caption={`Sign-in activity for ${doctor.name}`}
            rows={doctor.logins}
            getRowId={(event) => event.id}
            emptyState={<GridEmpty>No sign-ins recorded.</GridEmpty>}
            columns={[
              {
                id: 'at',
                header: 'When',
                cell: (event) => (
                  <span className="whitespace-nowrap">{formatDateTime(event.at)}</span>
                ),
              },
              { id: 'ip', header: 'IP', hideBelowMd: true, cell: (event) => event.ip },
              {
                id: 'device',
                header: 'Device',
                hideBelowMd: true,
                cell: (event) => event.device,
              },
              { id: 'location', header: 'Location', cell: (event) => event.location },
              {
                id: 'result',
                header: 'Result',
                cell: (event) => (
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge
                      status={LOGIN_RESULT_KIND[event.result] ?? 'info'}
                      label={LOGIN_RESULT_LABEL[event.result] ?? event.result}
                    />
                    {event.impossibleTravel ? (
                      <Badge variant="error" icon={ShieldAlert}>
                        Impossible travel
                      </Badge>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

/* ── Appointments ─────────────────────────────────────────────── */

/**
 * This doctor's slice of the ADM-05 oversight store. Reading the same
 * source as Appointment Oversight rather than a per-doctor copy is what
 * stops the two screens disagreeing about the same booking.
 */
export function DoctorAppointmentsTab({ doctor }: { doctor: DoctorRecord }) {
  const document = useOversightDocument();
  const mine = (document.data?.appointments ?? []).filter(
    (appointment) => appointment.doctorId === doctor.id,
  );

  if (document.isError) {
    return <ErrorState error={document.error} onRetry={() => void document.refetch()} />;
  }

  const total = mine.length;
  const share = (predicate: (a: OversightAppointment) => boolean) =>
    total === 0 ? 0 : Math.round((mine.filter(predicate).length / total) * 100);

  const columns: readonly DataTableColumn<OversightAppointment>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (appointment) => (
        <div>
          <div className="whitespace-nowrap">{formatSlot(appointment.startsAt)}</div>
          <div className="text-caption text-text-primary">{appointment.reference}</div>
        </div>
      ),
    },
    {
      id: 'patient',
      header: 'Patient',
      cell: (appointment) => (
        <PatientIdentity
          subjectId={appointment.id}
          subjectLabel={appointment.reference}
          kind="name"
          value={appointment.patientName}
        />
      ),
    },
    { id: 'type', header: 'Type', hideBelowMd: true, cell: (a) => a.visitType },
    {
      id: 'status',
      header: 'Status',
      cell: (appointment) => (
        <StatusBadge
          status={STATUS_KIND[appointment.status]}
          label={STATUS_LABEL[appointment.status]}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="On the books"
          value={total}
          icon={CalendarCheck}
          tone="primary"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Completed"
          value={share((a) => a.status === 'completed')}
          unit="%"
          icon={TrendingUp}
          tone="success"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Cancelled"
          value={share((a) => a.status === 'cancelled')}
          unit="%"
          icon={CalendarCheck}
          tone="warning"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="No-show"
          value={share((a) => a.status === 'no-show')}
          unit="%"
          icon={CalendarCheck}
          tone="error"
        />
      </div>

      {doctor.statistics === null ? null : (
        <Panel title="Monthly volume" icon={TrendingUp} tone="info">
          <LineAreaChart
            variant="area"
            ariaLabel={`Monthly appointment volume for ${doctor.name}`}
            series={[
              {
                // Categorical series, not a clinical reading.
                name: 'Appointments',
                tone: 'chart1',
                points: doctor.statistics.monthlyVolume.map((point) => ({ ...point })),
              },
            ]}
          />
        </Panel>
      )}

      <Panel title="Recent appointments" icon={CalendarCheck} tone="primary" bodyClassName="p-0">
        <div className="px-2 pb-2">
          <DataTable
            bare
            zebra={false}
            density="admin"
            stickyHeader={false}
            headerVoice="overline"
            columns={columns}
            rows={mine.slice().sort((a, b) => b.startsAt.localeCompare(a.startsAt))}
            getRowId={(appointment) => appointment.id}
            caption={`Appointments for ${doctor.name}`}
            emptyState={<GridEmpty>No appointments on record for this doctor.</GridEmpty>}
          />
        </div>
      </Panel>

      <p className="text-caption text-text-secondary">
        {mine.filter((appointment) => !isTerminal(appointment.status)).length} of these are still
        open. Operational fields only — this is not a clinical record.
      </p>
    </div>
  );
}

/* ── Statistics ───────────────────────────────────────────────── */

export function DoctorStatisticsTab({ doctor }: { doctor: DoctorRecord }) {
  const stats = doctor.statistics;
  // Hidden by the profile when there are no statistics; see the activity tab.
  if (stats === null) return null;
  const reviews = stats.ratingDistribution.reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Patients served"
          value={stats.patientsServed}
          icon={TrendingUp}
          tone="primary"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Rating"
          value={stats.rating.toFixed(1)}
          icon={Star}
          tone="warning"
          hint={`${String(reviews)} reviews`}
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Response time"
          value={stats.avgResponseHours}
          unit="h"
          icon={Activity}
          tone="info"
          hint="Average to a patient request"
        />
        <StatisticCard
          layout="stacked"
          size="lg"
          labelVoice="overline"
          label="Appointments 30d"
          value={doctor.appointments30d}
          icon={CalendarCheck}
          tone="ai"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Rating distribution" icon={Star} tone="warning">
          <DistributionBars
            ariaLabel={`Rating distribution for ${doctor.name}`}
            series={{
              name: 'Reviews',
              tone: 'chart1',
              points: stats.ratingDistribution.map((value, index) => ({
                label: `${String(index + 1)}★`,
                value,
              })),
            }}
          />
        </Panel>

        <Panel title="Appointment volume" icon={TrendingUp} tone="primary">
          <BarChart
            ariaLabel={`Appointment volume for ${doctor.name}`}
            series={{
              name: 'Appointments',
              tone: 'chart1',
              points: stats.monthlyVolume.map((point) => ({ ...point })),
            }}
          />
        </Panel>
      </div>

      <Panel title="Administrative history" icon={Activity} tone="secondary">
        <ol className="flex flex-col">
          {doctor.audit.map((entry) => (
            <li
              key={entry.id}
              className="relative flex flex-col gap-0.5 border-s border-border py-2 ps-4"
            >
              <span
                aria-hidden="true"
                className="absolute -left-[3px] top-3.5 h-1.5 w-1.5 rounded-pill bg-border-strong"
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-sm font-medium text-text-primary">{entry.action}</span>
                <span className="text-caption tabular-nums text-text-tertiary">
                  {formatDateTime(entry.at)}
                </span>
              </div>
              <span className="text-caption text-text-secondary">{entry.detail}</span>
              <Overline>{entry.actor}</Overline>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
