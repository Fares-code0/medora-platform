import { Module } from '@nestjs/common';

import { ActivityKernelModule } from '../../shared/activity';
import { AuditKernelModule } from '../../shared/audit';
import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';
import { OutboxKernelModule } from '../../shared/outbox';

import { AdminAppointmentController } from './controllers/admin-appointment.controller';
import { AppointmentController } from './controllers/appointment.controller';
import { PatientAppointmentController } from './controllers/patient-appointment.controller';
import { PatientSlotController } from './controllers/patient-slot.controller';
import { PublishedSlotController } from './controllers/published-slot.controller';
import { TimeOffResolutionController } from './controllers/time-off-resolution.controller';
import { AppointmentRepository } from './repositories/appointment.repository';
import { AppointmentsJobs } from './services/appointments.jobs';
import { PatientAppointmentRepository } from './repositories/patient-appointment.repository';
import { PublishedSlotRepository } from './repositories/published-slot.repository';
import { AppointmentOversightService } from './services/appointment-oversight.service';
import { AppointmentService } from './services/appointment.service';
import { CLINIC_TIMEZONE, PlatformClinicTimezone } from './services/clinic-timezone';
import { PatientAppointmentService } from './services/patient-appointment.service';
import { PatientBookingService } from './services/patient-booking.service';
import { PublishedSlotService } from './services/published-slot.service';
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
 *  - **`PublishedSlotService`** / **`PatientBookingService`** — doctor-
 *    published slots and the patient booking of one (DR-10, DR-11,
 *    OD-08, OD-09, OD-14; `API_CONTRACT_CHANGES.md` §6).
 *
 * Cancelling, rescheduling and accepting a proposal as a *patient* remain
 * deliberately absent: each depends on the ADR-033 patient action policy,
 * which is unresolved. ADR-001 says which statuses may follow which; it
 * does not say who may move between them.
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
    PublishedSlotController,
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
    PublishedSlotService,
    PublishedSlotRepository,
    PatientBookingService,
    { provide: CLINIC_TIMEZONE, useClass: PlatformClinicTimezone },
    AppointmentsJobs,
  ],
})
export class AppointmentsModule {}
