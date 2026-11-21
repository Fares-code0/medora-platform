import {
  useAppointmentsQuery,
  useAvailabilityQuery,
  useUpcomingTimeOffQuery,
} from '../api/useAppointmentsQuery';
import { zoneOrDevice } from '../model/availability';
import { clinicToday, daySchedule, type DaySchedule } from '../model/booking';
import type { DateKey } from '../model/calendar';

/**
 * Everything the schedule step reads, in one place: the doctor's weekly hours
 * (with the clinic's zone), their upcoming time off and their book — the
 * inputs to the server's five-rule check — and the day's slots computed from
 * them.
 *
 * Time off and the book are *refinements*: when either cannot be read, the
 * slots are still offered by working hours and `occupancyKnown` is false, so
 * the screen can say the server will check the rest. Working hours are not
 * optional — without them there is no grid to offer.
 */
export function useBookingSchedule(date: DateKey | null, durationMin: number) {
  const availability = useAvailabilityQuery();
  const timeOff = useUpcomingTimeOffQuery();
  const appointments = useAppointmentsQuery();

  const clinicZone = availability.data?.clinicTimezone ?? null;
  const timeZone = zoneOrDevice(clinicZone);
  // Read on every render rather than memoised: a day is a few dozen slots, and
  // a fresh "now" marks a slot that slipped into the past while the page sat open.
  const now = new Date();
  const schedule: DaySchedule | null =
    date === null || availability.data === undefined
      ? null
      : daySchedule({
          date,
          durationMin,
          availability: availability.data,
          timeOff: timeOff.data ?? null,
          appointments: appointments.data ?? null,
          now,
          timeZone,
        });

  return {
    availability,
    timeOff,
    appointments,
    schedule,
    /** The zone the grid is read in — the clinic's, or `null` for the device's. */
    timeZone,
    /** True when the server named a clinic zone this runtime can use. */
    usesClinicZone: timeZone !== null,
    today: clinicToday(now, timeZone),
    /** Whether rules 3 and 4 (time off, existing bookings) are reflected in the grid. */
    occupancyKnown: timeOff.data !== undefined && appointments.data !== undefined,
    occupancyFailed: timeOff.isError || appointments.isError,
  };
}

export type BookingScheduleState = ReturnType<typeof useBookingSchedule>;
