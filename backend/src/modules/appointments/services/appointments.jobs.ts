/**
 * The satisfaction-survey dispatch (RM M30.2) — registered, blocked.
 *
 * `satisfaction_surveys` exists (DB §S7), the dashboard reads it, and
 * `doctors.rating_avg` is derived from it. What does not exist is any
 * way for a patient to answer one: there is no `POST` on the web
 * contract, none in `PATIENT_MOBILE_API_CONTRACT.md`, and no route in
 * this module or in `patients`.
 *
 * So a dispatch would send every patient of every completed appointment
 * a notification whose only purpose is to be followed — and
 * `NotificationDispatchService` says exactly what a notification is: "a
 * pointer, not a record: the client follows the id to a route that
 * enforces its own authorization". Pointing at a route that does not
 * exist is the one thing a pointer must not do.
 *
 * There is a second gap behind the first, and it is worth recording
 * before anyone unblocks only the route: API §13.2 puts
 * `surveyParticipation` in the `privacy` settings slice, so the dispatch
 * has a per-patient opt-out to honour. `settings.schema.ts` names the
 * field; nothing reads it yet.
 *
 * 18:00 UTC is the slot: an invitation about a visit is sent after
 * clinic hours, not during the next morning's.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { dailyAtUtc, JobRegistry } from '../../../shared/jobs';

@Injectable()
export class AppointmentsJobs implements OnModuleInit {
  constructor(private readonly registry: JobRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'appointments.satisfaction-survey-dispatch',
      summary: 'Invites the patient of a completed visit to rate it (DB §S7).',
      schedule: dailyAtUtc(18, 0),
      blocked: {
        reason:
          'No route accepts a survey, on either the web or the mobile contract, so the invitation would be a pointer to nothing — and API §13.2’s `privacy.surveyParticipation` opt-out has no reader.',
        unblockedBy: 'A survey submission endpoint, and a reader for `privacy.surveyParticipation`',
      },
    });
  }
}
