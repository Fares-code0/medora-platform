import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database';

import { AdminDoctorController } from './controllers/admin-doctor.controller';
import { AvailabilityController } from './controllers/availability.controller';
import { DoctorVerificationController } from './controllers/doctor-verification.controller';
import { PatientDoctorController } from './controllers/patient-doctor.controller';
import { AdminDoctorRepository } from './repositories/admin-doctor.repository';
import { LicenseExpiryRepository } from './repositories/license-expiry.repository';
import { DoctorsJobs } from './services/doctors.jobs';
import { LicenseExpiryService } from './services/license-expiry.service';
import { AvailabilityRepository } from './repositories/availability.repository';
import { DoctorVerificationRepository } from './repositories/doctor-verification.repository';
import { PatientDoctorRepository } from './repositories/patient-doctor.repository';
import { AdminDoctorService } from './services/admin-doctor.service';
import { AvailabilityService } from './services/availability.service';
import { DoctorVerificationService } from './services/doctor-verification.service';
import { PatientDoctorService } from './services/patient-doctor.service';

/**
 * Doctors — API §3. M9.
 *
 * Doctor profiles, verification and availability (ADR-005). Referenced by
 * foreign key from appointments, records, prescriptions and orders
 * (ADR-003).
 *
 * **Only the patient-facing slice is built.** ADR-030 opened the Patient
 * Mobile workstream, and `PATIENT_MOBILE_API_CONTRACT.md` §3 is what the
 * mobile client needs first: a discovery list, a profile and the specialty
 * filter chips, all through a projection that cannot leak a licence number
 * or a personal phone number (ADR-030 §10).
 *
 * **The doctor's own schedule is built** (M9.4 — API §3.8, §3.9):
 * `GET/PUT /me/availability` and the time-off routes beside them. Its
 * authorization is `doctors.user_id` rather than the platform role,
 * because "is this account a practitioner" is a question the `doctors`
 * row answers and `users.role_id` only approximates.
 *
 * **The administrator surface is built** (M9.3, M9.5 — API §3.4–3.7):
 * the roster with its operational columns, the detail with its
 * suspension consequence count, the verification state machine and the
 * practice-status lever.
 *
 * The route trees stay deliberately separate rather than becoming one
 * handler that picks a shape by role: a single branch getting edited
 * wrongly is how the internal entity reaches a patient.
 * `patient-doctor.dto.ts` and `admin-doctor.dto.ts` are the two
 * projections, built column by column, with `FORBIDDEN_DOCTOR_FIELDS`
 * naming exactly what separates them.
 *
 * Still M9's own work: `GET/PATCH /me/profile` (§3.1–3.2) and the photo
 * upload (§3.3). `/me/profile` is currently owned by
 * `PatientsModule`'s `PatientProfileController` (ADR-030), and two
 * controllers cannot both claim one path — the collision is recorded in
 * the M8 exit-gate note in the roadmap and needs deciding before §3.1
 * can land.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    PatientDoctorController,
    AvailabilityController,
    AdminDoctorController,
    DoctorVerificationController,
  ],
  providers: [
    PatientDoctorService,
    PatientDoctorRepository,
    AvailabilityService,
    AvailabilityRepository,
    AdminDoctorService,
    AdminDoctorRepository,
    DoctorVerificationService,
    DoctorVerificationRepository,
    LicenseExpiryService,
    LicenseExpiryRepository,
    DoctorsJobs,
  ],
})
export class DoctorsModule {}
