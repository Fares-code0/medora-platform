/**
 * The weekly availability grid — API §3.8 (RM M9.4, ADR-005 §2).
 *
 * ## Two kinds of time, two shapes
 *
 * The grid is **recurring civil time**: "Mondays, 09:00–17:00". Time off
 * is a **specific interval**: "the 14th to the 21st of March". DB §S2
 * keeps them in two tables for that reason, and this file keeps them in
 * two shapes — a `HH:MM` string for the first, an ISO-8601 instant for
 * the second. Serialising a weekday range as a timestamp would attach a
 * date to something that has none, and the client's timezone would then
 * shift a clinic's opening hours.
 *
 * ## `HH:MM`, not `HH:MM:SS`
 *
 * The column is `time(0)` so seconds are always zero, and an appointment
 * grid quantised to fifteen minutes has no use for them. The wire
 * therefore carries `"09:00"`, which is what a `<input type="time">`
 * round-trips without reformatting.
 *
 * ## Breaks are rows, not a nested list
 *
 * `doctor_availability.is_break` marks a row as a break inside the day
 * rather than a working window. That keeps one uniqueness constraint
 * (`doctorId, weekday, startTime`) governing both, so a break that
 * overlaps another break is refused by the same rule as two overlapping
 * working windows. The wire splits them into `windows` and `breaks` per
 * day, because that is how the editor renders them.
 */

export interface TimeRange {
  /** `HH:MM`, 24-hour, clinic-local civil time. */
  readonly start: string;
  readonly end: string;
}

export interface AvailabilityDay {
  /** `Mon` … `Sun`, as the `Weekday` enum spells it on the wire. */
  readonly weekday: string;
  /** False when the doctor does not work that day at all. */
  readonly open: boolean;
  readonly windows: readonly TimeRange[];
  readonly breaks: readonly TimeRange[];
}

export interface AvailabilityView {
  /** Always seven entries, Monday first, whether or not the day is open. */
  readonly week: readonly AvailabilityDay[];
  /** One of 15 · 20 · 30 · 45 · 60 (API §3.8). */
  readonly defaultDurationMin: number;
  readonly bufferMin: number;
  /**
   * The IANA zone the grid's times are read in — the clinic's,
   * `platform_settings.localization.timezone` (BR-DEC-005). Served so the
   * client compares appointment instants in the right zone.
   */
  readonly clinicTimezone: string;
}

/**
 * `PUT /me/availability` — the saved grid and what it no longer covers
 * (BR-DEC-005).
 *
 * `stranded` is a **report**. The save succeeds and nothing is moved or
 * cancelled; the doctor reschedules from the list. Whether the server
 * should instead *refuse* such a save is the open half of the decision.
 */
export interface AvailabilitySaveResult extends AvailabilityView {
  readonly stranded: readonly ImpactedAppointment[];
}

/** A block of absolute time the doctor is unavailable — API §3.9. */
export interface TimeOffView {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** `vacation` | `emergency-block`. */
  readonly kind: string;
  /** `block-new` | `reschedule-existing`. */
  readonly autoBehavior: string;
  readonly createdAt: string;
}

/**
 * What booking a block of time off would disturb — API §3.9, ADR-005 §7.
 *
 * The endpoint returns this and **takes no action on the appointments**.
 * RA-005.2 reads `reschedule-existing` as a default pre-selection, never
 * as automatic action: the blast-radius confirmation is mandatory, and
 * M11.5 is where the per-appointment resolution lands. Returning the
 * impact list without moving anything is the honest half of that, and it
 * is what the emergency time-off screen needs first.
 */
export interface ImpactedAppointment {
  readonly id: string;
  readonly scheduledAt: string;
  readonly durationMin: number;
  readonly status: string;
  /** `patients.public_id` — the handle, never the name. */
  readonly patientId: string;
}

export interface TimeOffResult {
  readonly timeOff: TimeOffView;
  readonly impacted: readonly ImpactedAppointment[];
}
