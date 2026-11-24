/**
 * Resolving a conversation's bound entities (RM M16.3, API §11.4).
 *
 * ## This class has no write methods, and that is the design (M16.6)
 *
 * > "The AI module has **no write access to clinical tables**."
 *
 * Every method here is a `findFirst` returning a narrow projection.
 * There is no `create`, no `update`, no `delete`, and no transaction —
 * so the containment rule is something a reader can verify by reading
 * the class rather than something a comment asserts.
 *
 * The narrowness is the other half. A `select` that pulled the whole
 * chart would put the whole chart in reach of the prompt builder, and
 * "the assistant may read what it was bound to" would quietly become
 * "the assistant may read everything about a patient it was bound to".
 * Each query below returns the few fields the grounding line actually
 * uses.
 *
 * ## Care scope is asserted above this, and again inside it
 *
 * `AiConversationService` calls `PatientScopeService.assertCanReach`
 * before any of these run — that is M16.3's "server resolves the bound
 * entities **through `PatientScopeService`**". The `patientId` passed in
 * is therefore already scoped. The entity queries below *also* filter on
 * that patient id, which is not redundant: it is what stops a `refId`
 * naming another patient's record from resolving against a chart the
 * caller legitimately holds. Without it, binding `LAB-100429` under
 * patient `PT-1001` would succeed whoever the order belonged to.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

/** What a bound entity contributes to the grounding line. */
export interface BoundEntity {
  /** The public handle, echoed back on the thread's context. */
  readonly refId: string;
  /** One line naming what was bound — never its clinical content. */
  readonly summary: string;
}

export interface BoundPatient {
  readonly id: string;
  readonly publicId: string;
  readonly fullName: string;
}

@Injectable()
export class AiContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The chart, by `PT-…`. Scoping is the caller's; this is the lookup. */
  patientByPublicId(publicId: string): Promise<BoundPatient | null> {
    return this.prisma.db.patient.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true, publicId: true, fullName: true },
    });
  }

  /** `record` mode — `MR-…`, and it must belong to the bound patient. */
  async recordFor(
    patientId: string,
    hospitalId: string,
    publicId: string,
  ): Promise<BoundEntity | null> {
    const row = await this.prisma.db.medicalRecord.findFirst({
      where: { publicId, patientId, hospitalId, deletedAt: null },
      // `visitType` is a denormalised string on the record (DB §D1), not
      // a relation — the catalogue row it came from may since have been
      // renamed, and the record says what it said at the visit.
      select: { publicId: true, visitDate: true, visitType: true },
    });

    if (row === null) return null;

    return {
      refId: row.publicId,
      summary: `${row.visitType} on ${row.visitDate.toISOString().slice(0, 10)}`,
    };
  }

  /** `labs` mode — `LAB-…`, belonging to the bound patient. */
  async labOrderFor(
    patientId: string,
    hospitalId: string,
    publicId: string,
  ): Promise<BoundEntity | null> {
    const row = await this.prisma.db.labOrder.findFirst({
      where: { publicId, patientId, hospitalId, deletedAt: null },
      select: { publicId: true, status: true, test: { select: { name: true } } },
    });

    if (row === null) return null;

    return {
      refId: row.publicId,
      summary: `${row.test.name} (${row.status.toLowerCase()})`,
    };
  }

  /** `pharmacy` mode — `RX-…`, belonging to the bound patient. */
  async prescriptionFor(
    patientId: string,
    hospitalId: string,
    publicId: string,
  ): Promise<BoundEntity | null> {
    const row = await this.prisma.db.prescription.findFirst({
      where: { publicId, patientId, hospitalId, deletedAt: null },
      select: { publicId: true, medication: { select: { name: true } }, dosage: true },
    });

    if (row === null) return null;

    return {
      refId: row.publicId,
      summary: `${row.medication.name} — ${row.dosage}`,
    };
  }
}
