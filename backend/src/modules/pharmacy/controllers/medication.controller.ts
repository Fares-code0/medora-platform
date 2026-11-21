import { Controller, Get, Param, Query } from '@nestjs/common';

import { RevalidatePrivately } from '../../../common/http/cache-policy';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import type { MedicationMonographView } from '../dto/medication.dto';
import { medicationListSchema, type MedicationListQuery } from '../dto/medication.schema';
import { MedicationService, type PaginatedMedications } from '../services/medication.service';

/**
 * The formulary (RM M13.1 — API §7.1, §7.2).
 *
 * ## `prescriptions.create` guards a pair of read routes
 *
 * The contract marks both rows `doctor`, and the capability that
 * expresses "may prescribe" is `prescriptions.create`. Guarding the
 * formulary with it keeps the surface honest in both directions: a
 * reception or laboratory account holds no reason to enumerate which
 * controlled substances the clinic stocks, and an administrator — who
 * deliberately does **not** hold `prescriptions.create`
 * (`permission-catalogue.ts:227`) — has no prescribing stepper to fill.
 *
 * The alternative, a bare `@Authenticated()`, would make the formulary
 * readable by every signed-in account including patients, which is a
 * disclosure with no upside: nothing in the patient app prescribes.
 */
@Can('prescriptions.create')
@Controller('medications')
export class MedicationController {
  constructor(private readonly medications: MedicationService) {}

  /** API §7.1 — typeahead over brand and generic, plus the filter chips. */
  @Get()
  @RevalidatePrivately()
  list(
    @Query(zodQuery(medicationListSchema)) query: MedicationListQuery,
  ): Promise<PaginatedMedications> {
    return this.medications.list(query);
  }

  /** API §7.2 — prescribing reference. Read-only, and 404 when absent. */
  @Get(':medicationId/monograph')
  @RevalidatePrivately()
  monograph(@Param('medicationId') medicationId: string): Promise<MedicationMonographView> {
    return this.medications.monograph(medicationId);
  }
}
