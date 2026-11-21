import { useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarPlus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useDoctorProfile, useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { FlowStepper } from '@/components/patterns';
import { Breadcrumb, Button, Card, ConfirmationDialog } from '@/components/ui';
import { usePatientDirectoryQuery } from '@/features/shared-domain/patient-identity';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { routes } from '@/routes';

import { appointmentKeys, useCreateAppointmentMutation } from '../api/useAppointmentsQuery';
import { BookingDetailsStep } from '../components/booking/BookingDetailsStep';
import { BookingPatientStep } from '../components/booking/BookingPatientStep';
import { BookingScheduleStep } from '../components/booking/BookingScheduleStep';
import { BookingSummary } from '../components/booking/BookingSummary';
import { useAppointmentBooking } from '../hooks/useAppointmentBooking';
import { useBookingSchedule } from '../hooks/useBookingSchedule';
import type { CreateAppointmentInput } from '../model/appointment-service';
import {
  BOOKING_DURATIONS,
  BOOKING_STEPS,
  SLOT_STATE_LABELS,
  bookingFailureFrom,
  formatBookingDate,
  formatBookingTime,
  instantForWallClock,
  previousBookingStep,
  toAppointmentPatient,
} from '../model/booking';
import { DEPARTMENTS, VISIT_TYPES } from '../model/types';

/**
 * New appointment — a page of its own (`/doctor/appointments/new`), replacing
 * the dialog that crowded patient, slot, duration, visit type, department,
 * priority and reason into one small modal.
 *
 * Three steps over one draft: patient & doctor, date & time, visit details
 * with a review. Nothing is booked until "Confirm appointment".
 *
 * ## One booking per confirmation
 *
 * The confirm button is disabled while the request is in flight, and a ref
 * guards the gap before that render lands, so a double click sends one
 * request. The request carries an `Idempotency-Key` per booking intent: a
 * retry of the same booking after a lost response replays the first result
 * instead of booking twice; a changed booking gets a new key.
 *
 * ## Refusals land where they can be fixed
 *
 * The server's 409 for a time ("The slot falls outside the doctor's working
 * hours", a break, time off, an overlap) returns the doctor to the schedule
 * step with an inline alert, the refused time cleared and everything else
 * kept. A 422 lands on its fields. Neither raises a toast — an inline alert
 * is the one place it is said, so repeated attempts cannot stack copies of
 * it. Only the success, which navigates away, is a toast.
 */

/** `?patient=` pre-selects; the legacy `?book=` (NEW-06) is redirected here with it. */
const PATIENT_PARAM = 'patient';

export function NewAppointmentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const doctorName = profile.fullName || 'Doctor';

  const flow = useAppointmentBooking({
    defaultDepartment: DEPARTMENTS.includes(profile.department)
      ? profile.department
      : (DEPARTMENTS[0] ?? 'General Medicine'),
    defaultVisitType: VISIT_TYPES[0] ?? 'Consultation',
  });
  const { draft, step } = flow;
  const scheduling = useBookingSchedule(draft.date, draft.durationMin);
  const createAppointment = useCreateAppointmentMutation();

  /* The `?patient=` preset, applied once and only for a patient the directory holds. */
  const [searchParams] = useSearchParams();
  const initialPatientId = searchParams.get(PATIENT_PARAM);
  const directory = usePatientDirectoryQuery();
  const presetDone = useRef(false);
  const { presetPatient, presetDuration } = flow;
  useEffect(() => {
    if (presetDone.current || initialPatientId === null || directory.data === undefined) return;
    presetDone.current = true;
    const patient = directory.data.find((candidate) => candidate.id === initialPatientId);
    if (patient !== undefined) presetPatient(toAppointmentPatient(patient));
  }, [initialPatientId, directory.data, presetPatient]);

  /* The doctor's own slot length is the default duration, when it is one on offer. */
  const durationPreset = useRef(false);
  const configuredDuration = scheduling.availability.data?.defaultDurationMin;
  useEffect(() => {
    if (durationPreset.current || configuredDuration === undefined || flow.dirty) return;
    durationPreset.current = true;
    if (BOOKING_DURATIONS.includes(configuredDuration)) presetDuration(configuredDuration);
  }, [configuredDuration, flow.dirty, presetDuration]);

  /* Leaving with entries asks first; after a booking the guard stands down. */
  const blocker = useUnsavedChangesGuard(flow.dirty && !createAppointment.isPending);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useEffect(() => {
    if (leaveTo !== null && !flow.dirty) navigate(leaveTo);
  }, [leaveTo, flow.dirty, navigate]);

  /* One key per booking intent — reused for a retry of the same booking only. */
  const intent = useRef<{ signature: string; key: string } | null>(null);
  const keyFor = (signature: string): string => {
    if (intent.current?.signature !== signature) {
      intent.current = { signature, key: crypto.randomUUID() };
    }
    return intent.current.key;
  };

  /* Synchronous guard: a second click before `isPending` re-renders is ignored. */
  const submitting = useRef(false);

  const onConfirm = () => {
    if (submitting.current || createAppointment.isPending) return;
    flow.clearFailure();
    if (flow.revealFirstIncomplete()) return;
    const { patient, date, time } = draft;
    if (patient === null || date === null || time === null) return;

    // The slot as the grid now sees it — the book may have refreshed since it was picked.
    const slot = scheduling.schedule?.slots.find((candidate) => candidate.time === time);
    if (slot !== undefined && slot.state !== 'available') {
      flow.fail({
        kind: 'slot',
        title: 'Time slot unavailable',
        message: `${time} is no longer available (${SLOT_STATE_LABELS[slot.state].toLowerCase()}). Nothing was sent. Please choose an available time slot.`,
        serverDetail: null,
        refusedTime: time,
      });
      return;
    }

    const instant = instantForWallClock(date, time, scheduling.timeZone);
    if (instant === null) {
      flow.fail({
        kind: 'slot',
        title: 'Time slot unavailable',
        message: `${time} does not exist on this day in the clinic's time zone — a clock change skips it. Nothing was sent. Please choose another time.`,
        serverDetail: null,
        refusedTime: time,
      });
      return;
    }

    const payload: Omit<CreateAppointmentInput, 'idempotencyKey'> = {
      patient,
      dateTime: instant.toISOString(),
      durationMin: draft.durationMin,
      visitType: draft.visitType,
      department: draft.department,
      doctor: doctorName,
      priority: draft.priority,
      reason: draft.reason.trim(),
    };

    submitting.current = true;
    createAppointment.mutate(
      { ...payload, idempotencyKey: keyFor(JSON.stringify(payload)) },
      {
        onSuccess: (created) => {
          flow.markClean();
          toast({
            variant: 'success',
            title: 'Appointment booked',
            description: `${patient.name} · ${formatBookingDate(date)}, ${formatBookingTime(time, draft.durationMin)}`,
          });
          setLeaveTo(routes.doctor.appointment(created.id));
        },
        onError: (error) => {
          const failure = bookingFailureFrom(error, time);
          flow.fail(failure);
          // A refused time means the grid was stale: read the book and hours again.
          if (failure.kind === 'slot') {
            void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
          }
        },
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  };

  const stepMeta = BOOKING_STEPS.find((entry) => entry.id === step);
  const pending = createAppointment.isPending;
  const failure = flow.failure;

  return (
    <PageContainer width="xl">
      <PageSections>
        <ContentHeader
          title="New appointment"
          caption="Book a visit in three steps. The server confirms the time when you book."
          icon={CalendarPlus}
          tone="secondary"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: 'Overview', href: routes.doctor.overview },
                { label: 'Appointments', href: routes.doctor.appointments },
                { label: 'New appointment' },
              ]}
            />
          }
          actions={
            <Button
              variant="secondary"
              leadingIcon={ArrowLeft}
              onClick={() => navigate(routes.doctor.appointments)}
              disabled={pending}
            >
              Back to appointments
            </Button>
          }
        />

        <FlowStepper
          steps={BOOKING_STEPS}
          ariaLabel="Booking steps"
          current={step}
          furthestReached={flow.furthestReached}
          isStepValid={flow.isStepValid}
          isStepReachable={(candidate) => !pending && flow.isStepReachable(candidate)}
          onSelect={flow.goTo}
        />

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <Card title={stepMeta?.label} subtitle={stepMeta?.caption} headingAs="h2">
            <Stack gap={5}>
              {step === 'patient' ? (
                <BookingPatientStep
                  selectedPatientId={draft.patient?.id ?? null}
                  onSelectPatient={flow.setPatient}
                  department={draft.department}
                  onDepartmentChange={flow.setDepartment}
                  doctorName={doctorName}
                  doctorSpecialty={profile.specialty}
                  issues={flow.issuesFor('patient')}
                />
              ) : null}

              {step === 'schedule' ? (
                <BookingScheduleStep
                  scheduling={scheduling}
                  date={draft.date}
                  time={draft.time}
                  durationMin={draft.durationMin}
                  onDateChange={flow.setDate}
                  onTimeChange={flow.setTime}
                  onDurationChange={flow.setDuration}
                  onTimeInvalidated={flow.clearTime}
                  issues={flow.issuesFor('schedule')}
                  failure={failure?.kind === 'slot' ? failure : null}
                />
              ) : null}

              {step === 'details' ? (
                <>
                  {failure?.kind === 'general' ? (
                    <Alert variant="error" critical title={failure.title}>
                      {failure.message}
                    </Alert>
                  ) : null}
                  <BookingDetailsStep
                    draft={draft}
                    onVisitTypeChange={flow.setVisitType}
                    onPriorityChange={flow.setPriority}
                    onReasonChange={flow.setReason}
                    onEdit={flow.goTo}
                    doctorName={doctorName}
                    timeZone={scheduling.timeZone}
                    issues={flow.issuesFor('details')}
                    disabled={pending}
                  />
                </>
              ) : null}

              {failure?.kind === 'fields' ? (
                <Alert variant="error" title="Some details need attention">
                  {failure.message}
                </Alert>
              ) : null}

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {previousBookingStep(step) !== null ? (
                    <Button variant="secondary" onClick={flow.goBack} disabled={pending}>
                      Previous
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => navigate(routes.doctor.appointments)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
                {step === 'details' ? (
                  <Button onClick={onConfirm} loading={pending} disabled={pending}>
                    Confirm appointment
                  </Button>
                ) : (
                  <Button onClick={flow.goNext}>Continue</Button>
                )}
              </div>
            </Stack>
          </Card>

          <BookingSummary draft={draft} doctorName={doctorName} timeZone={scheduling.timeZone} />
        </div>
      </PageSections>

      <ConfirmationDialog
        open={blocker.state === 'blocked'}
        title="Leave without booking?"
        description="The appointment you started is not booked. Leaving discards your entries."
        confirmLabel="Discard and leave"
        cancelLabel="Stay here"
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </PageContainer>
  );
}
