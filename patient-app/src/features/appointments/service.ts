import { selectService } from '@/api/seam';

import { fixtureAppointmentService } from './fixtures/appointment-fixtures';
import { httpAppointmentService } from './http-appointment-service';
import type { AppointmentService } from './model/types';

/**
 * Appointments.
 *
 * Every method is live: reads, slots, visit types, booking,
 * cancellation (closed-list reason code) and the reschedule REQUEST
 * workflow with its history and withdrawal. Which actions a patient may
 * take is the server's `availableActions` — the client computes no policy.
 * See `http-appointment-service.ts`.
 */
export const appointmentService: AppointmentService = selectService({
  fixture: fixtureAppointmentService,
  http: httpAppointmentService,
});
