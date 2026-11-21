import { Module } from '@nestjs/common';

import { ActivityKernelModule } from '../../shared/activity';
import { AuditKernelModule } from '../../shared/audit';
import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';
import { OutboxKernelModule } from '../../shared/outbox';

import { AdminAppointmentController } from './controllers/admin-appointment.controller';
import { AppointmentController } from './controllers/appointment.controller';
import { PatientAppointmentController } from './controllers/patient-appointment.controller';
import { TimeOffResolutionController } from './controllers/time-off-resolution.controller';
import { AppointmentRepository } from './repositories/appointment.repository';
import { AppointmentsJobs } from './services/appointments.jobs';
import { PatientAppointmentRepository } from './repositories/patient-appointment.repository';
import { AppointmentOversightService } from './services/appointment-oversight.service';
import { AppointmentService } from './services/appointment.service';
import { CLINIC_TIMEZONE, PlatformClinicTimezone } from './services/clinic-timezone';
import { PatientAppointmentService } from './services/patient-appointment.service';
import { SlotConflictChecker } from './services/slot-conflict.checker';
import { TimeOffResolutionService } from './services/time-off-resolution.service';

/**
 * Appointments — API §5. M11.
 *
 * The booking lifecycle and the ADR-001 status machine, backed by a DB
 * trigger so no path can walk a row into an illegal state.
 *
 * Four surfaces over one table, deliberately kept as four services:
 *
 *  - **`AppointmentService`** (M11.1–M11.4) — the doctor's own book.
 *    Every query is scoped by `doctors.id`; every write goes through the
 *    ADR-001 machine and the ADR-005 §4 conflict rules.
 *  - **`AppointmentOversightService`** (M11.6) — the administrator's
 *    cross-doctor table. A different authorization decision and a masked
 *    patient projection, so a different service rather than a nullable
 *    scope parameter on the first.
 *  - **`TimeOffResolutionService`** (M11.5) — the second phase of the
 *    emergency flow, gated on the blast-radius confirmation.
 *  - **`PatientAppointmentService`** — the patient's read-only view of
 *    their own appointments, which predates this milestone.
 *
 * The **write** routes on the patient side remain deliberately absent:
 * booking, cancelling and re-confirming as a *patient* each depend on a
 * policy no source in this repository states — whether a patient may
 * cancel a `confirmed` appointment and up to when, what the reschedule
 * cut-off is. ADR-001 says which statuses may follow which; it does not
 * say who may move between them. See `PATIENT_MOBILE_API_CONTRACT.md`
 * §4 for the exact decisions required.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthzKernelModule,
    AuditKernelModule,
    ActivityKernelModule,
    OutboxKernelModule,
  ],
  controllers: [
    AppointmentController,
    AdminAppointmentController,
    TimeOffResolutionController,
    PatientAppointmentController,
  ],
  providers: [
    AppointmentService,
    AppointmentOversightService,
    TimeOffResolutionService,
    SlotConflictChecker,
    AppointmentRepository,
    PatientAppointmentService,
    PatientAppointmentRepository,
    { provide: CLINIC_TIMEZONE, useClass: PlatformClinicTimezone },
    AppointmentsJobs,
  ],
})
export class AppointmentsModule {}
