import { useMemo, useState } from 'react';

import {
  Ban,
  KeyRound,
  LockOpen,
  MoreHorizontal,
  ShieldAlert,
  UserRound,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth, useCan, useToast } from '@/app/providers';
import { ExportButton, StatisticCard, StatusBadge } from '@/components/patterns';
import {
  Badge,
  Button,
  ConfirmationDialog,
  DataTable,
  type DataTableColumn,
  Dropdown,
  type MenuEntry,
  SearchInput,
  Select,
} from '@/components/ui';
import { routes } from '@/routes';
import type { ExportDataset } from '@/utils/export';

import { AsyncSection, GridEmpty, Panel } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';
import { MaskedIdentifier } from '../phi';

import { PatientsError } from './api/patients.api';
import { usePatientsDocument, usePatientsMutations } from './api/usePatientsQueries';
import { PatientReasonDialog } from './PatientReasonDialog';
import {
  ACTIVITY_LABEL,
  assignedDoctorNames,
  assignedDoctorOptions,
  canDeactivate,
  canReactivate,
  canResetCredentials,
  canUnlock,
  EMPTY_FILTERS,
  filterPatients,
  formatDate,
  formatSince,
  LOCK_CAUSE_LABEL,
  openWorkCount,
  REGISTERED_RANGE_LABEL,
  STATUS_LABEL,
  STATUS_KIND,
  summarise,
} from './patients';
import type {
  ActivityKey,
  PatientAccount,
  PatientAccountStatus,
  PatientFilters,
  RegisteredRangeKey,
} from './patients.types';

/**
 * Patients management (ADM-04 · UX §3.4) — administrative oversight of
 * patient *accounts*: support, access governance and lifecycle.
 *
 * Two things shape this screen more than anything else.
 *
 * **It is not a clinical list.** No column here carries a condition, a
 * result or a risk level, and there is no route from a row into one. An
 * administrator unlocking an account has no clinical need, so the screen
 * gives them no clinical data — the surest way to keep an access log clean
 * is to have nothing worth looking at.
 *
 * **Every identifier is masked by default.** Names, ids, phone numbers and
 * addresses all render through `MaskedIdentifier`, so reading one takes a
 * capability, a categorised reason and a successful audit write (ADM-10).
 * The search box still searches the *underlying* values, which is what
 * makes a masked table usable: an administrator holding a phone number off
 * a support ticket can find its row without unmasking anybody at all.
 */

const STATUS_OPTIONS = [
  { value: 'all', label: 'Any status' },
  ...(['active', 'inactive', 'locked'] as const).map((status) => ({
    value: status,
    label: STATUS_LABEL[status],
  })),
];

const REGISTERED_OPTIONS = (['any', '30d', '90d', '365d'] as const).map((range) => ({
  value: range,
  label: REGISTERED_RANGE_LABEL[range],
}));

const ACTIVITY_OPTIONS = (['any', 'recent', 'quiet', 'dormant'] as const).map((key) => ({
  value: key,
  label: ACTIVITY_LABEL[key],
}));

const OPEN_WORK_OPTIONS = [
  { value: 'all', label: 'Any issues' },
  { value: 'open', label: 'Open issues only' },
];

export function PatientsSection() {
  const document = usePatientsDocument();
  const { unlock, resetCredentials, deactivate, reactivate } = usePatientsMutations();
  const { user } = useAuth();
  const can = useCan();
  const { toast } = useToast();
  const navigate = useNavigate();

  /* `?flag=open` arrives from the ADM-01 action queue — see DoctorsSection. */
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<PatientFilters>(() =>
    searchParams.get('flag') === 'open' ? { ...EMPTY_FILTERS, openWork: true } : EMPTY_FILTERS,
  );
  const [unlocking, setUnlocking] = useState<PatientAccount | null>(null);
  const [resetting, setResetting] = useState<PatientAccount | null>(null);
  const [deactivating, setDeactivating] = useState<PatientAccount | null>(null);
  const [reactivating, setReactivating] = useState<PatientAccount | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const actor = user?.name ?? 'Administrator';
  const canManage = can('patients.manageAccounts');
  const now = Date.now();

  const patients = useMemo(() => document.data?.patients ?? [], [document.data]);
  const rows = useMemo(() => filterPatients(patients, filters, now), [patients, filters, now]);
  const summary = useMemo(() => summarise(patients), [patients]);
  const doctorOptions = useMemo(() => assignedDoctorOptions(patients), [patients]);

  const failureMessage = (error: unknown): string =>
    error instanceof PatientsError
      ? error.message
      : 'The platform did not accept that change. Nothing was altered.';

  /* ── Actions ────────────────────────────────────────────────── */

  const runUnlock = () => {
    const patient = unlocking;
    if (patient === null) return;
    unlock.mutate(
      { patientId: patient.id, actor },
      {
        onSuccess: () => {
          setUnlocking(null);
          toast({
            variant: 'success',
            title: 'Account unlocked',
            description: `${patient.id} can sign in again.`,
          });
        },
        onError: (error) => {
          setUnlocking(null);
          toast({ variant: 'error', title: 'Still locked', description: failureMessage(error) });
        },
      },
    );
  };

  const runReset = () => {
    const patient = resetting;
    if (patient === null) return;
    resetCredentials.mutate(
      { patientId: patient.id, actor },
      {
        onSuccess: () => {
          setResetting(null);
          toast({
            variant: 'success',
            title: 'Reset link sent',
            description: 'Only the patient can choose the new password.',
          });
        },
        onError: (error) => {
          setResetting(null);
          toast({ variant: 'error', title: 'Nothing was sent', description: failureMessage(error) });
        },
      },
    );
  };

  const runDeactivate = (reason: string) => {
    const patient = deactivating;
    if (patient === null) return;
    setActionError(null);
    deactivate.mutate(
      { patientId: patient.id, actor, reason },
      {
        onSuccess: () => {
          setDeactivating(null);
          toast({
            variant: 'success',
            title: 'Account deactivated',
            description: `${patient.id} can no longer sign in. Their record is untouched.`,
          });
        },
        onError: (error) => setActionError(failureMessage(error)),
      },
    );
  };

  const runReactivate = () => {
    const patient = reactivating;
    if (patient === null) return;
    reactivate.mutate(
      { patientId: patient.id, actor },
      {
        onSuccess: () => {
          setReactivating(null);
          toast({ variant: 'success', title: 'Account reactivated' });
        },
        onError: (error) => {
          setReactivating(null);
          toast({
            variant: 'error',
            title: 'Reactivation failed',
            description: failureMessage(error),
          });
        },
      },
    );
  };

  /* ── Export ─────────────────────────────────────────────────── */

  /**
   * The export omits every direct identifier — no name, phone, email or
   * date of birth. A spreadsheet leaves the governed surface the moment it
   * is written, taking the masking and the audit trail with it, so what it
   * carries is the account *standing*: enough to work a backlog, not
   * enough to identify anybody. Same rule as the ADM-05 export.
   */
  const getDataset = (): ExportDataset => ({
    filename: 'medora-patient-accounts',
    title: 'Patient accounts',
    columns: [
      'Patient ID',
      'Status',
      'Registered',
      'Doctors with access',
      'Last activity',
      'Open issues',
      'Pending access requests',
    ],
    rows: rows.map((patient) => [
      patient.id,
      STATUS_LABEL[patient.status],
      formatDate(patient.registeredAt),
      assignedDoctorNames(patient).length,
      formatDate(patient.lastActivityAt),
      patient.flags.length,
      patient.accessRequests.length,
    ]),
  });

  /* ── Columns ────────────────────────────────────────────────── */

  const columns: readonly DataTableColumn<PatientAccount>[] = [
    {
      id: 'patient',
      header: 'Patient',
      cell: (patient) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <MaskedIdentifier
            subjectId={patient.id}
            subjectLabel={`Patient ${patient.id}`}
            kind="name"
            value={patient.name}
            className="font-medium text-text-primary"
          />
          {/* Patient ID and MRN are matched character by character, so they
              are data, not metadata (ADR-0001 section 10). Only the separator
              stays faint. */}
          <div className="flex items-center gap-1.5 text-caption text-text-primary">
            <span>{patient.id}</span>
            <span aria-hidden="true" className="text-text-tertiary">
              ·
            </span>
            <MaskedIdentifier
              subjectId={patient.id}
              subjectLabel={`Patient ${patient.id}`}
              kind="mrn"
              value={patient.mrn}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Account',
      cell: (patient) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={STATUS_KIND[patient.status]} label={STATUS_LABEL[patient.status]} />
          {patient.lockCause ? (
            <span className="text-caption text-text-tertiary">
              {LOCK_CAUSE_LABEL[patient.lockCause]}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'registered',
      header: 'Registered',
      hideBelowMd: true,
      cell: (patient) => (
        <span className="whitespace-nowrap">{formatDate(patient.registeredAt)}</span>
      ),
    },
    {
      id: 'doctors',
      header: 'Doctors',
      align: 'right',
      hideBelowMd: true,
      cell: (patient) => (
        <span className="tabular-nums">{assignedDoctorNames(patient).length}</span>
      ),
    },
    {
      id: 'lastActivity',
      header: 'Last activity',
      hideBelowMd: true,
      cell: (patient) => (
        <span className="whitespace-nowrap text-text-tertiary">
          {formatSince(patient.lastActivityAt, now)}
        </span>
      ),
    },
    {
      id: 'issues',
      header: 'Open issues',
      align: 'right',
      cell: (patient) => {
        // Same helper the ordering ranks on, so the column and the sort
        // cannot drift apart again.
        const total = openWorkCount(patient);
        return total === 0 ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <Badge variant="warning">{total}</Badge>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      width: '3rem',
      cell: (patient) => <RowMenu patient={patient} />,
    },
  ];

  function RowMenu({ patient }: { patient: PatientAccount }) {
    // The label names the account, never the person — a menu button's
    // accessible name is read aloud and copied into logs, and there is no
    // point masking a table whose controls announce who is in it.
    const label = `Actions for patient ${patient.id}`;

    const entries: MenuEntry[] = [
      {
        id: 'view',
        label: 'View account',
        icon: UserRound,
        onSelect: () => void navigate(routes.admin.patient(patient.id)),
      },
    ];

    if (canManage) {
      if (canUnlock(patient)) {
        entries.push({
          id: 'unlock',
          label: 'Unlock account',
          icon: LockOpen,
          onSelect: () => setUnlocking(patient),
        });
      }

      if (canResetCredentials(patient)) {
        entries.push({
          id: 'reset',
          label: 'Reset credentials',
          icon: KeyRound,
          onSelect: () => setResetting(patient),
        });
      }

      if (canReactivate(patient)) {
        entries.push({
          id: 'reactivate',
          label: 'Reactivate account',
          icon: UserRoundCheck,
          onSelect: () => setReactivating(patient),
        });
      }

      if (canDeactivate(patient)) {
        entries.push(
          { type: 'separator', id: 'sep' },
          {
            id: 'deactivate',
            label: 'Deactivate account',
            icon: Ban,
            destructive: true,
            onSelect: () => {
              setActionError(null);
              setDeactivating(patient);
            },
          },
        );
      }
    }

    return (
      <Dropdown
        align="end"
        menuLabel={label}
        entries={entries}
        trigger={<Button variant="ghost" size="sm" leadingIcon={MoreHorizontal} aria-label={label} />}
      />
    );
  }

  return (
    <SectionShell
      slug="patients"
      actions={
        <ExportButton
          getDataset={getDataset}
          disabled={rows.length === 0}
          onExported={() =>
            toast({
              variant: 'success',
              title: 'Export ready',
              description: 'Patient identifiers were left out of the file.',
            })
          }
        />
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              onClear={() => setFilters({ ...filters, query: '' })}
              placeholder="Search name, patient ID, phone or email"
              aria-label="Search patient accounts"
            />
          </ToolbarGrow>
          <Select
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(value) =>
              setFilters({ ...filters, status: value as PatientAccountStatus | 'all' })
            }
            aria-label="Filter by account status"
            containerClassName="sm:w-44"
          />
          <Select
            options={REGISTERED_OPTIONS}
            value={filters.registered}
            onChange={(value) =>
              setFilters({ ...filters, registered: value as RegisteredRangeKey })
            }
            aria-label="Filter by registration date"
            containerClassName="sm:w-52"
          />
          <Select
            options={[
              { value: 'all', label: 'Any doctor' },
              ...doctorOptions.map((name) => ({ value: name, label: name })),
            ]}
            value={filters.doctor}
            onChange={(value) => setFilters({ ...filters, doctor: value })}
            aria-label="Filter by assigned doctor"
            containerClassName="sm:w-48"
          />
          <Select
            options={ACTIVITY_OPTIONS}
            value={filters.activity}
            onChange={(value) => setFilters({ ...filters, activity: value as ActivityKey })}
            aria-label="Filter by activity"
            containerClassName="sm:w-48"
          />
          <Select
            options={OPEN_WORK_OPTIONS}
            value={filters.openWork ? 'open' : 'all'}
            onChange={(value) => setFilters({ ...filters, openWork: value === 'open' })}
            aria-label="Filter by open issues"
            containerClassName="sm:w-44"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={document.isLoading}
        isError={document.isError}
        onRetry={() => void document.refetch()}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline"
              label="Accounts"
              value={summary.total}
              icon={UserRound}
              hint="On the platform"
            />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline"
              label="Locked"
              value={summary.locked}
              icon={ShieldAlert}
              tone={summary.locked > 0 ? 'error' : 'success'}
              hint={summary.locked > 0 ? 'Cannot sign in' : 'Nobody is locked out'}
            />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline"
              label="Open issues"
              value={summary.openIssues}
              icon={UserRoundX}
              tone={summary.openIssues > 0 ? 'warning' : 'success'}
              hint="Support flags awaiting a reply"
            />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline"
              label="Access requests"
              value={summary.pendingRequests}
              icon={KeyRound}
              tone={summary.pendingRequests > 0 ? 'warning' : 'success'}
              hint="Waiting on your decision"
            />
          </div>

          <Panel
            title="Patient accounts"
            description={`${String(rows.length)} of ${String(patients.length)} accounts · identifiers masked until revealed`}
            icon={UserRound}
            tone="primary"
            bodyClassName="p-0"
          >
            <div className="px-2 pb-2">
              <DataTable
                bare
                zebra={false}
                density="admin"
                stickyHeader={false}
                headerVoice="overline"
                columns={columns}
                rows={rows}
                getRowId={(patient) => patient.id}
                caption="Patient accounts"
                emptyState={<GridEmpty>No accounts match these filters.</GridEmpty>}
              />
            </div>
          </Panel>

          {!canManage ? (
            <p className="text-caption text-text-secondary">
              Your role can review accounts but not change them. Account controls need the
              patient-account management capability.
            </p>
          ) : null}
        </div>
      </AsyncSection>

      <ConfirmationDialog
        open={unlocking !== null}
        onClose={() => setUnlocking(null)}
        onConfirm={runUnlock}
        title={`Unlock ${unlocking?.id ?? 'this account'}?`}
        description={
          unlocking?.lockCause
            ? `It locked after: ${LOCK_CAUSE_LABEL[unlocking.lockCause].toLowerCase()}. Unlocking lets them sign in with their existing password.`
            : 'Unlocking lets them sign in with their existing password.'
        }
        confirmLabel="Unlock account"
        tone="primary"
        loading={unlock.isPending}
      />

      <ConfirmationDialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        onConfirm={runReset}
        title={`Send a credential reset to ${resetting?.id ?? 'this account'}?`}
        description="A secure link goes to the address on the account. You are not setting a password — only the patient can do that."
        confirmLabel="Send reset link"
        tone="primary"
        loading={resetCredentials.isPending}
      />

      <ConfirmationDialog
        open={reactivating !== null}
        onClose={() => setReactivating(null)}
        onConfirm={runReactivate}
        title={`Reactivate ${reactivating?.id ?? 'this account'}?`}
        description="They can sign in again. The deactivation stays in the account history."
        confirmLabel="Reactivate"
        tone="primary"
        loading={reactivate.isPending}
      />

      <PatientReasonDialog
        open={deactivating !== null}
        title={`Deactivate ${deactivating?.id ?? 'this account'}?`}
        description="They lose portal access immediately. Their medical record is untouched and their doctors keep their access."
        confirmLabel="Deactivate account"
        confirmIcon={Ban}
        tone="destructive"
        placeholder="e.g. Closure requested by the patient in ticket SUP-4471."
        submitting={deactivate.isPending}
        error={actionError}
        onClose={() => {
          setDeactivating(null);
          setActionError(null);
        }}
        onConfirm={runDeactivate}
      />
    </SectionShell>
  );
}
