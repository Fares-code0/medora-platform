/**
 * The formulary's queries (RM M13.1 — API §7.1, §7.2).
 *
 * ## The typeahead rides the trigram indexes, and that is deliberate
 *
 * M5.5 created `medications_name_trgm_idx` and
 * `medications_generic_name_trgm_idx` — two GIN indexes with
 * `gin_trgm_ops`. They exist for exactly this query, and they only help
 * if the predicate is a case-insensitive `LIKE '%…%'`: Prisma's
 * `contains` with `mode: 'insensitive'` emits `ILIKE`, which
 * `pg_trgm` can answer from the index instead of scanning every row.
 *
 * Writing the filter any other way silently loses the index. `startsWith`
 * would use a btree that does not exist here; a `to_tsvector` search
 * would need a different index entirely and would stop matching
 * mid-word, which is the one thing a drug-name typeahead must do —
 * a clinician typing "oxic" expects Am**oxic**illin.
 *
 * ## Brand and generic are one search, not two
 *
 * DB §8 records the intent: "typeahead searches brand and generic
 * together". A clinician who knows the molecule and a clinician who
 * knows the box must both find the row, so the `OR` spans both columns
 * and both are indexed.
 *
 * ## `active` is a filter, not a delete
 *
 * A withdrawn medication still appears on prescriptions written before
 * it was withdrawn. The default hides it from the formulary and nothing
 * removes the row, so a historical prescription keeps rendering its
 * medication rather than a dangling id.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type {
  MedicationCategory,
  MedicationForm,
  MedicationRoute,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

/** Everything the catalogue DTO projects, and nothing else. */
const MEDICATION_SELECT = {
  id: true,
  name: true,
  genericName: true,
  category: true,
  form: true,
  route: true,
  manufacturer: true,
  isControlled: true,
  isHighRisk: true,
  interactionNote: true,
  allergyClass: true,
  frequencies: true,
  durationsDays: true,
  strengths: {
    select: { strength: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.MedicationSelect;

export type MedicationRow = Prisma.MedicationGetPayload<{ select: typeof MEDICATION_SELECT }>;

export interface MedicationCriteria {
  readonly q?: string | undefined;
  readonly category?: MedicationCategory | undefined;
  readonly form?: MedicationForm | undefined;
  readonly route?: MedicationRoute | undefined;
  readonly controlled?: boolean | undefined;
  readonly highRisk?: boolean | undefined;
  readonly includeInactive?: boolean | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export interface MonographRow {
  readonly medicationId: string;
  readonly name: string;
  readonly genericName: string;
  readonly indications: string | null;
  readonly contraindications: string | null;
  readonly standardDosing: string | null;
  readonly pregnancyCategory: string | null;
  readonly warnings: string | null;
  readonly sideEffects: string | null;
}

@Injectable()
export class MedicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** API §7.1 — the typeahead, one page of it. */
  async list(
    criteria: MedicationCriteria,
  ): Promise<{ rows: readonly MedicationRow[]; totalItems: number }> {
    const where = this.whereFor(criteria);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.medication.findMany({
        where,
        select: MEDICATION_SELECT,
        // Brand name is what the stepper's list is read by; the generic
        // breaks ties so two brands of one molecule keep a stable order
        // across pages rather than swapping between requests.
        orderBy: [{ name: 'asc' }, { genericName: 'asc' }],
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.medication.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** One medication by id, or `null` — the safety screen's lookup too. */
  findById(id: string): Promise<MedicationRow | null> {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.medication.findUnique({ where: { id }, select: MEDICATION_SELECT });
  }

  /**
   * API §7.2 — the monograph, joined to the medication it describes.
   *
   * Returns `null` both when the medication does not exist and when it
   * has no monograph row. The two are the same answer to the caller —
   * "there is no reference entry here" — and the service turns either
   * into the same 404 rather than a 200 carrying eight nulls, which
   * would read as a monograph that says nothing.
   */
  async monographFor(medicationId: string): Promise<MonographRow | null> {
    if (!UUID.test(medicationId)) return null;

    const row = await this.prisma.db.medicationMonograph.findUnique({
      where: { medicationId },
      select: {
        medicationId: true,
        indications: true,
        contraindications: true,
        standardDosing: true,
        pregnancyCategory: true,
        warnings: true,
        sideEffects: true,
        medication: { select: { name: true, genericName: true } },
      },
    });

    if (row === null) return null;

    return {
      medicationId: row.medicationId,
      name: row.medication.name,
      genericName: row.medication.genericName,
      indications: row.indications,
      contraindications: row.contraindications,
      standardDosing: row.standardDosing,
      pregnancyCategory: row.pregnancyCategory,
      warnings: row.warnings,
      sideEffects: row.sideEffects,
    };
  }

  private whereFor(criteria: MedicationCriteria): Prisma.MedicationWhereInput {
    return {
      ...(criteria.includeInactive === true ? {} : { active: true }),
      ...(criteria.category === undefined ? {} : { category: criteria.category }),
      ...(criteria.form === undefined ? {} : { form: criteria.form }),
      ...(criteria.route === undefined ? {} : { route: criteria.route }),
      ...(criteria.controlled === undefined ? {} : { isControlled: criteria.controlled }),
      ...(criteria.highRisk === undefined ? {} : { isHighRisk: criteria.highRisk }),
      ...(criteria.q === undefined
        ? {}
        : {
            // `contains` + `insensitive` is `ILIKE '%q%'`, which is what
            // the two `gin_trgm_ops` indexes answer. See the file header.
            OR: [
              { name: { contains: criteria.q, mode: 'insensitive' } },
              { genericName: { contains: criteria.q, mode: 'insensitive' } },
            ],
          }),
    };
  }
}

/** Ids arrive from the URL; a malformed one is a 404, never a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
