import { Module } from '@nestjs/common';

import { ActivityKernelModule } from '../../shared/activity';
import { AuditKernelModule } from '../../shared/audit';
import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';
import { OutboxKernelModule } from '../../shared/outbox';

import { AdminAppointmentController } from './controllers/admin-appointment.controller';
import { AppointmentController } from './controllers/appointment.controller';
import { PatientAppointmentController } from './controllers/patient-appointment.controller';
import { PatientBookingController, PatientSlotController } from './controllers/patient-booking.controller';
import { RescheduleRequestController } from './controllers/reschedule-request.controller';
import { TimeOffResolutionController } from './controllers/time-off-resolution.controller';
import { AppointmentRepository } from './repositories/appointment.repository';
import { AppointmentsJobs } from './services/appointments.jobs';
import { PatientAppointmentRepository } from './repositories/patient-appointment.repository';
import { PatientBookingRepository } from './repositories/patient-booking.repository';
import { AppointmentOversightService } from './services/appointment-oversight.service';
import { AppointmentService } from './services/appointment.service';
import { CLINIC_TIMEZONE, PlatformClinicTimezone } from './services/clinic-timezone';
import { PatientAppointmentService } from './services/patient-appointment.service';
import { PatientBookingService } from './services/patient-booking.service';
import { RescheduleRequestService } from './services/reschedule-request.service';
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
 *  - **`PatientAppointmentService`** — the patient's view of their own
 *    appointments.
 *  - **`PatientBookingService`** / **`RescheduleRequestService`** — the
 *    patient actions of ADR-049 (booking a published slot, cancelling
 *    before the start, reschedule requests) and the clinic's side of the
 *    request queue. Re-confirming and answering a clinic proposal (ADR-033
 *    Q3) remain absent.
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
    // Before `AppointmentController`: `GET /appointments/reschedule-requests`
    // must not be read as `GET /appointments/:appointmentId`.
    RescheduleRequestController,
    AppointmentController,
    AdminAppointmentController,
    TimeOffResolutionController,
    PatientAppointmentController,
    PatientBookingController,
    PatientSlotController,
  ],
  providers: [
    AppointmentService,
    AppointmentOversightService,
    TimeOffResolutionService,
    SlotConflictChecker,
    AppointmentRepository,
    PatientAppointmentService,
    PatientAppointmentRepository,
    PatientBookingRepository,
    PatientBookingService,
    RescheduleRequestService,
    { provide: CLINIC_TIMEZONE, useClass: PlatformClinicTimezone },
    AppointmentsJobs,
  ],
})
export class AppointmentsModule {}
