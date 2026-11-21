import { selectService } from '@/api/seam';

import { fixtureAppointmentService } from './fixtures/appointment-fixtures';
import { httpAppointmentService } from './http-appointment-service';
import type { AppointmentService } from './model/types';

/**
 * Appointments.
 *
 * ── Half of this feature is live; the other half is a decision ───────
 *
 * The previous revision refused all seven methods, because none of the
 * routes existed. Two do now: `GET /me/appointments` and
 * `/me/appointments/{id}` are served by `patient-appointment.controller.ts`
 * with ownership resolved through `patients.user_id` and 404-never-403 on
 * anything that is not the caller's.
 *
 * The other five are not waiting their turn in a queue. `POST
 * /me/appointments`, the cancel/reschedule/confirm trio and the slot
 * endpoint each need a rule **no source in this repository states** —
 * ADR-001's transition table says which statuses may follow which and
 * not who may make a transition. That question is written up as
 * **ADR-033**, proposed, awaiting a product/clinical owner, and
 * deliberately recommending nothing.
 *
 * So the HTTP adapter is partial: reads call the server, writes reject
 * with ADR-033 named. A production build now shows a patient their real
 * appointments and still refuses to invent a cancellation policy.
 */
export const appointmentService: AppointmentService = selectService({
  fixture: fixtureAppointmentService,
  http: httpAppointmentService,
});
