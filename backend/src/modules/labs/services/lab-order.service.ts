/**
 * The lab order (RM M14.2, M14.3 — API §8.2–§8.5, §8.10).
 *
 * The pipeline's write surface. Every rule it enforces lives in
 * `lab-status.machine.ts` (what may follow what) or
 * `specimen-condition.ts` (whether this specimen may be run); this file
 * decides *when* to ask them and what to do with the answer.
 *
 * ## Care scope, every route, no exceptions
 *
 * RM M7.2's standing obligation — "all patient-child access routes
 * through `PatientScopeService`" — transfers to M9–M14, and a lab order
 * is patient-child data. Every read resolves through `visibleTo` in the
 * repository (so an out-of-scope order is never selected) **and** every
 * write re-asserts through `assertCanReach` before touching the row. The
 * two are not redundant: the `where` clause makes the list honest, the
 * assertion makes the refusal explicit and non-disclosing (404, never
 * 403 — ADR-022).
 *
 * ## D-14.2 — the "lab role" half of §8.5 and §8.6 has no scoping model
 *
 * The contract marks §8.5 `doctor/lab role` and §8.6 `lab role`. Both
 * are implemented, and today only a doctor can reach them. That is not a
 * shortcut: `PatientScopeService.canReach` returns false for every
 * principal whose role is not `doctor`, by design — "every other
 * platform role reaches patient data through the masked projections of
 * API §4.11" — so a `laboratory` account has no care relationship to any
 * patient and therefore no path to their order. Giving it one means
 * deciding what scopes a technician (their department? every specimen in
 * the building?), which is an authorization design decision and not this
 * milestone's to invent. ADR-027's open item RA-027.1 records the
 * adjacent fact that three of the five platform roles have permission
 * bundles and no shell to log into. `requireDoctor` is where a
 * non-doctor account stops, with the same 404 every other module gives.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import {
  appliedFilterNames,
  csvFileName,
  EXPORT_ROW_LIMIT,
  exportTooLarge,
  toCsv,
  type CsvColumn,
  type CsvFile,
} from '../../../common/http/csv-export';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PatientScopeService, principalOf, type ClinicalEmployment } from '../../../shared/authz';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type {
  LabPriority,
  LabSpecimenCondition,
  LabSpecimenType,
  LabStatus,
  LabTestCategory,
  LabTimelineKind,
} from '../../../generated/prisma/enums';
import type { LabOrderDetailView, LabOrderView, LabSummaryView } from '../dto/lab-order.dto';
import type {
  CreateLabOrderInput,
  LabOrderExportQuery,
  LabOrderListQuery,
  SpecimenInputDto,
  TransitionLabOrderInput,
} from '../dto/lab-order.schema';
import {
  LAB_CATEGORY_FROM_WIRE,
  LAB_PRIORITY_FROM_WIRE,
  LAB_RESULT_FLAG_FROM_WIRE,
  LAB_SPECIMEN_CONDITION_FROM_WIRE,
  LAB_SPECIMEN_TYPE_FROM_WIRE,
  LAB_STATUS_FROM_WIRE,
  labStatusToWire,
} from '../dto/labs-enums';
import {
  LabOrderRepository,
  type DetailRow,
  type LabOrderCriteria,
  type SpecimenInput,
} from '../repositories/lab-order.repository';
import { LabTestRepository } from '../repositories/lab-test.repository';

import { toLabOrderDetailView, toLabOrderView } from './lab-order-projection';
import { labStatusMachine } from './lab-status.machine';
import { assertProcessable } from './specimen-condition';

export interface PaginatedLabOrders {
  readonly items: readonly LabOrderView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** The wire values §8.5 accepts, mapped to the move each one makes. */
const TRANSITION_TARGET: Record<TransitionLabOrderInput['to'], LabStatus> = {
  collected: 'COLLECTED',
  processing: 'PROCESSING',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

/**
 * The timeline kind each move writes.
 *
 * `completed` writes **`verified`**, not a `completed` event, because
 * DB §E7's vocabulary has no `completed` member and §8.6 names
 * `resulted`/`verified` as the pair: entering values is `resulted`, and
 * releasing the order is the verification. Inventing an eighth kind to
 * match a status name would contradict the enum and the frontend's
 * `LAB_TIMELINE_META`, which draws exactly seven.
 */
const TRANSITION_EVENT: Record<TransitionLabOrderInput['to'], LabTimelineKind> = {
  collected: 'COLLECTED',
  processing: 'PROCESSING',
  completed: 'VERIFIED',
  cancelled: 'CANCELLED',
};

@Injectable()
export class LabOrderService {
  constructor(
    private readonly orders: LabOrderRepository,
    private readonly tests: LabTestRepository,
    private readonly scope: PatientScopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /** API §8.2 — the worklist. */
  async list(
    user: AuthenticatedUser,
    query: LabOrderListQuery,
  ): Promise<PaginatedLabOrders> {
    const doctor = await this.requireDoctor(user);

    const { rows, totalItems } = await this.orders.list(
      doctor,
      criteriaFor(query, query.page, query.pageSize),
    );

    const now = new Date();

    return {
      items: rows.map((row) => toLabOrderView(row, now)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /**
   * API §8.11 — the filtered worklist as a CSV file.
   *
   * `list`'s repository call with `list`'s criteria, so the scope is the
   * worklist's — the ordering doctor's own orders. Audited once, after
   * the read, with the row count and the filter *names*. Result values
   * are not in the file: the worklist row carries the counts and the
   * critical flag, and a result belongs with its reference range, which
   * the order's own detail serves.
   */
  async export(user: AuthenticatedUser, query: LabOrderExportQuery): Promise<CsvFile> {
    const doctor = await this.requireDoctor(user);

    const { rows, totalItems } = await this.orders.list(
      doctor,
      criteriaFor(query, 1, EXPORT_ROW_LIMIT),
    );

    if (totalItems > EXPORT_ROW_LIMIT) throw exportTooLarge(totalItems);

    const now = new Date();
    const body = toCsv(EXPORT_COLUMNS, rows.map((row) => toLabOrderView(row, now)));

    await this.audit.record({
      action: 'lab_order.export',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'lab_order',
      entityId: 'export',
      metadata: { rowCount: rows.length, filters: appliedFilterNames(query), sort: query.sort },
    });

    return { fileName: csvFileName('lab-orders', now), body, rowCount: rows.length };
  }

  /** API §8.3 — the full order. */
  async detail(user: AuthenticatedUser, publicId: string): Promise<LabOrderDetailView> {
    const row = await this.require(user, publicId);

    return toLabOrderDetailView(row, new Date());
  }

  /**
   * API §8.10 — the header cards.
   *
   * No patient scope call: the counts are already scoped by the `where`
   * clause, and there is no single patient to assert against. The
   * numbers are counts over rows the caller can already read one by one,
   * so the aggregate discloses nothing the list does not.
   */
  async summary(user: AuthenticatedUser): Promise<LabSummaryView> {
    const doctor = await this.requireDoctor(user);

    return this.orders.summaryFor(doctor);
  }

  /**
   * API §8.4 — place an order.
   *
   * The order names a **test the catalogue carries** and a patient the
   * caller has a care relationship with. Neither is negotiable: an order
   * for a code no lab can run is a phone call, and an order on a chart
   * the clinician is not on is the disclosure ADR-022 exists to stop.
   *
   * A **withdrawn** test is refused by name rather than as "unknown", so
   * a clinician ordering last year's panel is told it was withdrawn
   * instead of doubting their own typing.
   */
  async create(
    user: AuthenticatedUser,
    input: CreateLabOrderInput,
  ): Promise<LabOrderDetailView> {
    const doctor = await this.requireDoctor(user);
    // The chart's scope (S3/S4): the order is placed at the active
    // hospital, on the patient's medical record there, under the doctor's
    // active employment — server-derived, never client input.
    const scope = await this.scope.assertCanReach(principalOf(user), input.patientId);

    const patient = await this.orders.patientByPublicId(input.patientId);
    if (patient === null) throw AppException.notFound('Patient not found');

    const test = await this.tests.findByCode(input.testCode);
    if (test === null) {
      throw AppException.validation(
        { testCode: ['Not a test in this catalogue'] },
        'Unknown test code',
      );
    }

    if (!test.active) {
      throw AppException.validation(
        { testCode: [`${test.name} has been withdrawn from the catalogue.`] },
        'Withdrawn test',
      );
    }

    const departmentId = await this.departmentFor(input.department, doctor.doctorId);

    const row = await this.orders.create({
      publicId: await this.orders.nextReference(),
      scope,
      testId: test.id,
      departmentId,
      clinicalIndication: input.clinicalIndication,
      priority: LAB_PRIORITY_FROM_WIRE[input.priority] as LabPriority,
      actorId: user.id,
      actorName: await this.actorName(user),
      testName: test.name,
    });

    await this.audit.record({
      action: 'lab_order.create',
      actor: { userId: user.id, role: user.role },
      entityType: 'lab_order',
      entityId: row.publicId,
      // The indication is clinical prose about a patient and is not
      // copied here: the row it lives on is already the record. What the
      // audit trail needs is which test, for whom, at what urgency.
      metadata: { test: test.code, patientId: patient.publicId, priority: input.priority },
    });

    return toLabOrderDetailView(row, new Date());
  }

  /**
   * API §8.5 — move the order along the pipeline.
   *
   * ## Three gates, in this order, and the order is the design
   *
   * 1. **The machine.** "This order is already completed" is a different
   *    failure from "this specimen is unusable", and a client must be
   *    able to tell them apart. Asking the machine first means a
   *    `completed → processing` request never reaches the specimen check
   *    and gets `invalid_status_transition`, which is the true answer.
   * 2. **The payload's shape.** A specimen belongs to the `collected`
   *    move and an interpretation to the `completed` one. Sending either
   *    anywhere else is refused rather than ignored: silently dropping a
   *    specimen a client believed it had recorded is how an order
   *    reaches the analyser with no chain of custody.
   * 3. **The specimen** (RM M14.3). `processing` and only `processing`:
   *    a hemolyzed sample may still be cancelled, and refusing the
   *    cancel would strand it.
   *
   * All three throw before the write, and the write itself is a
   * compare-and-set — so a refused transition changes nothing, and a
   * lost race is a 409 rather than a duplicated timeline entry.
   */
  async transition(
    user: AuthenticatedUser,
    publicId: string,
    input: TransitionLabOrderInput,
  ): Promise<LabOrderDetailView> {
    const current = await this.require(user, publicId);
    const to = TRANSITION_TARGET[input.to];

    labStatusMachine.assert(current.status, to);
    this.assertPayloadFits(input, to);

    const at = new Date();
    const actorName = await this.actorName(user);
    const specimen =
      input.specimen === undefined
        ? undefined
        : toSpecimenInput(input.specimen, user, actorName, at);

    if (specimen !== undefined) this.assertCustodyOrdered(specimen, current);

    if (to === 'PROCESSING') {
      // RM M14.3. Read through the repository rather than off the detail
      // row so the check sees the specimen as it is now, not as the read
      // that resolved the order saw it.
      assertProcessable(await this.orders.specimenConditionFor(current.id));
    }

    // The lab cannot process what it has not received, so the
    // `processing` move stamps receipt when nothing else has. Written
    // only on the null→value edge, which is what keeps the `received`
    // timeline event to exactly one occurrence.
    const receivedAt =
      to === 'PROCESSING' && (await this.orders.specimenReceivedAt(current.id)) === null
        ? at
        : undefined;

    const row = await this.orders.transition({
      orderId: current.id,
      from: current.status,
      to,
      at,
      actorId: user.id,
      actorName,
      detail: input.detail ?? defaultDetailFor(input.to, current),
      timelineKind: TRANSITION_EVENT[input.to],
      specimen,
      receivedAt,
      verifiedBy: to === 'COMPLETED' ? user.id : undefined,
      interpretation: input.interpretation,
    });

    if (row === null) {
      throw AppException.conflict(
        'This order was moved by someone else while this request was in flight',
        'conflict',
      );
    }

    await this.audit.record({
      action: 'lab_order.transition',
      actor: { userId: user.id, role: user.role },
      entityType: 'lab_order',
      entityId: row.publicId,
      metadata: {
        from: labStatusToWire(current.status),
        to: input.to,
        ...(input.specimen === undefined ? {} : { condition: input.specimen.condition }),
      },
    });

    if (to === 'COMPLETED') {
      await this.activity.record({
        userId: user.id,
        // `profile` is the closest of the seven account-activity kinds
        // and the one M12 and M13 use for the same purpose. The detail
        // carries the reference and **not** the result: the feed's own
        // rule is that a summary names what changed, never the clinical
        // value it changed to.
        kind: 'profile',
        summary: 'Released a lab result',
        detail: row.publicId,
      });

      // After commit, never before (API §0.5). The critical-value alert
      // path this module owns: M19's channels and M30's workers are the
      // consumers, and neither exists yet, so the message is logged and
      // discarded — which is the outbox's documented behaviour, not a
      // silent drop.
      await this.outbox.publish({
        topic: row.hasCriticalResult ? 'lab_order.critical_released' : 'lab_order.completed',
        payload: {
          labOrderId: row.publicId,
          patientId: current.patient.publicId,
          test: current.test.code,
          hasCriticalResult: row.hasCriticalResult,
        },
        dedupeKey: `lab_order.completed:${row.publicId}:${at.toISOString()}`,
      });
    }

    return toLabOrderDetailView(row, new Date());
  }

  /**
   * Resolve an order, or refuse without disclosing that it exists.
   *
   * `findForDoctor` already applies the care scope, so a missing row and
   * an out-of-scope one are the same 404 here. `assertCanReach` runs
   * afterwards anyway, because the repository's clause and the scope
   * service could drift and the assertion is the one that is *tested*
   * against the assignment table (RM M7.2). Shared by every route so
   * there is exactly one place an order is resolved.
   */
  async require(user: AuthenticatedUser, publicId: string): Promise<DetailRow> {
    const doctor = await this.requireDoctor(user);
    const row = await this.orders.findForDoctor(doctor, publicId);
    if (row === null) throw AppException.notFound('Lab order not found');

    await this.scope.assertCanReach(principalOf(user), row.patient.publicId);

    return row;
  }

  /**
   * The doctor's clinical employment (S3/S4): every order read and write is
   * scoped to its hospital. No profile, no active employment, or an
   * unverified, suspended or deleted doctor (#18, OD-12) fail closed here.
   */
  async requireDoctor(user: AuthenticatedUser): Promise<ClinicalEmployment> {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));
    // See D-14.2 in the file header: a `laboratory` account stops here,
    // because no care-scoping model exists for it. 404 rather than 403,
    // so the refusal discloses nothing about the roster.
    if (doctor === null) throw AppException.notFound('No doctor profile for this account');

    return doctor;
  }

  async actorName(user: AuthenticatedUser): Promise<string> {
    return (await this.orders.displayNameForUser(user.id)) ?? user.publicId;
  }

  /**
   * A specimen belongs to `collected` and an interpretation to
   * `completed`. Refused rather than ignored — see gate 2 above.
   */
  private assertPayloadFits(input: TransitionLabOrderInput, to: LabStatus): void {
    if (to === 'COLLECTED' && input.specimen === undefined) {
      throw AppException.validation(
        {
          specimen: [
            'Collecting an order records its specimen: type, container, site, volume and ' +
              'condition.',
          ],
        },
        'Specimen required',
      );
    }

    if (to !== 'COLLECTED' && input.specimen !== undefined) {
      throw AppException.validation(
        { specimen: [`A specimen is captured with the \`collected\` move, not \`${labStatusToWire(to)}\`.`] },
        'Specimen not accepted here',
      );
    }

    if (to !== 'COMPLETED' && input.interpretation !== undefined) {
      // `lab_orders_interpretation_requires_completion` would refuse the
      // row anyway; refusing here makes it a 422 naming the field rather
      // than a constraint violation the caller reads as a 500.
      throw AppException.validation(
        {
          interpretation: [
            'An interpretation can only be written when the order is completed — an opinion ' +
              'on results that are not released yet is a draft in a clinical record.',
          ],
        },
        'Interpretation not accepted here',
      );
    }
  }

  /**
   * The chain of custody runs forwards: requested, collected, received.
   *
   * Two CHECK constraints already say so —
   * `lab_orders_collected_after_requested` and
   * `lab_specimens_received_after_collected` (M5.8) — and a specimen
   * received before it was collected inverts the chain of custody, which
   * is a compliance problem rather than a cosmetic one. But a constraint
   * violation reaches a client as a 500 with no field on it, so the two
   * are checked here first and answered as a 422 naming the field the
   * caller can actually correct.
   *
   * Checked against the **resolved** values rather than the request's,
   * because both timestamps default to the server clock: a client that
   * sends `receivedAt` and omits `collectedAt` is comparing its own
   * instant against one this request just minted, and those are
   * milliseconds apart in either direction.
   */
  private assertCustodyOrdered(specimen: SpecimenInput, current: DetailRow): void {
    if (specimen.collectedAt.getTime() < current.requestedAt.getTime()) {
      throw AppException.validation(
        {
          'specimen.collectedAt': [
            'A specimen cannot be collected before the order that asked for it.',
          ],
        },
        'Collection precedes the order',
      );
    }

    if (
      specimen.receivedAt !== null &&
      specimen.receivedAt.getTime() < specimen.collectedAt.getTime()
    ) {
      throw AppException.validation(
        {
          'specimen.receivedAt': [
            'A specimen cannot be received before it was collected. Send `collectedAt` too if ' +
              'the draw happened earlier.',
          ],
        },
        'Receipt precedes collection',
      );
    }
  }

  /**
   * The department the order is filed under.
   *
   * Named → that department, and an unknown name is a 422 rather than a
   * silent fall back to the doctor's own: filing a consult's order under
   * the wrong department is how it lands in the wrong worklist.
   */
  private async departmentFor(
    named: string | undefined,
    doctorId: string,
  ): Promise<string | null> {
    if (named === undefined) return this.orders.departmentIdForDoctor(doctorId);

    const departmentId = await this.orders.departmentIdByName(named);
    if (departmentId === null) {
      throw AppException.validation({ department: ['Unknown department'] }, 'Unknown department');
    }

    return departmentId;
  }
}

/** One translation of the wire filters, shared by the worklist and the export. */
function criteriaFor(query: LabOrderExportQuery, page: number, pageSize: number): LabOrderCriteria {
  return {
    q: query.q,
    status: query.status?.map((value) => LAB_STATUS_FROM_WIRE[value] as LabStatus),
    priority: query.priority?.map((value) => LAB_PRIORITY_FROM_WIRE[value] as LabPriority),
    category: query.category?.map((value) => LAB_CATEGORY_FROM_WIRE[value] as LabTestCategory),
    flag: query.flag === undefined ? undefined : LAB_RESULT_FLAG_FROM_WIRE[query.flag],
    reviewStatus: query.reviewStatus,
    patientId: query.patientId,
    from: query.from,
    to: query.to,
    sort: query.sort,
    page,
    pageSize,
  };
}

/** The worklist row, one line per order. */
const EXPORT_COLUMNS: readonly CsvColumn<LabOrderView>[] = [
  { header: 'labOrderId', value: (row) => row.id },
  { header: 'requestedDate', value: (row) => row.requestedDate },
  { header: 'patientId', value: (row) => row.patient.id },
  { header: 'patientName', value: (row) => row.patient.name },
  { header: 'mrn', value: (row) => row.patient.mrn },
  { header: 'testCode', value: (row) => row.testCode },
  { header: 'testName', value: (row) => row.testName },
  { header: 'category', value: (row) => row.category },
  { header: 'priority', value: (row) => row.priority },
  { header: 'status', value: (row) => row.status },
  { header: 'orderedBy', value: (row) => row.orderedBy },
  { header: 'department', value: (row) => row.department },
  { header: 'clinicalIndication', value: (row) => row.clinicalIndication },
  { header: 'collectedDate', value: (row) => row.collectedDate },
  { header: 'completedDate', value: (row) => row.completedDate },
  { header: 'results', value: (row) => row.resultSummary.total },
  { header: 'abnormal', value: (row) => row.resultSummary.abnormal },
  { header: 'critical', value: (row) => row.resultSummary.critical },
  { header: 'hasCriticalResult', value: (row) => row.hasCriticalResult },
  { header: 'reviewStatus', value: (row) => row.reviewStatus },
  { header: 'reviewedAt', value: (row) => row.review?.reviewedAt ?? null },
];

/** The DTO's wire values → the repository's enum members and defaults. */
function toSpecimenInput(
  dto: SpecimenInputDto,
  user: AuthenticatedUser,
  actorName: string,
  now: Date,
): SpecimenInput {
  return {
    type: LAB_SPECIMEN_TYPE_FROM_WIRE[dto.type] as LabSpecimenType,
    container: dto.container,
    collectionSite: dto.collectionSite,
    // The signed-in collector by default. The **name** is stored beside
    // the id (ADR-003 §4) so the chain of custody survives the account.
    collectedBy: dto.collectedBy ?? actorName,
    collectedById: user.id,
    // The server's clock by default. A client-supplied time is accepted
    // because a draw entered an hour later is a real case, and the
    // `lab_orders_collected_after_requested` CHECK is what stops one
    // that precedes the order.
    collectedAt: dto.collectedAt ?? now,
    receivedAt: dto.receivedAt ?? null,
    condition: LAB_SPECIMEN_CONDITION_FROM_WIRE[dto.condition] as LabSpecimenCondition,
    volume: dto.volume,
  };
}

/** A timeline entry with no detail says less than the step it records. */
function defaultDetailFor(to: TransitionLabOrderInput['to'], current: DetailRow): string {
  switch (to) {
    case 'collected':
      return `Specimen collected for ${current.test.name}`;
    case 'processing':
      return 'Processing started';
    case 'completed':
      return 'Results verified and released';
    case 'cancelled':
      return 'Order cancelled';
  }
}
