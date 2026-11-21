import { Controller, Get, Param, Query } from '@nestjs/common';

import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated } from '../../../shared/authz';
import type { PatientDoctorDetail, PatientDoctorSummary } from '../dto/patient-doctor.dto';
import { doctorSearchSchema, type DoctorSearchQuery } from '../dto/patient-doctor.schema';
import { PatientDoctorService, type Paginated } from '../services/patient-doctor.service';

/**
 * Patient-facing doctor discovery — `PATIENT_MOBILE_API_CONTRACT.md` §3.
 *
 * ## Why `/patient/doctors` and not `/doctors`
 *
 * `GET /doctors` is API §3.4: the **administrator's roster**, gated on
 * `can:doctors.manage`, returning the internal Doctor entity. Serving a
 * patient from the same route would mean one handler with two response
 * shapes chosen by role — and the day someone edits the wrong branch, a
 * practitioner's licence number and personal mobile number go to every
 * patient in the clinic. A separate route with a separate projection has
 * no such branch to get wrong.
 *
 * ## Why `@Authenticated()` and not `@Public()`
 *
 * The audit sketched these as `/public/*`, and they could be: nothing
 * here is PHI. They are authenticated anyway, because **there is no rate
 * limiting anywhere in this backend yet** (audit BE-17/R-9). An open
 * `GET /public/doctors/{id}` is an enumeration surface over the clinic's
 * roster with nothing in front of it; requiring a token puts a revocable
 * credential and a session trail on every read. When M37 lands rate
 * limiting, opening a genuine pre-login directory is a one-line change to
 * this decorator — the projection is already correct for it.
 *
 * `@Authenticated()` rather than `@Can(...)` is the honest annotation: a
 * patient holds zero capabilities by ADR-030 §6, so any capability here
 * would lock out exactly the audience the route exists for. There is no
 * ownership dimension either — every patient sees the same roster — so
 * the token's existence really is the whole authorization decision, which
 * is what `@Authenticated()` is documented to mean.
 */
@Authenticated()
@Controller('patient')
export class PatientDoctorController {
  constructor(private readonly doctors: PatientDoctorService) {}

  @Get('doctors')
  search(
    @Query(zodQuery(doctorSearchSchema)) query: DoctorSearchQuery,
  ): Promise<Paginated<PatientDoctorSummary>> {
    return this.doctors.search(query);
  }

  @Get('doctors/:doctorId')
  byId(@Param('doctorId') doctorId: string): Promise<PatientDoctorDetail> {
    return this.doctors.byId(doctorId);
  }

  @Get('specialties')
  specialties(): Promise<readonly { id: string; name: string; parentId: string | null }[]> {
    return this.doctors.listSpecialties();
  }
}
