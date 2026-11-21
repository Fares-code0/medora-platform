/**
 * The test catalogue's queries (RM M14.1 — API §8.1).
 *
 * ## The typeahead rides the trigram index
 *
 * M5.5 created `lab_test_catalogue_name_trgm_idx`, a GIN index with
 * `gin_trgm_ops`, for exactly this query. It only helps if the predicate
 * is a case-insensitive `LIKE '%…%'`: Prisma's `contains` with
 * `mode: 'insensitive'` emits `ILIKE`, which `pg_trgm` answers from the
 * index instead of scanning every row. `startsWith` would want a btree
 * that does not exist here, and a clinician typing "metabolic" expects
 * **Basic Metabolic Panel** — matching mid-word is the whole point.
 *
 * The LOINC `code` is searched alongside the name and is *not* indexed
 * for it. That is deliberate rather than an omission: the catalogue is
 * five rows in the seed and a few hundred in a real clinic, the code is
 * UNIQUE so an exact match is an index hit, and adding a second GIN
 * index to substring-match a code nobody types partially would cost
 * writes for nothing.
 *
 * ## `active` is a filter, not a delete
 *
 * A withdrawn test still appears on orders written before it was
 * withdrawn (`lab_orders.test_id` is RESTRICT). The default hides it and
 * nothing removes the row, so a historical order keeps rendering its
 * test name rather than a dangling id.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type { LabTestCategory } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

/** Everything the catalogue DTO projects, and nothing else. */
const CATALOGUE_SELECT = {
  id: true,
  name: true,
  code: true,
  category: true,
  specimenType: true,
  container: true,
  active: true,
  analytes: {
    select: {
      id: true,
      analyte: true,
      unit: true,
      refLow: true,
      refHigh: true,
      decimals: true,
      criticalLow: true,
      criticalHigh: true,
      qualitativeOptions: true,
    },
    // `analyte` rather than insertion order: a panel whose analytes
    // reorder between two requests makes the order form's checkbox list
    // jump under the cursor. The unique index `(test_id, analyte)`
    // answers this ordering.
    orderBy: { analyte: 'asc' },
  },
} satisfies Prisma.LabTestCatalogueSelect;

export type LabTestRow = Prisma.LabTestCatalogueGetPayload<{ select: typeof CATALOGUE_SELECT }>;
export type LabAnalyteRow = LabTestRow['analytes'][number];

export interface LabTestCriteria {
  readonly q?: string | undefined;
  readonly category?: LabTestCategory | undefined;
  readonly includeInactive?: boolean | undefined;
  readonly page: number;
  readonly pageSize: number;
}

@Injectable()
export class LabTestRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** API §8.1 — one page of the catalogue, analytes included. */
  async list(
    criteria: LabTestCriteria,
  ): Promise<{ rows: readonly LabTestRow[]; totalItems: number }> {
    const where = this.whereFor(criteria);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.labTestCatalogue.findMany({
        where,
        select: CATALOGUE_SELECT,
        // Category then name: the order form groups by category, and a
        // stable secondary key keeps paging deterministic rather than
        // letting two tests swap between requests.
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.labTestCatalogue.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * One test by its LOINC code — what §8.4 orders by.
   *
   * Includes inactive tests deliberately: the ordering service refuses a
   * withdrawn test with a message naming it, which is more useful than
   * the "unknown test code" a filtered lookup would produce.
   */
  findByCode(code: string): Promise<LabTestRow | null> {
    return this.prisma.db.labTestCatalogue.findUnique({
      where: { code },
      select: CATALOGUE_SELECT,
    });
  }

  private whereFor(criteria: LabTestCriteria): Prisma.LabTestCatalogueWhereInput {
    return {
      ...(criteria.includeInactive === true ? {} : { active: true }),
      ...(criteria.category === undefined ? {} : { category: criteria.category }),
      ...(criteria.q === undefined
        ? {}
        : {
            // `contains` + `insensitive` is `ILIKE '%q%'`, which the
            // `gin_trgm_ops` index answers. See the file header.
            OR: [
              { name: { contains: criteria.q, mode: 'insensitive' } },
              { code: { contains: criteria.q, mode: 'insensitive' } },
            ],
          }),
    };
  }
}
