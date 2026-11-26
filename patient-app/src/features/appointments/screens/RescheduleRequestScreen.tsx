import { useMemo, useRef, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { announce, headingA11y } from '@/accessibility/a11y';
import { isolate } from '@/accessibility/bidi';
import {
  AsyncBoundary,
  Button,
  Card,
  Chip,
  Icon,
  Input,
  Screen,
  Text,
  useToast,
} from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useDateFormat, useT } from '@/i18n';
import type { AppointmentsStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { ActionFailureCard } from '../components/ActionFailureCard';
import { classifyActionError, type ActionFailure } from '../errors';
import { useAppointment, useRequestReschedule, useSlots } from '../hooks';
import type { AppointmentDetail, BookableSlot } from '../model/types';

type Props = NativeStackScreenProps<AppointmentsStackParamList, 'RescheduleRequest'>;

/** How far ahead the screen asks. The server's own window cap is 31 days. */
const WINDOW_DAYS = 14;
/** The server's limit on the optional note. */
const NOTE_MAX = 300;

/**
 * Ask the hospital to move an appointment.
 *
 * ── It is a request, and the screen says so before and after ─────────
 * The appointment stays booked at its original time until the hospital
 * approves, and the time chosen here is NOT held for the patient — it
 * stays open to other people, and may be gone by the time staff look.
 * Both sentences sit above the form, not in a footnote.
 *
 * ── What it offers ───────────────────────────────────────────────────
 * The same doctor's published, unbooked, future times, as the server
 * lists them, in the appointment's own time zone. Slots at a different
 * hospital are not offered (the server refuses a cross-hospital move);
 * that is narrowing a list the server sent, not computing availability.
 * Whether a patient may ask at all is `availableActions` — if the server
 * no longer lists `reschedule`, the form is replaced by an explanation.
 *
 * ── Failure keeps the form ───────────────────────────────────────────
 * A taken time refreshes the list and clears only the selection; the
 * note stays. An open request, a changed appointment, a dropped
 * connection each say so in words. Nothing signs the patient out.
 */
export function RescheduleRequestScreen({ navigation, route }: Props) {
  const t = useT();
  const appointment = useAppointment(route.params.appointmentId);

  return (
    <Screen
      testID="reschedule-screen"
      onRefresh={() => void appointment.refetch()}
      refreshing={appointment.isRefetching}
    >
      <Text variant="h1" {...headingA11y(t('reschedule.title'))}>
        {t('reschedule.title')}
      </Text>
      <AsyncBoundary query={appointment} testID="reschedule-appointment" loading={<SkeletonCard />}>
        {(data) =>
          data.availableActions.includes('reschedule') ? (
            <RescheduleForm appointment={data} onDone={() => navigation.goBack()} />
          ) : (
            <Card tone="info" testID="reschedule-unavailable">
              <Text variant="body">{t('reschedule.unavailable')}</Text>
              <Button
                label={t('action.back')}
                tone="secondary"
                testID="reschedule-back"
                onPress={() => navigation.goBack()}
              />
            </Card>
          )
        }
      </AsyncBoundary>
    </Screen>
  );
}

function RescheduleForm({
  appointment,
  onDone,
}: {
  appointment: AppointmentDetail;
  onDone: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const { formatDate, formatDateTime, formatTime } = useDateFormat();
  const timeZone = appointment.clinicTimezone;

  const [slotId, setSlotId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const inFlight = useRef(false);

  // Fixed for the life of the mount: a window that moved on every render
  // would be a new query key on every render.
  const { from, to } = useMemo(() => {
    const now = Date.now();
    return {
      from: new Date(now).toISOString(),
      to: new Date(now + WINDOW_DAYS * 86_400_000).toISOString(),
    };
  }, []);
  const slots = useSlots(appointment.doctor.id, from, to);
  const request = useRequestReschedule(appointment.id);

  const hospitalId = appointment.hospital?.id;
  const offered = useMemo(
    () =>
      (slots.data ?? [])
        .filter((slot) => hospitalId === undefined || slot.hospital.id === hospitalId)
        // Ordering what the server sent, not judging it.
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [slots.data, hospitalId],
  );
  const days = useMemo(
    () => groupByDay(offered, (iso) => formatDate(iso, timeZone)),
    [offered, formatDate, timeZone],
  );
  const chosen = offered.find((slot) => slot.id === slotId);

  const submit = async () => {
    if (slotId === null || inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    try {
      const trimmed = note.trim();
      await request.mutateAsync({ slotId, ...(trimmed === '' ? {} : { note: trimmed }) });
      toast.show(t('reschedule.submitted.toast'), 'success');
      announce(t('reschedule.submitted.a11y'));
      onDone();
    } catch (error) {
      const classified = classifyActionError(error);
      setFailure(classified);
      announce(t(classified.messageKey));
      if (classified.kind === 'slot_taken') {
        // Keep what the patient wrote; only the time is no longer theirs to pick.
        setSlotId(null);
        void slots.refetch();
      }
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <View style={{ rowGap: theme.space[4] }}>
      <Card>
        <Text variant="label" color="textTertiary">
          {t('reschedule.current')}
        </Text>
        <Text variant="body" testID="reschedule-current">
          {formatDateTime(appointment.startsAt, timeZone)}
        </Text>
        {appointment.hospital === null ? null : (
          <Text variant="caption" color="textTertiary">
            {appointment.hospital.name}
          </Text>
        )}
      </Card>

      <Card tone="warning" testID="reschedule-explainer">
        <View style={[styles.row, { columnGap: theme.space[2] }]}>
          <Icon name="info" size={16} color="warning" />
          <View style={[styles.grow, { rowGap: theme.space[1] }]}>
            <Text variant="bodyStrong">{t('reschedule.explainer.title')}</Text>
            <Text variant="bodySm" color="textSecondary">
              {t('reschedule.stays')}
            </Text>
            <Text variant="bodySm" color="textSecondary">
              {t('reschedule.notHeld')}
            </Text>
          </View>
        </View>
      </Card>

      <View style={{ rowGap: theme.space[3] }}>
        <Text variant="h2" {...headingA11y(t('reschedule.pick.title'))}>
          {t('reschedule.pick.title')}
        </Text>
        <AsyncBoundary
          query={slots}
          testID="reschedule-slots"
          loading={<SkeletonCard />}
          isEmpty={() => offered.length === 0}
          empty={{
            icon: 'calendar',
            title: t('reschedule.pick.empty.title'),
            body: t('reschedule.pick.empty.body'),
          }}
        >
          {() => (
            <View style={{ rowGap: theme.space[3] }}>
              {days.map((day) => (
                <View key={day.label} style={{ rowGap: theme.space[2] }}>
                  <Text variant="label" color="textSecondary" {...headingA11y(day.label)}>
                    {day.label}
                  </Text>
                  <View
                    style={[styles.wrap, { columnGap: theme.space[2], rowGap: theme.space[2] }]}
                  >
                    {day.slots.map((slot) => (
                      <Chip
                        key={slot.id}
                        testID={`reschedule-slot-${slot.id}`}
                        label={formatTime(slot.startsAt, timeZone)}
                        accessibilityLabel={formatDateTime(slot.startsAt, timeZone)}
                        selected={slotId === slot.id}
                        disabled={request.isPending}
                        onPress={() => setSlotId(slot.id)}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </AsyncBoundary>
      </View>

      <Input
        label={t('reschedule.note.label')}
        testID="reschedule-note"
        value={note}
        onChangeText={(value) => setNote(value.slice(0, NOTE_MAX))}
        multiline
        disabled={request.isPending}
        hint={t('reschedule.note.hint', { used: note.length, max: NOTE_MAX })}
      />

      {chosen === undefined ? null : (
        <Text variant="bodySm" color="textSecondary" testID="reschedule-chosen">
          {t('reschedule.chosen', { when: isolate(formatDateTime(chosen.startsAt, timeZone)) })}
        </Text>
      )}

      {failure === null ? null : (
        <ActionFailureCard failure={failure} testID="reschedule-failure" />
      )}

      <Button
        label={t('reschedule.submit')}
        size="lg"
        fullWidth
        disabled={slotId === null}
        loading={request.isPending}
        testID="reschedule-submit"
        onPress={() => void submit()}
      />
    </View>
  );
}

/**
 * Groups the server's slots under the date they fall on IN THE CLINIC'S
 * zone. The date label comes from the formatter and the slots keep the
 * server's order; nothing is computed about availability.
 */
function groupByDay(
  slots: readonly BookableSlot[],
  label: (iso: string) => string,
): { readonly label: string; readonly slots: readonly BookableSlot[] }[] {
  const days: { label: string; slots: BookableSlot[] }[] = [];
  for (const slot of slots) {
    const text = label(slot.startsAt);
    const last = days[days.length - 1];
    if (last?.label === text) last.slots.push(slot);
    else days.push({ label: text, slots: [slot] });
  }
  return days;
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'flex-start', flexDirection: 'row' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
