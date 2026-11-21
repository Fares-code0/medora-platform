/**
 * The test catalogue (RM M14.1 — API §8.1).
 *
 * ## No patient scope here, and that is not an oversight
 *
 * RM M7.2's standing obligation is that every route touching **PHI**
 * resolves through `PatientScopeService`. The catalogue is reference
 * data: it names tests and reference intervals, not people, and holds no
 * column that could identify a patient. Calling `assertCanReach` here
 * would need a patient to scope against, and there is none — the
 * ordering form asks "what can I order" before it has decided anything
 * about a patient. The same reasoning `medication.service.ts` records
 * for the formulary.
 *
 * The guard that does apply is the capability on the controller.
 *
 * ## Reference and critical ranges are served, which is the verify step
 *
 * RM M14.1's verify step is "reference + critical ranges served per
 * analyte", and it is a real requirement rather than a completeness
 * one: the client renders a released value against the range it was
 * judged by, and the *order* form previews the range so a clinician
 * ordering a potassium knows what the lab will call abnormal. Serving
 * the analytes without their thresholds would leave the client
 * inventing them, which is the one thing a catalogue exists to prevent.
 */

import { Injectable } from '@nestjs/common';

import { CacheService, paramsKey, REFERENCE_DATA, REFERENCE_SCOPE } from '../../../shared/cache';

import { LAB_CATEGORY_FROM_WIRE } from '../dto/labs-enums';
import type { LabTestCatalogueView } from '../dto/lab-test.dto';
import type { LabTestListQuery } from '../dto/lab-test.schema';
import { LabTestRepository } from '../repositories/lab-test.repository';

import { toLabTestCatalogueView } from './lab-test-projection';

export interface PaginatedLabTests {
  readonly items: readonly LabTestCatalogueView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class LabTestService {
  constructor(
    private readonly tests: LabTestRepository,
    private readonly cache: CacheService,
  ) {}

  /**
   * API §8.1, served from the reference-data cache (RM M31.1). The
   * catalogue is seed-managed — no route writes it — so the seed's bump is
   * its invalidation (`docs/CACHING.md`).
   */
  catalogue(query: LabTestListQuery): Promise<PaginatedLabTests> {
    return this.cache.get(REFERENCE_DATA, REFERENCE_SCOPE, paramsKey('lab-catalogue', query), () =>
      this.load(query),
    );
  }

  private async load(query: LabTestListQuery): Promise<PaginatedLabTests> {
    // Zod has already refused anything outside the vocabulary, so an
    // absent filter is the only way this lookup misses.
    const category =
      query.category === undefined ? undefined : LAB_CATEGORY_FROM_WIRE[query.category];

    const { rows, totalItems } = await this.tests.list({
      q: query.q,
      category,
      includeInactive: query.includeInactive,
      page: query.page,
      pageSize: query.pageSize,
    });

    return {
      items: rows.map(toLabTestCatalogueView),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      // `Math.ceil(0 / n)` is 0, so an empty catalogue reports zero pages
      // rather than one empty one.
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}
