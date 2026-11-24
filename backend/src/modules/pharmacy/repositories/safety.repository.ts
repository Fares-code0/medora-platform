/**
 * What the safety screen needs to know (RM M13.2 — API §7.5).
 *
 * Three reads, deliberately separate from `PrescriptionRepository`: the
 * screen runs twice per prescription — advisory at §7.5 and
 * authoritative in-transaction at §7.7 — and the second must be able to
 * run inside a caller's transaction. Every method therefore takes an
 * optional client, so the authoritative pass reads the same snapshot the
 * write will commit against rather than a second, later view of the
 * world.
 *
 * ## "Currently taking" is a status question, and drafts do not count
 *
 * ADR-002 §1: "A draft has not been prescribed: it does not appear in
 * the patient's medication list, generates no notification, and produces
 * no timeline `prescribed` event." So a draft is not screened against —
 * two drafts for one drug are not duplicate therapy, they are one
 * clinician thinking.
 *
 * `pending-approval` **is** counted. ADR-002 §3 reaches it from `draft`
 * through `/sign`, so it is a signed prescription awaiting a second
 * decision — the drug is on its way to the patient. Counting it errs
 * toward more warnings, which is the direction this module errs in.
 * `completed`, `discontinued` and `expired` are finished therapy.
 *
 * ## Why the current list comes from prescriptions, not `patient_medications`
 *
 * `patient_medications` is the richer list — it carries externally
 * reported drugs the clinic never prescribed (M13.6) — but its `name` is
 * `VarChar(120)` free text with no `medication_id`, so it cannot be
 * joined to `drug_interactions`, which is keyed by medication id on both
 * sides. Screening from prescriptions is what the schema supports.
 * **The gap is real and is recorded** in the roadmap's M13.2 note: a
 * medication the patient takes but this clinic never prescribed does not
 * participate in the pairwise interaction check. Closing it needs a
 * `medication_id` on `patient_medications`, which is a schema decision
 * and not this milestone's to make.
 *
 * The interaction rows themselves live behind `INTERACTION_SOURCE`
 * (`services/interaction-source.ts`), because that one dependency has a
 * failure mode API §7.7 gives its own status code.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type { PrescriptionStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

/**
 * A Prisma client that may be a transaction's.
 *
 * The **raw** client rather than `PrismaService['db']`: the soft-delete
 * extension and a transaction client are different types, and a union of
 * the two is not callable. Every query in this file states
 * `deletedAt: null` for itself, so nothing is lost by stepping outside
 * the extension — and a safety query that silently inherited a filter
 * from an extension would be a rule in a place nobody reviewing the
 * screen would look.
 */
export type Db = Prisma.TransactionClient;

/**
 * The statuses that mean "the patient is on this drug".
 *
 * Exported because M13.6's materialisation and the duplicate check must
 * agree about what "current" means; two definitions would let the
 * medication list show a drug the screen does not compare against.
 */
export const LIVE_PRESCRIPTION_STATUSES: readonly PrescriptionStatus[] = [
  'PENDING_APPROVAL',
  'ACTIVE',
  'DISPENSED',
];

export interface AllergyRow {
  readonly allergen: string;
  readonly severity: string;
}

export interface CurrentMedicationRow {
  readonly prescriptionId: string;
  readonly medicationId: string;
  readonly name: string;
  readonly genericName: string;
  readonly category: string;
  readonly isHighRisk: boolean;
}

@Injectable()
export class SafetyRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Db): Db {
    return tx ?? this.prisma;
  }

  /** Every allergy on file. Soft-deleted rows are not allergies. */
  async allergiesFor(
    patientId: string,
    hospitalId: string,
    tx?: Db,
  ): Promise<readonly AllergyRow[]> {
    const rows = await this.client(tx).patientAllergy.findMany({
      where: { patientId, hospitalId, deletedAt: null },
      select: { allergen: true, severity: true },
      orderBy: { allergen: 'asc' },
    });

    return rows.map((row) => ({ allergen: row.allergen, severity: row.severity }));
  }

  /**
   * The patient's live prescriptions, with the medication behind each.
   *
   * `excludePrescriptionId` is how the authoritative pass at §7.7 avoids
   * screening a prescription against itself: by the time a draft is
   * being signed it is a row in this table, and without the exclusion it
   * would report duplicate therapy with itself and refuse every
   * signature.
   */
  async currentMedicationsFor(
    patientId: string,
    hospitalId: string,
    options: { readonly excludePrescriptionId?: string | undefined } = {},
    tx?: Db,
  ): Promise<readonly CurrentMedicationRow[]> {
    const rows = await this.client(tx).prescription.findMany({
      where: {
        patientId,
        hospitalId,
        deletedAt: null,
        status: { in: [...LIVE_PRESCRIPTION_STATUSES] },
        ...(options.excludePrescriptionId === undefined
          ? {}
          : { NOT: { id: options.excludePrescriptionId } }),
      },
      select: {
        publicId: true,
        medicationId: true,
        medication: {
          select: { name: true, genericName: true, category: true, isHighRisk: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      prescriptionId: row.publicId,
      medicationId: row.medicationId,
      name: row.medication.name,
      genericName: row.medication.genericName,
      category: row.medication.category,
      isHighRisk: row.medication.isHighRisk,
    }));
  }

}
