import { afterEach, describe, expect, it } from 'vitest';

import { isApiError } from '@/types/api';

import { mockAppointmentService } from './mock-appointment-service';
import { __resetMockAvailability, mockAvailabilityService } from './mock-availability-service';

/**
 * The demo grid keeps the server's semantics (DEC-005): an inconsistent
 * week is refused naming the day and nothing is kept, and a narrower week
 * moves no appointment.
 */

afterEach(() => {
  __resetMockAvailability();
});

describe('mockAvailabilityService', () => {
  it('refuses an inconsistent week with a 422 naming the day, and keeps nothing', async () => {
    const before = await mockAvailabilityService.get();
    const broken = {
      ...before,
      week: before.week.map((day, index) =>
        index === 2
          ? {
              ...day,
              windows: [
                { start: '09:00', end: '13:00' },
                { start: '12:00', end: '17:00' },
              ],
            }
          : day,
      ),
    };

    await expect(mockAvailabilityService.replace(broken)).rejects.toSatisfy(
      (error: unknown) =>
        isApiError(error) &&
        error.kind === 'validation' &&
        (error.fieldErrors['week[2]'] ?? []).includes('Working windows on one day cannot overlap'),
    );
    expect(await mockAvailabilityService.get()).toEqual(before);
  });

  it('stores a valid week, and moves no appointment when the week narrows', async () => {
    const book = await mockAppointmentService.listAppointments();
    const before = await mockAvailabilityService.get();
    const closedWeek = {
      ...before,
      week: before.week.map((day) => ({ ...day, open: false, windows: [], breaks: [] })),
    };

    const { saved: stored, stranded } = await mockAvailabilityService.replace(closedWeek);

    expect(stored.week.every((day) => !day.open)).toBe(true);
    // The demo makes no report rather than one in the wrong time zone.
    expect(stranded).toBeNull();
    expect(stored.clinicTimezone).toBeNull();
    expect(await mockAppointmentService.listAppointments()).toEqual(book);
  });
});
