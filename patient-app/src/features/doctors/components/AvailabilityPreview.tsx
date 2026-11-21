import { useMemo } from 'react';

import { StyleSheet, View } from 'react-native';

import { Button, Card, Chip, Text } from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useSlots } from '@/features/appointments/hooks';
import { useT, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';

/** How far ahead the preview asks. A week is what "soon" means here. */
const PREVIEW_DAYS = 7;
/** How many times are shown. Three fits one row at large text sizes. */
const PREVIEW_LIMIT = 3;

/**
 * The next few times this doctor is free — checklist G-09.
 *
 * ── It renders slots; it never computes them ─────────────────────────
 *
 * The times come from `useSlots`, i.e. `GET /public/doctors/{id}/slots`
 * (BE-06), server-side. Availability minus time-off minus booked minus
 * buffer, in the clinic's timezone, is business logic, and there is no
 * slot generator in this tree (audit §6, checklist I-04).
 *
 * Two client-side rules are applied to the server's answer, and neither
 * is arithmetic about availability:
 *
 * - **The first three.** A preview is a preview; the booking flow is
 *   where the whole list lives.
 * - **Nothing already past.** A slot whose time has gone is not an
 *   offer. A correct server never returns one, so this is a guard
 *   rather than a rule — and without it a canned development fixture
 *   would render this morning as bookable this afternoon.
 *
 * ── Three outcomes ───────────────────────────────────────────────────
 *
 * | Outcome | What renders |
 * |---|---|
 * | Slots | The times, each opening the booking flow on that slot |
 * | **Empty** | "No open times in the next 7 days" — a real answer, and the Book button stays, because asking is still allowed |
 * | **Failed** | Nothing. The profile is the screen; its availability is an addition |
 *
 * The failed case is every production build today (BE-06 is blocked on
 * ADR-033), which is why the Book button above this section is not
 * inside it: a patient can always ask, whether or not this client can
 * see a calendar.
 */
export interface AvailabilityPreviewProps {
  readonly doctorId: string;
  /** Opens the booking flow on this time. `undefined` starts at the date step. */
  readonly onPick: (startsAt?: string) => void;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export function AvailabilityPreview({ doctorId, onPick }: AvailabilityPreviewProps) {
  const theme = useTheme();
  const { formatDate, formatTime } = useDateFormat();
  const t = useT();

  /**
   * The window is computed ONCE per mount, not per render.
   *
   * `new Date()` inline would put a new millisecond in the query key on
   * every render, and a key that changes every render is a query that
   * never settles — the section would sit on its skeleton for as long as
   * the screen is open. Caught by `availability-preview.test.tsx`, which
   * waited for a time that was never going to arrive.
   */
  const { from, to } = useMemo(
    () => ({
      from: new Date().toISOString(),
      to: new Date(startOfToday().getTime() + PREVIEW_DAYS * 86_400_000).toISOString(),
    }),
    // Empty on purpose: the window is fixed for the life of the mount.
    // It does not depend on `doctorId` — `useSlots` keys on that itself,
    // so a different doctor is a different query over the same week.
    [],
  );
  const slots = useSlots(doctorId, from, to);

  if (slots.isPending) return <SkeletonCard testID="doctor-availability-loading" />;
  // An addition to the profile, not part of it. See the table above.
  if (slots.isError) return null;

  const now = Date.now();
  const upcoming = slots.data
    .filter((slot) => new Date(slot.startsAt).getTime() > now)
    .slice(0, PREVIEW_LIMIT);

  if (upcoming.length === 0) {
    return (
      <Card tone="sunken" testID="doctor-availability-empty">
        <Text variant="bodySm" color="textSecondary">
          {t('doctor.availability.empty')}
        </Text>
      </Card>
    );
  }

  return (
    <Card testID="doctor-availability">
      <Text variant="label" color="textSecondary">
        {t('doctor.availability.title')}
      </Text>

      <View style={[styles.row, { columnGap: theme.space[2], rowGap: theme.space[2] }]}>
        {upcoming.map((slot) => (
          <Chip
            key={slot.id}
            testID={`doctor-availability-${slot.id}`}
            label={t('doctor.availability.slot', {
              date: formatDate(slot.startsAt),
              time: formatTime(slot.startsAt),
            })}
            onPress={() => onPick(slot.startsAt)}
          />
        ))}
      </View>

      {/*
        The times above are what the server said a moment ago, and
        somebody else can take one while this screen is open. The booking
        flow re-reads the day and only pre-selects a time still on the
        server's list, so the worst case is a patient landing on the time
        step with nothing chosen rather than on a slot that is gone.
      */}
      <Button
        label={t('doctor.availability.seeAll')}
        tone="secondary"
        size="sm"
        testID="doctor-availability-see-all"
        onPress={() => onPick()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
});
