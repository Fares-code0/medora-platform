import { useEffect, useState } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, View } from 'react-native';

import { announce, headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Button,
  Card,
  Chip,
  ConfirmSheet,
  Divider,
  Icon,
  Input,
  Screen,
  Text,
  useToast,
} from '@/components';
import { DoctorCard } from '@/features/doctors/components/DoctorCard';
import { useDoctorSearch } from '@/features/doctors/hooks';
import { useT, useDateFormat } from '@/i18n';
import type { RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';
import { isApiError } from '@/types/api';

import { useBookAppointment, useSlots } from '../hooks';

type Props = NativeStackScreenProps<RootStackParamList, 'Booking'>;

/**
 * The booking flow.
 *
 * A full-screen modal stack rather than a tab-nested one, so no tab bar
 * competes for the thumb during a five-step task (audit §13). The steps
 * are Doctor -> Date -> Time -> Reason -> Confirm, with a stepper, back
 * navigation, and a discard guard on exit.
 *
 * ── The two constraints that shaped this file ────────────────────────
 *
 * 1. **No client-side slot generation.** The times on the Time step come
 *    from `useSlots`, which is `GET /public/doctors/{id}/slots` (BE-06)
 *    server-side. Availability minus time-off minus booked minus buffer,
 *    in the clinic's timezone, is business logic — this screen renders
 *    what it is given and computes nothing (checklist I-04).
 *
 * 2. **A 409 must not cost the patient their input.** Somebody else can
 *    take the slot between the Time step and Confirm. When that happens
 *    the flow returns to the Time step with the reason text intact and
 *    the server's message shown, rather than restarting (checklist I-05).
 *
 * The date strip is 14 days of local dates — a display convenience for
 * choosing which day to ASK about. It is not an availability calculation:
 * a day with no slots comes back empty from the server and renders as an
 * empty state.
 */

type Step = 'doctor' | 'date' | 'time' | 'reason' | 'confirm';

const STEP_ORDER: readonly Step[] = ['doctor', 'date', 'time', 'reason', 'confirm'];
const REASON_MAX = 300;
const DATE_STRIP_DAYS = 14;

function startOfDay(offsetDays: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Which day of the strip an ISO time falls on, or `null` if it is not on
 * it at all — in the past, or further out than the strip reaches.
 *
 * `null` is not a failure: the flow starts on the date step instead, and
 * the patient chooses. A stale link must not be able to put this screen
 * on a day it cannot show.
 */
function dayOffsetOf(iso: string): number | null {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const midnight = new Date(target);
  midnight.setHours(0, 0, 0, 0);
  const offset = Math.round((midnight.getTime() - startOfDay(0).getTime()) / 86_400_000);
  return offset >= 0 && offset < DATE_STRIP_DAYS ? offset : null;
}

export function BookingFlow({ route }: Props) {
  const theme = useTheme();
  const { formatDate, formatDateTime, formatTime } = useDateFormat();
  const t = useT();
  const toast = useToast();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const preselectedDoctorId = route.params?.doctorId;
  /**
   * A time the doctor's profile offered (G-09). It is a REQUEST to start
   * there, never a selection: `slotId` stays null until the server's own
   * list for that day comes back carrying it, because the preview is a
   * moment old and somebody else may have taken it.
   */
  const requestedStartsAt = route.params?.startsAt;
  const requestedOffset = requestedStartsAt === undefined ? null : dayOffsetOf(requestedStartsAt);

  const [step, setStep] = useState<Step>(
    preselectedDoctorId === undefined ? 'doctor' : requestedOffset === null ? 'date' : 'time',
  );
  const [doctorId, setDoctorId] = useState<string | undefined>(preselectedDoctorId);
  const [dayOffset, setDayOffset] = useState(requestedOffset ?? 1);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slotStartsAt, setSlotStartsAt] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const doctors = useDoctorSearch({});
  const from = startOfDay(dayOffset).toISOString();
  const to = startOfDay(dayOffset + 1).toISOString();
  const slots = useSlots(doctorId ?? '', from, to, doctorId !== undefined && step !== 'doctor');
  const booking = useBookAppointment();

  /**
   * Adopt the requested time, but only once the SERVER has said it is
   * still on offer. Runs once per arriving list; a slot that is gone
   * leaves the patient on the time step with nothing chosen, which is
   * the honest outcome and the one the booking rules already handle.
   */
  const offered = slots.data;
  useEffect(() => {
    if (requestedStartsAt === undefined || offered === undefined) return;
    const match = offered.find((slot) => slot.startsAt === requestedStartsAt);
    if (match === undefined) return;
    setSlotId((current) => (current === null ? match.id : current));
    setSlotStartsAt((current) => (current === null ? match.startsAt : current));
  }, [offered, requestedStartsAt]);

  const stepIndex = STEP_ORDER.indexOf(step);
  const selectedDoctor = doctors.data?.items.find((item) => item.id === doctorId);

  const goBack = () => {
    setFailure(null);
    if (stepIndex <= 0) {
      setDiscardOpen(true);
      return;
    }
    const previous = STEP_ORDER[stepIndex - 1];
    if (previous !== undefined) setStep(previous);
  };

  const submit = async () => {
    if (doctorId === undefined || slotId === null || slotStartsAt === null) return;
    setFailure(null);
    try {
      const trimmedNotes = notes.trim();
      const created = await booking.mutateAsync({
        doctorId,
        slotId,
        startsAt: slotStartsAt,
        reason: reason.trim(),
        // Omitted rather than sent empty. `notes` is optional on
        // `BookingRequest`, and `notes: ''` is a different statement from
        // "the patient added nothing" — the clinic would read a blank note
        // where there is none.
        ...(trimmedNotes === '' ? {} : { notes: trimmedNotes }),
      });
      toast.show(t('booking.submitted.toast'), 'success');
      announce(t('booking.submitted.a11y'));
      navigation.navigate('Tabs', {
        screen: 'AppointmentsTab',
        params: { screen: 'AppointmentDetail', params: { appointmentId: created.id } },
      });
    } catch (error) {
      // A taken slot sends the patient back one step with their reason
      // intact — never to the start of the flow.
      if (isApiError(error) && error.kind === 'conflict') {
        setFailure(error.detail);
        setSlotId(null);
        setSlotStartsAt(null);
        setStep('time');
        announce(t('booking.slotTaken.a11y'));
        return;
      }
      setFailure(t('appointment.action.failed'));
    }
  };

  return (
    <Screen edges={['top', 'bottom']} testID="booking-flow">
      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <Button
          label={t('action.back')}
          tone="ghost"
          icon="chevronLeft"
          onPress={goBack}
          testID="booking-back"
        />
        <View style={styles.grow} />
        <Text variant="caption" color="textTertiary">
          {t('booking.step', { position: stepIndex + 1, total: STEP_ORDER.length })}
        </Text>
      </View>

      {/* The stepper is decorative; the "Step n of 5" text above is the
          accessible statement of progress. */}
      <View style={[styles.row, { columnGap: theme.space[1] }]} accessible={false}>
        {STEP_ORDER.map((entry, index) => (
          <View
            key={entry}
            style={[
              styles.stepDot,
              {
                backgroundColor:
                  index <= stepIndex ? theme.colors.primary : theme.colors.surfaceSunken,
              },
            ]}
          />
        ))}
      </View>

      {failure === null ? null : (
        <Card tone="error" testID="booking-failure">
          <Text variant="bodySm" color="error" accessibilityLiveRegion="assertive">
            {failure}
          </Text>
        </Card>
      )}

      {step === 'doctor' ? (
        <View style={{ rowGap: theme.space[3] }}>
          <Text variant="h2" {...headingA11y(t('booking.doctor.title'))}>
            {t('booking.doctor.title')}
          </Text>
          <AsyncBoundary
            query={doctors}
            testID="booking-doctors"
            isEmpty={(data) => data.items.length === 0}
            empty={{
              title: t('booking.doctor.empty.title'),
              body: t('booking.doctor.empty.body'),
            }}
          >
            {(data) => (
              <View style={{ rowGap: theme.space[3] }}>
                {data.items.map((doctor) => (
                  <DoctorCard
                    key={doctor.id}
                    testID={`booking-doctor-${doctor.id}`}
                    doctor={doctor}
                    onPress={() => {
                      setDoctorId(doctor.id);
                      setStep('date');
                    }}
                  />
                ))}
              </View>
            )}
          </AsyncBoundary>
        </View>
      ) : null}

      {step === 'date' ? (
        <View style={{ rowGap: theme.space[3] }}>
          <Text variant="h2" {...headingA11y(t('booking.date.title'))}>
            {t('booking.date.title')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ columnGap: theme.space[2], paddingVertical: theme.space[1] }}
          >
            {Array.from({ length: DATE_STRIP_DAYS }, (_, index) => index + 1).map((offset) => (
              <Chip
                key={offset}
                testID={`booking-day-${offset}`}
                label={formatDate(startOfDay(offset).toISOString())}
                selected={dayOffset === offset}
                onPress={() => setDayOffset(offset)}
              />
            ))}
          </ScrollView>
          <Button
            label={t('booking.date.next')}
            size="lg"
            fullWidth
            testID="booking-to-time"
            onPress={() => setStep('time')}
          />
        </View>
      ) : null}

      {step === 'time' ? (
        <View style={{ rowGap: theme.space[3] }}>
          <Text variant="h2" {...headingA11y(t('booking.time.title'))}>
            {t('booking.time.title')}
          </Text>
          <Text variant="bodySm" color="textTertiary">
            {t('booking.time.note')}
          </Text>
          <AsyncBoundary
            query={slots}
            testID="booking-slots"
            isEmpty={(data) => data.length === 0}
            empty={{
              icon: 'calendar',
              title: t('booking.time.empty.title'),
              body: t('booking.time.empty.body'),
            }}
          >
            {(data) => (
              <View style={[styles.wrap, { columnGap: theme.space[2], rowGap: theme.space[2] }]}>
                {data.map((slot) => (
                  <Chip
                    key={slot.id}
                    testID={`booking-slot-${slot.id}`}
                    label={formatTime(slot.startsAt)}
                    selected={slotId === slot.id}
                    onPress={() => {
                      setSlotId(slot.id);
                      setSlotStartsAt(slot.startsAt);
                    }}
                  />
                ))}
              </View>
            )}
          </AsyncBoundary>
          <Button
            label={t('booking.time.next')}
            size="lg"
            fullWidth
            disabled={slotId === null}
            testID="booking-to-reason"
            onPress={() => setStep('reason')}
          />
        </View>
      ) : null}

      {step === 'reason' ? (
        <View style={{ rowGap: theme.space[3] }}>
          <Text variant="h2" {...headingA11y(t('booking.reason.title'))}>
            {t('booking.reason.title')}
          </Text>
          <Input
            label={t('booking.reason.label')}
            testID="booking-reason"
            value={reason}
            onChangeText={(value) => setReason(value.slice(0, REASON_MAX))}
            multiline
            required
            hint={t('booking.reason.hint', { used: reason.length, max: REASON_MAX })}
          />
          {/*
            Optional, and deliberately UNCAPPED.

            `reason` is truncated at 300 because the contract states that
            limit (`model/types.ts`). The contract states none for `notes`,
            so a number here would be a client rule that disagrees with the
            server the day the server picks one — the argument M-06 makes
            about the edit window, applied to a length. An over-long note
            fails at submit, where `action-recovery` already keeps what was
            typed.
          */}
          <Input
            label={t('booking.notes.label')}
            testID="booking-notes"
            value={notes}
            onChangeText={setNotes}
            multiline
            hint={t('booking.notes.hint')}
          />
          <Button
            label={t('booking.reason.next')}
            size="lg"
            fullWidth
            disabled={reason.trim().length === 0}
            testID="booking-to-confirm"
            onPress={() => setStep('confirm')}
          />
        </View>
      ) : null}

      {step === 'confirm' ? (
        <View style={{ rowGap: theme.space[3] }}>
          <Text variant="h2" {...headingA11y(t('booking.confirm.title'))}>
            {t('booking.confirm.title')}
          </Text>
          <Card>
            <Text variant="label" color="textTertiary">
              {t('booking.confirm.doctor')}
            </Text>
            <Text variant="body">{selectedDoctor?.fullName ?? doctorId}</Text>
            <Divider />
            <Text variant="label" color="textTertiary">
              {t('booking.confirm.when')}
            </Text>
            <Text variant="body">{slotStartsAt === null ? '' : formatDateTime(slotStartsAt)}</Text>
            <Divider />
            <Text variant="label" color="textTertiary">
              {t('booking.confirm.reason')}
            </Text>
            <Text variant="body">{reason}</Text>
            {/*
              Shown only when there is something to show, and shown at all
              because a patient should not confirm a message to their clinic
              that this screen is holding and not displaying.
            */}
            {notes.trim() === '' ? null : (
              <>
                <Divider />
                <Text variant="label" color="textTertiary">
                  {t('booking.confirm.notes')}
                </Text>
                <Text variant="body" testID="booking-confirm-notes">
                  {notes.trim()}
                </Text>
              </>
            )}
          </Card>

          <Card tone="info">
            <View style={[styles.row, { columnGap: theme.space[2] }]}>
              <Icon name="info" size={16} color="info" />
              <Text variant="bodySm" color="textSecondary" style={styles.grow}>
                {t('booking.confirm.note')}
              </Text>
            </View>
          </Card>

          <Button
            label={t('booking.submit')}
            size="lg"
            fullWidth
            loading={booking.isPending}
            testID="booking-submit"
            onPress={() => void submit()}
          />
        </View>
      ) : null}

      <ConfirmSheet
        visible={discardOpen}
        testID="booking-discard"
        title={t('booking.discard.title')}
        detail={t('booking.discard.detail')}
        confirmLabel={t('booking.discard.confirm')}
        tone="destructive"
        cancelLabel={t('booking.discard.cancel')}
        onConfirm={() => {
          setDiscardOpen(false);
          navigation.goBack();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
  stepDot: { borderRadius: 2, flex: 1, height: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
