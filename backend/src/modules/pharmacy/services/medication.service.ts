/**
 * The formulary (RM M13.1 — API §7.1, §7.2).
 *
 * ## No patient scope here, and that is not an oversight
 *
 * RM M7.2's standing obligation is that every route touching **PHI**
 * resolves through `PatientScopeService`. The formulary is reference
 * data: it names medicines, not people, and holds no column that could
 * identify a patient. Calling `assertCanReach` here would need a patient
 * to scope against, and there is none — the stepper asks "what can I
 * prescribe" before it has decided anything about a patient.
 *
 * The guard that does apply is the capability on the controller. A drug
 * formulary is not public: it tells an attacker which controlled
 * substances this clinic stocks.
 *
 * ## A missing monograph is a 404, not an empty document
 *
 * `medication_monographs` is sparsely populated by design — ADR-010
 * group 9 brought the table in because "API §7.2 has no other data
 * source", not because every medicine has an entry. A 200 carrying eight
 * nulls would render as a monograph asserting that a drug has no
 * contraindications, which is a clinical claim nobody made. 404 says
 * "no reference entry", which is true.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { CacheService, paramsKey, REFERENCE_DATA, REFERENCE_SCOPE } from '../../../shared/cache';
import {
  MEDICATION_CATEGORY_FROM_WIRE,
  MEDICATION_FORM_FROM_WIRE,
  MEDICATION_ROUTE_FROM_WIRE,
} from '../dto/pharmacy-enums';
import type { MedicationMonographView, MedicationView } from '../dto/medication.dto';
import type { MedicationListQuery } from '../dto/medication.schema';
import { MedicationRepository } from '../repositories/medication.repository';

import { toMedicationView, toMonographView } from './medication-projection';

export interface PaginatedMedications {
  readonly items: readonly MedicationView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class MedicationService {
  constructor(
    private readonly medications: MedicationRepository,
    private readonly cache: CacheService,
  ) {}

  /** API §7.1. */
  /**
   * API §7.1, the formulary typeahead — served from the reference-data
   * cache (RM M31.1). Seed-managed, so the seed's bump invalidates it.
   *
   * **The safety screen does not read through here.** `SafetyService`
   * reads medications, allergy classes and interactions straight from the
   * database: a check that blocks a prescription must see the formulary
   * as it is, not as it was an hour ago.
   */
  list(query: MedicationListQuery): Promise<PaginatedMedications> {
    return this.cache.get(REFERENCE_DATA, REFERENCE_SCOPE, paramsKey('formulary', query), () =>
      this.loadList(query),
    );
  }

  private async loadList(query: MedicationListQuery): Promise<PaginatedMedications> {
    // Zod has already refused anything outside each vocabulary, so an
    // absent filter is the only way these lookups miss.
    const category = query.category === undefined ? undefined : MEDICATION_CATEGORY_FROM_WIRE[query.category];
    const form = query.form === undefined ? undefined : MEDICATION_FORM_FROM_WIRE[query.form];
    const route = query.route === undefined ? undefined : MEDICATION_ROUTE_FROM_WIRE[query.route];

    const { rows, totalItems } = await this.medications.list({
      q: query.q,
      category,
      form,
      route,
      controlled: query.controlled,
      highRisk: query.highRisk,
      includeInactive: query.includeInactive,
      page: query.page,
      pageSize: query.pageSize,
    });

    return {
      items: rows.map(toMedicationView),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      // `Math.ceil(0 / n)` is 0, so an empty formulary reports zero
      // pages rather than one empty one.
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /** API §7.2. */
  /**
   * API §7.2. Cached like the list; a missing monograph is a 404 that is
   * **not** cached (the load throws), so a medication added by the next
   * seed is found at once.
   */
  monograph(medicationId: string): Promise<MedicationMonographView> {
    return this.cache.get(REFERENCE_DATA, REFERENCE_SCOPE, paramsKey('monograph', { medicationId }), () =>
      this.loadMonograph(medicationId),
    );
  }

  private async loadMonograph(medicationId: string): Promise<MedicationMonographView> {
    const row = await this.medications.monographFor(medicationId);

    if (row === null) {
      throw AppException.notFound('No monograph for this medication');
    }

    return toMonographView(row);
  }
}
