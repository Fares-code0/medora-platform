import { useCallback, useMemo, useState } from 'react';

import {
  BOOKING_STEPS,
  FIELD_STEP,
  bookingStepIndex,
  firstIncompleteStep,
  hasIssues,
  nextBookingStep,
  previousBookingStep,
  stepIssues,
  type BookingDraft,
  type BookingFailure,
  type BookingField,
  type BookingIssues,
  type BookingStepId,
} from '../model/booking';
import type { AppointmentPatientSnapshot, AppointmentPriority } from '../model/types';

/**
 * The New Appointment flow's state: the draft, the step, and what the server
 * last refused. One draft lives across all three steps, so moving between
 * them — or coming back from a refusal — never loses an entry.
 *
 * Problems are shown only after the doctor tries to move on (`showIssues`),
 * as the record flow does: a form that opens covered in red is shouting
 * about fields no one has had a chance to fill.
 */

export interface UseAppointmentBookingOptions {
  readonly defaultDepartment: string;
  readonly defaultVisitType: string;
}

export function useAppointmentBooking({
  defaultDepartment,
  defaultVisitType,
}: UseAppointmentBookingOptions) {
  // The first render's defaults seed the draft; later changes are the doctor's.
  const [draft, setDraft] = useState<BookingDraft>(() => ({
    patient: null,
    department: defaultDepartment,
    date: null,
    time: null,
    durationMin: 30,
    visitType: defaultVisitType,
    priority: 'normal',
    reason: '',
  }));
  const [step, setStep] = useState<BookingStepId>('patient');
  const [furthestReached, setFurthestReached] = useState<BookingStepId>('patient');
  const [showIssues, setShowIssues] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [failure, setFailure] = useState<BookingFailure | null>(null);

  const isStepValid = useCallback(
    (candidate: BookingStepId) => !hasIssues(stepIssues(draft, candidate)),
    [draft],
  );

  /** A step is reachable when every step before it is complete. */
  const isStepReachable = useCallback(
    (candidate: BookingStepId) =>
      BOOKING_STEPS.slice(0, bookingStepIndex(candidate)).every((before) => isStepValid(before.id)),
    [isStepValid],
  );

  const enter = useCallback((target: BookingStepId) => {
    setStep(target);
    setFurthestReached((previous) =>
      bookingStepIndex(target) > bookingStepIndex(previous) ? target : previous,
    );
  }, []);

  const goTo = useCallback(
    (target: BookingStepId) => {
      if (!isStepReachable(target)) return;
      setShowIssues(false);
      enter(target);
    },
    [enter, isStepReachable],
  );

  /** Moves on when this step is complete; otherwise shows its problems. Returns whether it moved. */
  const goNext = useCallback((): boolean => {
    const next = nextBookingStep(step);
    if (next === null) return false;
    if (hasIssues(stepIssues(draft, step))) {
      setShowIssues(true);
      return false;
    }
    setShowIssues(false);
    enter(next);
    return true;
  }, [draft, enter, step]);

  const goBack = useCallback(() => {
    const previous = previousBookingStep(step);
    if (previous === null) return;
    setShowIssues(false);
    setStep(previous);
  }, [step]);

  /** Shows every remaining problem and opens the first step that has one. */
  const revealFirstIncomplete = useCallback((): boolean => {
    const target = firstIncompleteStep(draft);
    if (target === null) return false;
    setShowIssues(true);
    enter(target);
    return true;
  }, [draft, enter]);

  const update = useCallback((patch: Partial<BookingDraft>, clears: readonly BookingField[]) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    // A refusal stays on screen until the doctor changes what it was about.
    setFailure((previous) => {
      if (previous === null) return null;
      if (previous.kind === 'slot') return clears.includes('time') ? null : previous;
      if (previous.kind === 'fields') {
        const remaining = Object.fromEntries(
          Object.entries(previous.fields).filter(
            ([field]) => !clears.includes(field as BookingField),
          ),
        ) as BookingIssues;
        return hasIssues(remaining) ? { ...previous, fields: remaining } : null;
      }
      return previous;
    });
  }, []);

  const setters = useMemo(
    () => ({
      setPatient: (patient: AppointmentPatientSnapshot) => update({ patient }, ['patient']),
      /** A preset (`?patient=`) — not an edit, so it leaves the draft clean. */
      presetPatient: (patient: AppointmentPatientSnapshot) =>
        setDraft((previous) => (previous.patient === null ? { ...previous, patient } : previous)),
      setDepartment: (department: string) => update({ department }, ['department']),
      /** A new day invalidates the chosen time: slots are per day. */
      setDate: (date: string) => update({ date, time: null }, ['date', 'time']),
      setTime: (time: string) => update({ time }, ['time']),
      clearTime: () => setDraft((previous) => ({ ...previous, time: null })),
      setDuration: (durationMin: number) => update({ durationMin }, ['duration']),
      /** The doctor's configured slot length, once known — a default, not an edit. */
      presetDuration: (durationMin: number) =>
        setDraft((previous) => ({ ...previous, durationMin })),
      setVisitType: (visitType: string) => update({ visitType }, ['visitType']),
      setPriority: (priority: AppointmentPriority) => update({ priority }, []),
      setReason: (reason: string) => update({ reason }, ['reason']),
    }),
    [update],
  );

  /** Records a refusal and opens the step that can fix it. */
  const fail = useCallback(
    (next: BookingFailure) => {
      setFailure(next);
      if (next.kind === 'slot') {
        // The refused time is no longer a choice; the day and everything else stay.
        setDraft((previous) => ({ ...previous, time: null }));
        enter('schedule');
      } else if (next.kind === 'fields') {
        const owners = Object.keys(next.fields).map((field) => FIELD_STEP[field as BookingField]);
        const target = BOOKING_STEPS.find((meta) => owners.includes(meta.id))?.id;
        if (target !== undefined) enter(target);
      }
    },
    [enter],
  );

  /** Problems for `candidate`: the client's own (once shown) over the server's. */
  const issuesFor = useCallback(
    (candidate: BookingStepId): BookingIssues => {
      const server =
        failure?.kind === 'fields'
          ? Object.fromEntries(
              Object.entries(failure.fields).filter(
                ([field]) => FIELD_STEP[field as BookingField] === candidate,
              ),
            )
          : {};
      return { ...server, ...(showIssues ? stepIssues(draft, candidate) : {}) };
    },
    [draft, failure, showIssues],
  );

  return {
    draft,
    step,
    furthestReached,
    dirty,
    failure,
    complete: firstIncompleteStep(draft) === null,
    isStepValid,
    isStepReachable,
    issuesFor,
    goTo,
    goNext,
    goBack,
    revealFirstIncomplete,
    fail,
    clearFailure: () => setFailure(null),
    markClean: () => setDirty(false),
    ...setters,
  };
}

export type AppointmentBookingFlow = ReturnType<typeof useAppointmentBooking>;
