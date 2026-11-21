import { useMemo, useState } from 'react';

import {
  Ban,
  BadgeCheck,
  KeyRound,
  MoreHorizontal,
  Star,
  UserRoundCheck,
  UserRoundPlus,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';


import { useAuth, useToast } from '@/app/providers';
import { ExportButton, StatusBadge } from '@/components/patterns';
import { Avatar, Button, ConfirmationDialog, DataTable, type DataTableColumn, Dropdown, type MenuEntry, SearchInput, Select, Tabs } from '@/components/ui';
import { routes } from '@/routes';
import type { ExportDataset } from '@/utils/export';

import { AsyncSection, GridEmpty, Panel } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';
import { adminRefusal } from '../refusal';

import {
  doctorsCapabilities,
  useDoctorsDocument,
  useDoctorsMutations,
} from './api/useDoctorsQueries';
import {
  ACCOUNT_LABEL,
  ACCOUNT_KIND,
  canReactivate,
  canSuspend,
  EMPTY_FILTERS,
  filterDoctors,
  formatDate,
  formatSince,
  JOINED_RANGE_LABEL,
  LICENCE_EXPIRY_DAYS,
  pendingSentence,
  TAB_LABEL,
  tabCounts,
  VERIFICATION_LABEL,
  VERIFICATION_KIND,
} from './doctors';
import type {
  AccountStatus,
  DoctorFilters,
  DoctorRecord,
  DoctorTab,
  JoinedRangeKey,
  VerificationStatus,
} from './doctors.types';
import { InviteDoctorDialog } from './InviteDoctorDialog';
import { ReasonDialog } from './ReasonDialog';
import { SuspensionImpact } from './SuspensionImpact';

/**
 * Doctors management (ADM-02 · UX §3.2) — the lifecycle of every doctor on
 * the platform, and the queue of the ones waiting on a decision.
 *
 * The Pending tab is the working surface: it counts only verifications an
 * administrator can act on, so the badge is a to-do list rather than a
 * tally. Suspension is the one action that reaches outside this screen —
 * it strands appointments — so it says how many before it asks.
 *
 * Row actions that change a doctor's standing are per-row and reasoned;
 * there is no bulk verify and no bulk suspend, deliberately.
 */

const ACCOUNT_OPTIONS = [
  { value: 'all', label: 'Any status' },
  ...(['active', 'suspended', 'vacation'] as const).map((status) => ({
    value: status,
    label: ACCOUNT_LABEL[status],
  })),
];

const VERIFICATION_OPTIONS = [
  { value: 'all', label: 'Any verification' },
  ...(['verified', 'pending', 'docs-requested', 'rejected'] as const).map((status) => ({
    value: status,
    label: VERIFICATION_LABEL[status],
  })),
];

const JOINED_OPTIONS = (['any', '30d', '90d', '365d'] as const).map((range) => ({
  value: range,
  label: JOINED_RANGE_LABEL[range],
}));

/**
 * The horizon is the shared constant rather than a literal 30, so the option
 * an administrator reads here and the queue row that sent them cannot come to
 * describe different windows.
 */
const EXPIRING_OPTIONS = [
  { value: 'all', label: 'Any licence' },
  { value: 'expiring', label: `Licence expiring < ${String(LICENCE_EXPIRY_DAYS)} days` },
];

export function DoctorsSection() {
  const document = useDoctorsDocument();
  const { suspend, reactivate, resetAccess, invite } = useDoctorsMutations();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  /*
   * `?tab=` and `?expiring=soon` arrive from the ADM-01 action queue, so a
   * count clicked on the overview lands on exactly the rows it promised. Read
   * once, as the initial state: the URL seeds the view, it does not own it —
   * the same contract `?doctor=` has on appointment oversight.
   *
   * `expiring` is a flag rather than a horizon, and is read as one: the
   * window is `LICENCE_EXPIRY_DAYS` on both sides of the link, so honouring
   * an arbitrary number here would be a promise the count cannot keep.
   */
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<DoctorTab>(() => {
    const requested = searchParams.get('tab');
    return requested === 'pending' || requested === 'active' || requested === 'suspended'
      ? requested
      : 'all';
  });
  const [filters, setFilters] = useState<DoctorFilters>(() =>
    searchParams.get('expiring') === 'soon' ? { ...EMPTY_FILTERS, expiring: true } : EMPTY_FILTERS,
  );
  const [inviting, setInviting] = useState(false);
  const [suspending, setSuspending] = useState<DoctorRecord | null>(null);
  const [reactivating, setReactivating] = useState<DoctorRecord | null>(null);
  const [resetting, setResetting] = useState<DoctorRecord | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const actor = user?.name ?? 'Administrator';
  const now = Date.now();

  const doctors = useMemo(() => document.data?.doctors ?? [], [document.data]);
  const counts = useMemo(() => tabCounts(doctors), [doctors]);
  const rows = useMemo(
    () => filterDoctors(doctors, tab, filters, now),
    [doctors, tab, filters, now],
  );

  const specialties = useMemo(
    () => [...new Set(doctors.map((doctor) => doctor.specialty))].sort(),
    [doctors],
  );

  const failureMessage = adminRefusal;

  /* ── Actions ────────────────────────────────────────────────── */

  const runSuspend = (reason: string) => {
    const doctor = suspending;
    if (doctor === null) return;
    setActionError(null);
    suspend.mutate(
      { doctorId: doctor.id, actor, reason },
      {
        onSuccess: () => {
          setSuspending(null);
          toast({
            variant: 'success',
            title: `${doctor.name} suspended`,
            description: 'Their upcoming appointments still need reassigning.',
          });
        },
        onError: (error) => setActionError(failureMessage(error)),
      },
    );
  };

  const runReactivate = () => {
    const doctor = reactivating;
    if (doctor === null) return;
    reactivate.mutate(
      { doctorId: doctor.id, actor },
      {
        onSuccess: () => {
          setReactivating(null);
          toast({ variant: 'success', title: `${doctor.name} reactivated` });
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

  const runResetAccess = () => {
    const doctor = resetting;
    if (doctor === null) return;
    resetAccess.mutate(
      { doctorId: doctor.id, actor },
      {
        onSuccess: () => {
          setResetting(null);
          toast({
            variant: 'success',
            title: 'Reset link sent',
            description: `${doctor.email} can set a new password themselves.`,
          });
        },
        onError: (error) => {
          setResetting(null);
          toast({ variant: 'error', title: 'Nothing was sent', description: failureMessage(error) });
        },
      },
    );
  };

  const runInvite = (email: string, specialty: string, roleTemplate: string) => {
    setActionError(null);
    invite.mutate(
      { email, specialty, roleTemplate, actor },
      {
        onSuccess: () => {
          setInviting(false);
          toast({
            variant: 'success',
            title: 'Invitation sent',
            description: `${email} can now complete onboarding.`,
          });
        },
        onError: (error) => setActionError(failureMessage(error)),
      },
    );
  };

  /* ── Export ─────────────────────────────────────────────────── */

  const getDataset = (): ExportDataset => ({
    filename: 'medora-doctors',
    title: 'Doctors',
    columns: [
      'Name',
      'Specialty',
      'Licence',
      'Verification',
      'Status',
      'Patients',
      'Appointments (30d)',
      'Rating',
      'Joined',
    ],
    rows: rows.map((doctor) => [
      doctor.name,
      doctor.specialty,
      doctor.licenseNumber,
      VERIFICATION_LABEL[doctor.verification],
      ACCOUNT_LABEL[doctor.account],
      doctor.patientsCount,
      doctor.appointments30d,
      doctor.rating ?? '',
      formatDate(doctor.joinedAt),
    ]),
  });

  /* ── Columns ────────────────────────────────────────────────── */

  const columns: readonly DataTableColumn<DoctorRecord>[] = [
    {
      id: 'name',
      header: 'Doctor',
      cell: (doctor) => (
        <div className="flex items-center gap-3">
          <Avatar name={doctor.name} size="sm" roleRing="doctor" decorative />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => void navigate(routes.admin.doctor(doctor.id))}
              className="truncate rounded text-start font-medium text-text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {doctor.name}
            </button>
            {doctor.title.length > 0 ? (
              <div className="truncate text-caption text-text-tertiary">{doctor.title}</div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'specialty',
      header: 'Specialty',
      hideBelowMd: true,
      cell: (doctor) => (
        <div>
          <div>{doctor.specialty}</div>
          <div className="text-caption text-text-primary">{doctor.licenseNumber}</div>
        </div>
      ),
    },
    {
      id: 'verification',
      header: 'Verification',
      cell: (doctor) => (
        <StatusBadge
          status={VERIFICATION_KIND[doctor.verification]}
          label={VERIFICATION_LABEL[doctor.verification]}
        />
      ),
    },
    {
      id: 'account',
      header: 'Status',
      cell: (doctor) => (
        <StatusBadge status={ACCOUNT_KIND[doctor.account]} label={ACCOUNT_LABEL[doctor.account]} />
      ),
    },
    {
      id: 'patients',
      header: 'Patients',
      align: 'right',
      hideBelowMd: true,
      cell: (doctor) => <span className="tabular-nums">{doctor.patientsCount}</span>,
    },
    {
      id: 'appointments',
      header: 'Appts (30d)',
      align: 'right',
      hideBelowMd: true,
      cell: (doctor) => <span className="tabular-nums">{doctor.appointments30d}</span>,
    },
    {
      id: 'rating',
      header: 'Rating',
      align: 'right',
      hideBelowMd: true,
      cell: (doctor) =>
        doctor.rating === null ? (
          <span className="text-text-tertiary">
            —<span className="sr-only">Not yet rated</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star aria-hidden="true" className="h-3.5 w-3.5 text-warning" />
            {doctor.rating.toFixed(1)}
          </span>
        ),
    },
    {
      id: 'lastActive',
      header: 'Last active',
      hideBelowMd: true,
      cell: (doctor) => (
        <span className="whitespace-nowrap text-text-tertiary">
          {formatSince(doctor.lastActiveAt, now)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      width: '3rem',
      cell: (doctor) => <RowMenu doctor={doctor} />,
    },
  ];

  function RowMenu({ doctor }: { doctor: DoctorRecord }) {
    const entries: MenuEntry[] = [
      {
        id: 'view',
        label: 'View profile',
        icon: UserRoundCheck,
        onSelect: () => void navigate(routes.admin.doctor(doctor.id)),
      },
    ];

    if (doctor.verification !== 'verified') {
      entries.push({
        id: 'verify',
        label: 'Review verification',
        icon: BadgeCheck,
        // The decision itself lives on the Documents tab, where the evidence
        // is: a verify button in a list row would be a judgement made blind.
        onSelect: () => void navigate(`${routes.admin.doctor(doctor.id)}?tab=documents`),
      });
    }

    if (doctorsCapabilities.resetAccess) {
      entries.push({
        id: 'reset',
        label: 'Send access reset',
        icon: KeyRound,
        onSelect: () => setResetting(doctor),
      });
    }

    if (canReactivate(doctor)) {
      entries.push({
        id: 'reactivate',
        label: 'Reactivate account',
        icon: UserRoundCheck,
        onSelect: () => setReactivating(doctor),
      });
    }

    if (canSuspend(doctor)) {
      entries.push(
        { type: 'separator', id: 'sep' },
        {
          id: 'suspend',
          label: 'Suspend account',
          icon: Ban,
          destructive: true,
          onSelect: () => {
            setActionError(null);
            setSuspending(doctor);
          },
        },
      );
    }

    return (
      <Dropdown
        align="end"
        menuLabel={`Actions for ${doctor.name}`}
        entries={entries}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={MoreHorizontal}
            aria-label={`Actions for ${doctor.name}`}
          />
        }
      />
    );
  }

  const emptyLabel =
    tab === 'pending' ? 'No pending verifications ✓' : 'No doctors match these filters.';

  return (
    <SectionShell
      slug="doctors"
      actions={
        <>
          <ExportButton
            getDataset={getDataset}
            disabled={rows.length === 0}
            onExported={() => toast({ variant: 'success', title: 'Export ready' })}
          />
          {/* Live doctors self-register and are then verified; there is no
              doctor invitation to send (FE-10.10). */}
          {doctorsCapabilities.invite ? (
            <Button
              leadingIcon={UserRoundPlus}
              onClick={() => {
                setActionError(null);
                setInviting(true);
              }}
            >
              Invite doctor
            </Button>
          ) : null}
        </>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              onClear={() => setFilters({ ...filters, query: '' })}
              placeholder="Search name, email or licence number"
              aria-label="Search doctors"
            />
          </ToolbarGrow>
          <Select
            options={[
              { value: 'all', label: 'All specialties' },
              ...specialties.map((name) => ({ value: name, label: name })),
            ]}
            value={filters.specialty}
            onChange={(value) => setFilters({ ...filters, specialty: value })}
            aria-label="Filter by specialty"
            containerClassName="sm:w-48"
          />
          <Select
            options={VERIFICATION_OPTIONS}
            value={filters.verification}
            onChange={(value) =>
              setFilters({ ...filters, verification: value as VerificationStatus | 'all' })
            }
            aria-label="Filter by verification"
            containerClassName="sm:w-48"
          />
          <Select
            options={ACCOUNT_OPTIONS}
            value={filters.account}
            onChange={(value) => setFilters({ ...filters, account: value as AccountStatus | 'all' })}
            aria-label="Filter by account status"
            containerClassName="sm:w-44"
          />
          <Select
            options={JOINED_OPTIONS}
            value={filters.joined}
            onChange={(value) => setFilters({ ...filters, joined: value as JoinedRangeKey })}
            aria-label="Filter by joined date"
            containerClassName="sm:w-52"
          />
          <Select
            options={EXPIRING_OPTIONS}
            value={filters.expiring ? 'expiring' : 'all'}
            onChange={(value) => setFilters({ ...filters, expiring: value === 'expiring' })}
            aria-label="Filter by licence expiry"
            containerClassName="sm:w-56"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={document.isLoading}
        isError={document.isError}
        error={document.error}
        onRetry={() => void document.refetch()}
      >
        <div className="flex flex-col gap-4">
          <Tabs
            aria-label="Doctor lifecycle"
            value={tab}
            onValueChange={(value) => setTab(value as DoctorTab)}
            items={(['all', 'pending', 'active', 'suspended'] as const).map((value) => ({
              value,
              label: TAB_LABEL[value],
              count: counts[value],
            }))}
          />

          <Panel
            title={TAB_LABEL[tab]}
            description={`${String(rows.length)} of ${String(doctors.length)} doctors`}
            icon={UserRoundCheck}
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
                getRowId={(doctor) => doctor.id}
                caption="Doctors on the platform"
                emptyState={<GridEmpty>{emptyLabel}</GridEmpty>}
              />
            </div>
          </Panel>

          {counts.pending > 0 && tab !== 'pending' ? (
            <p className="text-caption text-text-secondary">
              {pendingSentence(counts.pending)}
            </p>
          ) : null}
        </div>
      </AsyncSection>

      <InviteDoctorDialog
        open={inviting}
        specialties={specialties}
        submitting={invite.isPending}
        error={actionError}
        onClose={() => {
          setInviting(false);
          setActionError(null);
        }}
        onConfirm={runInvite}
      />

      <ReasonDialog
        open={suspending !== null}
        title={`Suspend ${suspending?.name ?? 'this doctor'}?`}
        description="They lose access immediately. Their patients and records are untouched."
        confirmLabel="Suspend account"
        confirmIcon={Ban}
        tone="destructive"
        placeholder="e.g. Prescribing audit opened following a pharmacy report."
        consequence={
          suspending === null ? undefined : (
            <SuspensionImpact doctorId={suspending.id} doctorName={suspending.name} />
          )
        }
        submitting={suspend.isPending}
        error={actionError}
        onClose={() => {
          setSuspending(null);
          setActionError(null);
        }}
        onConfirm={runSuspend}
      />

      <ConfirmationDialog
        open={reactivating !== null}
        onClose={() => setReactivating(null)}
        onConfirm={runReactivate}
        title={`Reactivate ${reactivating?.name ?? 'this doctor'}?`}
        description="They regain access straight away. The suspension stays on their record."
        confirmLabel="Reactivate"
        tone="primary"
        loading={reactivate.isPending}
      />

      <ConfirmationDialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        onConfirm={runResetAccess}
        title={`Send an access reset to ${resetting?.name ?? 'this doctor'}?`}
        description={`A reset link goes to ${resetting?.email ?? 'their address'}. You are not setting a password — only they can do that.`}
        confirmLabel="Send reset link"
        tone="primary"
        loading={resetAccess.isPending}
      />
    </SectionShell>
  );
}
