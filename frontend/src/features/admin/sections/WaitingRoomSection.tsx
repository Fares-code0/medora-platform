import { useMemo, useState } from 'react';

import { Armchair, BellRing, DoorClosed, LogOut, Plus, Timer } from 'lucide-react';

import { useAuth, useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import { StatisticCard } from '@/components/patterns';
import { Badge, Button, ConfirmationDialog, Input, Select } from '@/components/ui';
import { formatDateWith } from '@/i18n';

import { formatMinutes } from '../administration.meta';
import type { WaitingPatient } from '../administration.types';
import { CLINIC_DOCTORS, CLINIC_ID } from '../api/administration.api';
import { useWaitingRoom, useWaitingRoomMutations } from '../api/useAdministrationQueries';
import { EntityFormDrawer } from '../components/EntityFormDrawer';
import { AsyncSection, Overline } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';
import { MaskedIdentifier } from '../phi';

/** Identifies a card without identifying the patient — for prompts and logs. */
function cardLabel(patient: WaitingPatient): string {
  return `Waiting room · appt ${patient.appointmentTime} · ${patient.area}`;
}

/**
 * WaitingRoomSection — patients checked in and waiting (Phase 17; made
 * operable in Phase B). Status-tagged list with a filter and a headline of
 * waiting volume and the longest current wait.
 *
 * Until Phase B nobody could be checked in or out: the board showed state it
 * gave you no way to change. Check-in, the waiting → called → in-room
 * progression, and check-out all persist now.
 */
const STATUS_META: Record<
  WaitingPatient['status'],
  { label: string; variant: 'info' | 'warning' | 'success' }
> = {
  waiting: { label: 'Waiting', variant: 'warning' },
  called: { label: 'Called', variant: 'info' },
  'in-room': { label: 'In room', variant: 'success' },
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All patients' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'called', label: 'Called' },
  { value: 'in-room', label: 'In room' },
] as const;

/** The editable subset of a waiting patient; `id` comes from the store. */
type WaitingDraft = Omit<WaitingPatient, 'id'>;

const STATUS_FIELD_OPTIONS = STATUS_OPTIONS.filter((o) => o.value !== 'all').map((o) => ({
  value: o.value,
  label: o.label,
}));

/** D-27b: who the patient is waiting for, by account id. */
const DOCTOR_FIELD_OPTIONS = CLINIC_DOCTORS.map((doctor) => ({
  value: doctor.id,
  label: doctor.name,
}));

/** The next step in the waiting-room progression, or null at the end. */
function nextStatus(status: WaitingPatient['status']): WaitingPatient['status'] | null {
  if (status === 'waiting') return 'called';
  if (status === 'called') return 'in-room';
  return null;
}

function nowHhMm(): string {
  return formatDateWith(new Date(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function WaitingRoomSection() {
  const waiting = useWaitingRoom();
  const { create, update, remove } = useWaitingRoomMutations();
  const { toast } = useToast();
  // The server's write endpoints are administrator-only; reception reads the
  // board but is shown no control the server would refuse.
  const canOperate = useAuth().user?.role === 'admin';
  const [status, setStatus] = useState('all');
  const [checkingIn, setCheckingIn] = useState(false);
  const [pendingCheckOut, setPendingCheckOut] = useState<WaitingPatient | null>(null);

  const all = useMemo(() => waiting.data ?? [], [waiting.data]);
  const longest = useMemo(
    () => all.reduce((max, patient) => Math.max(max, patient.waitingMinutes), 0),
    [all],
  );
  const waitingCount = all.filter((p) => p.status === 'waiting').length;
  const inRoomCount = all.filter((p) => p.status === 'in-room').length;

  const rows = useMemo(
    () => all.filter((patient) => status === 'all' || patient.status === status),
    [all, status],
  );

  return (
    <SectionShell
      slug="waiting-room"
      actions={
        canOperate ? (
          <Button leadingIcon={Plus} onClick={() => setCheckingIn(true)}>
            Check in patient
          </Button>
        ) : undefined
      }
      toolbar={
        <Select
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
          aria-label="Filter by status"
          containerClassName="sm:w-48"
        />
      }
    >
      <AsyncSection
        isLoading={waiting.isLoading}
        isError={waiting.isError}
        onRetry={() => void waiting.refetch()}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="Checked in" value={all.length} icon={Armchair} tone="primary" />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="Waiting" value={waitingCount} icon={BellRing} tone="warning" />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="In room" value={inRoomCount} icon={DoorClosed} tone="success" />
            <StatisticCard
              layout="stacked"
              size="lg"
              labelVoice="overline" label="Longest wait" value={longest} unit="min" icon={Timer} tone="error" />
          </div>

          {rows.length === 0 ? (
            <p className="rounded-surface border border-dashed border-border px-4 py-10 text-center text-body-sm text-text-secondary">
              No patients match this status.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {rows.map((patient) => {
                const meta = STATUS_META[patient.status];
                const advance = nextStatus(patient.status);
                return (
                  <li
                    key={patient.id}
                    className="flex flex-wrap items-center gap-4 rounded-surface border border-border bg-surface p-4"
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="truncate text-body-sm font-semibold text-text-primary">
                        <MaskedIdentifier
                          subjectId={patient.id}
                          subjectLabel={cardLabel(patient)}
                          kind="name"
                          value={patient.patientName}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-text-tertiary">
                        <span>Appt {patient.appointmentTime}</span>
                        <span>· in {patient.checkedInAt}</span>
                        <span>· {patient.area}</span>
                      </div>
                    </div>
                    <div className="text-end">
                      <Overline>Waiting</Overline>
                      <div className="text-body-sm font-semibold text-text-primary tabular-nums">
                        {formatMinutes(patient.waitingMinutes)}
                      </div>
                    </div>
                    <Badge variant={meta.variant} dot>
                      {meta.label}
                    </Badge>
                    {canOperate ? (
                      <div className="flex items-center gap-1">
                        {advance ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              update.mutate(
                                { id: patient.id, changes: { status: advance } },
                                {
                                  onSuccess: () =>
                                    toast({
                                      variant: 'success',
                                      // Status, not name: a toast is a shared-screen surface.
                                      title: cardLabel(patient) + ' — ' + STATUS_META[advance].label,
                                    }),
                                  onError: () => toast({ variant: 'error', title: "Couldn't update " + cardLabel(patient) }),
                                },
                              );
                            }}
                          >
                            {advance === 'called' ? 'Call' : 'Seat in room'}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={LogOut}
                          aria-label={'Check out ' + cardLabel(patient)}
                          onClick={() => setPendingCheckOut(patient)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </AsyncSection>

      <EntityFormDrawer<WaitingDraft>
        open={checkingIn}
        onClose={() => setCheckingIn(false)}
        title="Check in patient"
        description="Adds the patient to today's waiting board."
        submitLabel="Check in"
        saving={create.isPending}
        value={{
          /*
           * D-27b: a check-in has to say which clinic and which doctor it
           * belongs to, or it cannot appear on a doctor-scoped board. The
           * admin checking a patient in is working inside one clinic, so
           * the clinic is not a field — it is the one they are signed in
           * to. The doctor is, and is required: an unattributed check-in is
           * invisible on every doctor's board, which reads as data loss
           * rather than as the fail-closed filter it actually is.
           */
          clinicId: CLINIC_ID,
          doctorId: '',
          patientId: '',
          patientName: '',
          appointmentTime: nowHhMm(),
          checkedInAt: nowHhMm(),
          waitingMinutes: 0,
          area: 'Main waiting area',
          status: 'waiting',
        }}
        validate={(draft) => ({
          ...(draft.patientName.trim() ? {} : { patientName: 'Enter the patient name' }),
          ...(draft.area.trim() ? {} : { area: 'Enter a waiting area' }),
          ...(draft.doctorId ? {} : { doctorId: 'Choose the doctor being waited for' }),
        })}
        onSubmit={async (draft) => {
          await create.mutateAsync(draft);
          toast({ variant: 'success', title: draft.patientName + ' checked in' });
        }}
      >
        {({ draft, patch, errors }) => (
          <>
            <Input
              label="Patient name"
              required
              value={draft.patientName}
              onChange={(event) => patch({ patientName: event.target.value })}
              error={errors.patientName}
            />
            <Select
              label="Waiting for"
              required
              placeholder="Choose a doctor"
              options={DOCTOR_FIELD_OPTIONS}
              value={draft.doctorId}
              onChange={(next) => patch({ doctorId: next })}
              error={errors.doctorId}
            />
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Input
                label="Appointment time"
                value={draft.appointmentTime}
                onChange={(event) => patch({ appointmentTime: event.target.value })}
              />
              <Input
                label="Checked in at"
                value={draft.checkedInAt}
                onChange={(event) => patch({ checkedInAt: event.target.value })}
              />
            </Grid>
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Input
                label="Waiting area"
                required
                value={draft.area}
                onChange={(event) => patch({ area: event.target.value })}
                error={errors.area}
              />
              <Select
                label="Status"
                options={STATUS_FIELD_OPTIONS}
                value={draft.status}
                onChange={(next) => patch({ status: next as WaitingPatient['status'] })}
              />
            </Grid>
          </>
        )}
      </EntityFormDrawer>

      <ConfirmationDialog
        open={pendingCheckOut !== null}
        onClose={() => setPendingCheckOut(null)}
        onConfirm={() => {
          const patient = pendingCheckOut;
          if (!patient) return;
          // The dialog stays open until the write answers, so a failure is
          // reported where it happened rather than after a success toast.
          remove.mutate(patient.id, {
            onSuccess: () => {
              setPendingCheckOut(null);
              toast({ variant: 'success', title: cardLabel(patient) + ' — checked out' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't check out " + cardLabel(patient) }),
          });
        }}
        title={
          pendingCheckOut
            ? 'Check out ' + cardLabel(pendingCheckOut) + '?'
            : 'Check out this patient?'
        }
        description="They are removed from the waiting board. Their appointment record is unchanged."
        confirmLabel="Check out"
        tone="destructive"
        loading={remove.isPending}
      />
    </SectionShell>
  );
}
