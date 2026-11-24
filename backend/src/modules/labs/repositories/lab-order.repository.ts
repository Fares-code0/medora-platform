/**
 * The lab order's queries (RM M14.2–M14.7 — API §8.2–§8.10).
 *
 * Holds the identity lookups the whole module shares — which doctor a
 * user is, what to call an actor in a timeline row — plus the order
 * reads and the pipeline writes themselves.
 *
 * ## Scope is a `where` clause, not a filter applied afterwards
 *
 * `careScope(doctorId)` is spread into every read, the way
 * `record.repository.ts` does it. An order outside the caller's care
 * relationship is not *hidden* from the result set — it is never
 * selected, so a count, a page total and a summary card all agree
 * without anybody remembering to subtract.
 *
 * §8.2 marks the list `doctor (own orders / care-scoped)`, which is a
 * disjunction and is implemented as one: an order **this doctor placed**
 * or an order **for a patient in this doctor's care**. Taking only the
 * first would hide a colleague's order on the caller's own patient,
 * which is the case the critical-unreviewed chip exists for — a locum
 * orders the potassium, the patient's own doctor is the one who must see
 * it come back critical. Taking only the second would lose an order
 * placed before an assignment was recorded.
 *
 * ## Every status move is compare-and-set
 *
 * Two clients advancing one order must produce one 200 and one 409, not
 * two timeline entries claiming the specimen was collected twice. The
 * `where` on each `updateMany` carries the status the caller read, and a
 * zero count is the lost race (API §0.5).
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment, PatientClinicalScope } from '../../../shared/authz';

import type { Prisma } from '../../../generated/prisma/client';
import type {
  LabPriority,
  LabResultFlag,
  LabSpecimenCondition,
  LabSpecimenType,
  LabStatus,
  LabTestCategory,
  LabTimelineKind,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

/**
 * A Prisma client that may be a transaction's.
 *
 * The raw client, for the reason `prescription.repository.ts` records:
 * the soft-delete extension and a transaction client are different types
 * and their union is not callable. Queries here state `deletedAt: null`
 * themselves.
 */
export type Db = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LabOrderCriteria {
  readonly q?: string | undefined;
  readonly status?: readonly LabStatus[] | undefined;
  readonly category?: readonly LabTestCategory[] | undefined;
  readonly priority?: readonly LabPriority[] | undefined;
  readonly flag?: LabResultFlag | undefined;
  readonly reviewStatus?: 'not-required' | 'unreviewed' | 'reviewed' | undefined;
  readonly patientId?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly sort: 'requestedAt:asc' | 'requestedAt:desc' | 'priority:desc';
  readonly page: number;
  readonly pageSize: number;
}

@Injectable()
export class LabOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Db): Db {
    return tx ?? this.prisma;
  }

  async displayNameForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    const row = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    return row?.displayName ?? null;
  }

  /** A patient by `PT-…` handle. */
  patientByPublicId(publicId: string, tx?: Db): Promise<PatientIdentity | null> {
    return this.client(tx).patient.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true, publicId: true, fullName: true, mrn: true },
    });
  }

  /** The department a doctor belongs to, stamped onto their orders. */
  async departmentIdForDoctor(doctorId: string): Promise<string | null> {
    const doctor = await this.prisma.db.doctor.findUnique({
      where: { id: doctorId },
      select: { departmentId: true },
    });

    return doctor?.departmentId ?? null;
  }

  /** A department by name — §8.4's optional `department` field. */
  async departmentIdByName(name: string): Promise<string | null> {
    // `findFirst` with `deletedAt: null`: `findUnique` bypasses the
    // soft-delete extension, and a deleted department files no orders.
    const row = await this.prisma.db.department.findFirst({
      where: { name, deletedAt: null },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /** The next `LAB-…` reference. */
  async nextReference(tx?: Db): Promise<string> {
    const rows = await this.client(tx).$queryRaw<
      Array<{ value: bigint }>
    >`SELECT nextval('lab_order_reference_seq') AS value`;

    return `LAB-${String(rows[0]?.value ?? 100_000)}`;
  }

  /**
   * API §8.4 — place the order, with its `ordered` timeline event.
   *
   * One transaction: an order whose timeline does not start with
   * `ordered` has no attributed beginning, and `lab_timeline_events`
   * types `actor` NOT NULL precisely because the chain of custody starts
   * here (DB §E7).
   */
  async create(input: {
    readonly publicId: string;
    /** The chart's scope: patient, hospital, medical record, employment (S4). */
    readonly scope: PatientClinicalScope;
    readonly testId: string;
    readonly departmentId: string | null;
    readonly clinicalIndication: string;
    readonly priority: LabPriority;
    readonly actorId: string;
    readonly actorName: string;
    readonly testName: string;
  }): Promise<DetailRow> {
    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.labOrder.create({
        data: {
          publicId: input.publicId,
          patientId: input.scope.patientId,
          hospitalId: input.scope.hospitalId,
          hospitalMedicalRecordId: input.scope.hospitalMedicalRecordId,
          doctorEmploymentId: input.scope.doctorEmploymentId,
          testId: input.testId,
          ...(input.departmentId === null ? {} : { departmentId: input.departmentId }),
          orderedBy: input.scope.doctorId,
          clinicalIndication: input.clinicalIndication,
          priority: input.priority,
          status: 'ORDERED',
          ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
        },
        select: { id: true },
      });

      await tx.labTimelineEvent.create({
        data: {
          labOrderId: order.id,
          kind: 'ORDERED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actor: input.actorName,
          detail: `${input.testName} requested — ${input.priority.toLowerCase()}`,
        },
      });

      return order.id;
    });

    return this.requireDetail(created);
  }

  /** One order by `LAB-…`, within the caller's scope. */
  findForDoctor(doctor: ClinicalEmployment, publicId: string): Promise<DetailRow | null> {
    return this.prisma.db.labOrder.findFirst({
      where: { publicId, deletedAt: null, ...visibleTo(doctor) },
      select: DETAIL_SELECT,
    });
  }

  /** The same lookup for a set of references — the bulk review's read. */
  findManyForDoctor(
    doctor: ClinicalEmployment,
    publicIds: readonly string[],
  ): Promise<readonly DetailRow[]> {
    return this.prisma.db.labOrder.findMany({
      where: { publicId: { in: [...publicIds] }, deletedAt: null, ...visibleTo(doctor) },
      select: DETAIL_SELECT,
    });
  }

  /** API §8.2 — the worklist, one page of it. */
  async list(
    doctor: ClinicalEmployment,
    criteria: LabOrderCriteria,
  ): Promise<{ rows: readonly DetailRow[]; totalItems: number }> {
    const where = this.whereFor(doctor, criteria);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.labOrder.findMany({
        where,
        select: DETAIL_SELECT,
        orderBy: orderByFor(criteria.sort),
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.labOrder.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * API §8.10 — the summary cards.
   *
   * Six `count`s rather than six queries' worth of rows: the chip polls,
   * and `criticalUnreviewed` is answered by
   * `lab_orders_critical_unreviewed_idx`, the partial index M5.8 created
   * on exactly this predicate. That index is the whole reason DB §14.5-6
   * permits `has_critical_result` to be stored at all, so the predicate
   * here is written to match it literally — `hasCriticalResult: true`
   * and `reviewedAt: null`, no extra clause that would take the query
   * off it.
   */
  async summaryFor(doctor: ClinicalEmployment): Promise<{
    readonly total: number;
    readonly pending: number;
    readonly inProgress: number;
    readonly completed: number;
    readonly cancelled: number;
    readonly criticalUnreviewed: number;
    readonly unreviewed: number;
  }> {
    const scope: Prisma.LabOrderWhereInput = { deletedAt: null, ...visibleTo(doctor) };
    const count = (where: Prisma.LabOrderWhereInput): Promise<number> =>
      this.prisma.db.labOrder.count({ where: { ...scope, ...where } });

    const [total, pending, inProgress, completed, cancelled, criticalUnreviewed, unreviewed] =
      await Promise.all([
        count({}),
        // `PENDING_LAB_STATUSES` on the frontend: ordered **and**
        // collected are both "still awaiting the lab".
        count({ status: { in: ['ORDERED', 'COLLECTED'] } }),
        count({ status: 'PROCESSING' }),
        count({ status: 'COMPLETED' }),
        count({ status: 'CANCELLED' }),
        count({ hasCriticalResult: true, reviewedAt: null }),
        // Released but unreviewed. `results: { some: {} }` is what makes
        // this "waiting on you" rather than "not green": an order still
        // in the analyser has produced nothing to review.
        count({ reviewedAt: null, results: { some: { deletedAt: null } } }),
      ]);

    return { total, pending, inProgress, completed, cancelled, criticalUnreviewed, unreviewed };
  }

  /**
   * API §8.5 — move the order, and write what happened.
   *
   * Compare-and-set on `from`, so a lost race returns `null` and the
   * caller answers 409 rather than writing a second timeline entry.
   * `collected_at` and `completed_at` are stamped by the transition that
   * earns them, which is what keeps
   * `lab_orders_collected_after_requested` and
   * `lab_orders_completed_after_collected` satisfiable — a client
   * supplying its own clock could invert them.
   */
  async transition(input: {
    readonly orderId: string;
    readonly from: LabStatus;
    readonly to: LabStatus;
    readonly at: Date;
    readonly actorId: string;
    readonly actorName: string;
    readonly detail: string;
    readonly timelineKind: LabTimelineKind;
    /** Captured on the `collected` move; absent on every other. */
    readonly specimen?: SpecimenInput | undefined;
    /**
     * Set when the `processing` move is also the moment the lab took
     * receipt. Writes the `received` event alongside the `processing`
     * one, because two things did happen.
     */
    readonly receivedAt?: Date | undefined;
    /** Stamped on the `completed` move — §8.6's `verified` half. */
    readonly verifiedBy?: string | undefined;
    readonly interpretation?: string | undefined;
  }): Promise<DetailRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.labOrder.updateMany({
        where: { id: input.orderId, status: input.from, deletedAt: null },
        data: {
          status: input.to,
          ...(input.to === 'COLLECTED' ? { collectedAt: input.at } : {}),
          ...(input.to === 'COMPLETED' ? { completedAt: input.at } : {}),
          ...(input.interpretation === undefined ? {} : { interpretation: input.interpretation }),
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });

      // Lost the compare-and-set. Nothing was written and nothing is
      // written now — a timeline entry for a step that did not happen is
      // a lie in a chain of custody.
      if (moved.count === 0) return null;

      if (input.specimen !== undefined) {
        await this.writeSpecimen(tx, input.orderId, input.specimen);
      }

      if (input.receivedAt !== undefined) {
        await tx.labSpecimen.updateMany({
          // Only when it is still null: receipt happens once, and
          // re-stamping it would move a chain-of-custody timestamp.
          where: { labOrderId: input.orderId, receivedAt: null },
          data: { receivedAt: input.receivedAt },
        });

        await tx.labTimelineEvent.create({
          data: {
            labOrderId: input.orderId,
            kind: 'RECEIVED',
            // Stamped a millisecond before the move it enables, and
            // explicitly rather than by column default. `occurred_at`
            // defaults to `CURRENT_TIMESTAMP`, which in PostgreSQL is
            // the **transaction's** start time — so both events written
            // by this one transaction were landing on a byte-identical
            // timestamp and `ORDER BY occurred_at DESC` fell through to
            // heap order. A chain of custody whose steps come back in a
            // different order on different reads is not a chain of
            // custody. Receipt genuinely precedes processing: the lab
            // cannot work on a specimen it has not taken in, which is
            // the same fact that makes this event conditional at all.
            // One millisecond is the smallest interval the column can
            // express (`Timestamptz(3)`).
            occurredAt: new Date(input.at.getTime() - 1),
            ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
            actor: input.actorName,
            detail: 'Specimen received in the laboratory',
          },
        });
      }

      if (input.verifiedBy !== undefined && UUID.test(input.verifiedBy)) {
        // Releasing the order verifies its results, which is what §8.6's
        // `verified` half means and what `lab_results.verified_by`
        // records. Only unverified rows are stamped, so a re-run cannot
        // reattribute someone else's verification.
        await tx.labResult.updateMany({
          where: { labOrderId: input.orderId, verifiedBy: null, deletedAt: null },
          data: { verifiedBy: input.verifiedBy },
        });
      }

      await tx.labTimelineEvent.create({
        data: {
          labOrderId: input.orderId,
          kind: input.timelineKind,
          // The move's own clock, not the column default, so this event
          // and the conditional `received` one above are ordered by
          // construction rather than by which row the heap returns
          // first. See that event's comment.
          occurredAt: input.at,
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actor: input.actorName,
          detail: input.detail,
        },
      });

      return tx.labOrder.findUniqueOrThrow({
        where: { id: input.orderId },
        select: DETAIL_SELECT,
      });
    });
  }

  /**
   * The specimen document (DB §E4) — 1:1 with the order, so an upsert.
   *
   * `collected_by` is ADR-003 §4's historical-fact pattern: the FK may
   * go null when an account is removed and the **name snapshot** keeps
   * the chain of custody readable. A specimen whose collector became
   * blank is a compliance problem, not a cosmetic one, so the name is
   * written as well as the id.
   */
  private async writeSpecimen(tx: Db, labOrderId: string, specimen: SpecimenInput): Promise<void> {
    const data = {
      type: specimen.type,
      container: specimen.container,
      collectionSite: specimen.collectionSite,
      collectedBy: specimen.collectedBy,
      ...(UUID.test(specimen.collectedById) ? { collectedById: specimen.collectedById } : {}),
      collectedAt: specimen.collectedAt,
      ...(specimen.receivedAt === null ? {} : { receivedAt: specimen.receivedAt }),
      condition: specimen.condition,
      volume: specimen.volume,
    };

    await tx.labSpecimen.upsert({
      where: { labOrderId },
      create: { labOrderId, ...data },
      update: data,
    });
  }

  /** The specimen's condition alone — the M14.3 gate's only question. */
  async specimenConditionFor(orderId: string): Promise<LabSpecimenCondition | null> {
    const row = await this.prisma.db.labSpecimen.findUnique({
      where: { labOrderId: orderId },
      select: { condition: true },
    });

    return row?.condition ?? null;
  }

  /** Whether the lab has already taken receipt — see `transition`. */
  async specimenReceivedAt(orderId: string): Promise<Date | null> {
    const row = await this.prisma.db.labSpecimen.findUnique({
      where: { labOrderId: orderId },
      select: { receivedAt: true },
    });

    return row?.receivedAt ?? null;
  }

  /**
   * API §8.7 — mark reviewed, compare-and-set on "not yet reviewed".
   *
   * `reviewed_at` and `reviewed_by` are written together because
   * `lab_orders_reviewed_by_iff_reviewed` is a biconditional CHECK: an
   * unattributed review is not evidence that anyone looked.
   *
   * The `where` carries `reviewedAt: null`, so two doctors reviewing one
   * result produce one 200 and one 409 rather than the second silently
   * overwriting the first's attribution.
   */
  async markReviewed(input: {
    readonly orderId: string;
    readonly reviewerId: string;
    readonly reviewedAt: Date;
  }): Promise<DetailRow | null> {
    if (!UUID.test(input.reviewerId)) return null;

    const updated = await this.prisma.db.labOrder.updateMany({
      where: { id: input.orderId, reviewedAt: null, deletedAt: null },
      data: { reviewedAt: input.reviewedAt, reviewedBy: input.reviewerId },
    });

    if (updated.count === 0) return null;

    return this.requireDetail(input.orderId);
  }

  /**
   * The bulk write, in **one** transaction.
   *
   * All of it commits or none of it does, which is what RM M14.5's
   * "write failure must surface (no optimistic success)" requires on the
   * server side: a bulk review that cleared four of six and returned 200
   * would leave a doctor believing a queue is empty that is not. A
   * failure throws out of the transaction and reaches the client as a
   * 5xx with nothing written.
   *
   * Returns the references that actually moved. A reference already
   * reviewed by someone else between the read and the write loses its
   * compare-and-set and is reported rather than counted.
   */
  async markManyReviewed(input: {
    readonly orderIds: readonly { readonly id: string; readonly reference: string }[];
    readonly reviewerId: string;
    readonly reviewedAt: Date;
  }): Promise<readonly string[]> {
    if (!UUID.test(input.reviewerId) || input.orderIds.length === 0) return [];

    return this.prisma.$transaction(async (tx) => {
      const moved: string[] = [];

      for (const order of input.orderIds) {
        const updated = await tx.labOrder.updateMany({
          where: { id: order.id, reviewedAt: null, deletedAt: null },
          data: { reviewedAt: input.reviewedAt, reviewedBy: input.reviewerId },
        });

        if (updated.count > 0) moved.push(order.reference);
      }

      return moved;
    });
  }

  private whereFor(
    doctor: ClinicalEmployment,
    criteria: LabOrderCriteria,
  ): Prisma.LabOrderWhereInput {
    return {
      deletedAt: null,
      // Under `AND`, never spread. `visibleTo` is an `OR`, and so is the
      // `q` search below: spread side by side, the second `OR` key
      // replaced the first, and a search returned every order on the
      // platform (found at M32.3, `test/lab-order-scope.e2e-spec.ts`).
      AND: [visibleTo(doctor)],
      ...(criteria.status === undefined ? {} : { status: { in: [...criteria.status] } }),
      ...(criteria.priority === undefined ? {} : { priority: { in: [...criteria.priority] } }),
      ...(criteria.patientId === undefined ? {} : { patient: { publicId: criteria.patientId } }),
      ...(criteria.category === undefined
        ? {}
        : { test: { category: { in: [...criteria.category] } } }),
      ...(criteria.flag === undefined
        ? {}
        : { results: { some: { flag: criteria.flag, deletedAt: null } } }),
      ...reviewClause(criteria.reviewStatus),
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            requestedAt: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lte: criteria.to }),
            },
          }),
      ...(criteria.q === undefined
        ? {}
        : {
            // §8.2 names the three: patient, test, LAB-id. The patient
            // *is* searchable here, unlike §7.3's prescription list —
            // the difference is that a worklist is worked patient by
            // patient ("where is Mrs Nassar's potassium"), and every row
            // this returns is already inside the caller's care scope, so
            // the search cannot enumerate anyone it could not already
            // read.
            OR: [
              { publicId: { contains: criteria.q, mode: 'insensitive' } },
              { test: { name: { contains: criteria.q, mode: 'insensitive' } } },
              { test: { code: { contains: criteria.q, mode: 'insensitive' } } },
              { patient: { fullName: { contains: criteria.q, mode: 'insensitive' } } },
              { patient: { mrn: { contains: criteria.q, mode: 'insensitive' } } },
            ],
          }),
    };
  }

  private async requireDetail(id: string): Promise<DetailRow> {
    return this.prisma.db.labOrder.findUniqueOrThrow({
      where: { id },
      select: DETAIL_SELECT,
    });
  }
}

export interface PatientIdentity {
  readonly id: string;
  readonly publicId: string;
  readonly fullName: string;
  readonly mrn: string;
}

export interface SpecimenInput {
  readonly type: LabSpecimenType;
  readonly container: string;
  readonly collectionSite: string;
  readonly collectedBy: string;
  readonly collectedById: string;
  readonly collectedAt: Date;
  readonly receivedAt: Date | null;
  readonly condition: LabSpecimenCondition;
  readonly volume: string;
}

/**
 * §8.2's "own orders / care-scoped", as one clause.
 *
 * Both arms, because either alone loses a real case — see the file
 * header. `revokedAt: null` is what makes a revoked assignment stop
 * granting access, which is the whole point of revocation.
 *
 * Hospital-aware since S3/S4: only orders owned by the doctor's active
 * hospital (`hospital_id`, never NULL — #17), and the care arm only through
 * an assignment owned by the doctor's active employment. An order the
 * doctor placed at a previous hospital is that hospital's (OD-12).
 */
function visibleTo(doctor: ClinicalEmployment): Prisma.LabOrderWhereInput {
  return {
    hospitalId: doctor.hospitalId,
    OR: [
      { orderedBy: doctor.doctorId },
      {
        patient: {
          careAssignments: {
            some: {
              doctorId: doctor.doctorId,
              doctorEmploymentId: doctor.doctorEmploymentId,
              hospitalId: doctor.hospitalId,
              revokedAt: null,
            },
          },
        },
      },
    ],
  };
}

/**
 * `reviewStatus` is derived, so it filters as a predicate rather than a
 * column. `not-required` is "nothing released yet" and is deliberately
 * not the same as `unreviewed`: an order still in the analyser is in
 * nobody's inbox (the frontend's `reviewState` makes the same split).
 */
function reviewClause(reviewStatus: LabOrderCriteria['reviewStatus']): Prisma.LabOrderWhereInput {
  switch (reviewStatus) {
    case 'reviewed':
      return { reviewedAt: { not: null } };
    case 'unreviewed':
      return { reviewedAt: null, results: { some: { deletedAt: null } } };
    case 'not-required':
      return { results: { none: { deletedAt: null } } };
    default:
      return {};
  }
}

function orderByFor(sort: LabOrderCriteria['sort']): Prisma.LabOrderOrderByWithRelationInput[] {
  if (sort === 'requestedAt:asc') return [{ requestedAt: 'asc' }];

  if (sort === 'priority:desc') {
    // The enum is declared `routine, urgent, stat`, so Postgres sorts it
    // in clinical-urgency order and `desc` puts STAT first. Requested
    // time breaks the tie oldest-first inside a band: the STAT that has
    // been waiting longest is the one most likely to have been
    // forgotten, which is exactly what the frontend's `sortInbox` says.
    return [{ priority: 'desc' }, { requestedAt: 'asc' }];
  }

  return [{ requestedAt: 'desc' }];
}

/** Everything §8.3's full order projects. */
const DETAIL_SELECT = {
  id: true,
  publicId: true,
  clinicalIndication: true,
  status: true,
  priority: true,
  requestedAt: true,
  collectedAt: true,
  completedAt: true,
  interpretation: true,
  hasCriticalResult: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  patient: {
    select: {
      id: true,
      publicId: true,
      fullName: true,
      mrn: true,
      dateOfBirth: true,
      gender: true,
      bloodType: true,
      phone: true,
    },
  },
  test: { select: { id: true, name: true, code: true, category: true } },
  department: { select: { name: true } },
  orderer: { select: { id: true, fullName: true } },
  reviewer: { select: { displayName: true } },
  specimen: {
    select: {
      type: true,
      container: true,
      collectionSite: true,
      collectedBy: true,
      collectedAt: true,
      receivedAt: true,
      condition: true,
      volume: true,
    },
  },
  results: {
    where: { deletedAt: null },
    select: {
      id: true,
      analyte: true,
      valueText: true,
      valueNumeric: true,
      unit: true,
      refLow: true,
      refHigh: true,
      refText: true,
      flag: true,
      resultedAt: true,
    },
    // Panel order, so the detail page lists WBC before RBC consistently
    // rather than in insertion order, which differs per entry batch.
    orderBy: { analyte: 'asc' },
  },
  attachments: {
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      kind: true,
      sizeKb: true,
      uploadedAt: true,
      uploader: { select: { displayName: true } },
    },
    orderBy: { uploadedAt: 'desc' },
  },
  timeline: {
    select: { id: true, kind: true, occurredAt: true, actor: true, detail: true },
    orderBy: { occurredAt: 'desc' },
  },
} satisfies Prisma.LabOrderSelect;

export type DetailRow = Prisma.LabOrderGetPayload<{ select: typeof DETAIL_SELECT }>;
