/**
 * The prescription document's queries (RM M13.2–M13.6 — API §7.3–§7.10).
 *
 * Holds the identity lookups the whole module shares — which doctor a
 * user is, which patient a `PT-…` handle names, what to call an actor in
 * a timeline row — plus the prescription reads and writes themselves.
 *
 * Every method that participates in signing accepts an optional
 * transaction client, because API §7.7 requires the safety check to
 * re-run **in-transaction**: the screen's reads and the status write must
 * see one snapshot, or a drug added to the patient's list between the
 * two would be screened against and then ignored.
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment, PatientClinicalScope } from '../../../shared/authz';

import type { Prisma } from '../../../generated/prisma/client';
import type {
  MedicationRoute,
  PrescriptionStatus,
  RefillStatus,
  SafetyWarningKind,
  SafetyWarningSeverity,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

/**
 * A Prisma client that may be a transaction's.
 *
 * The raw client, for the reason `safety.repository.ts` records: the
 * soft-delete extension and a transaction client are different types and
 * their union is not callable. Queries here state `deletedAt: null`
 * themselves.
 */
export type Db = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PatientIdentity {
  readonly id: string;
  readonly publicId: string;
  readonly fullName: string;
}

export interface ListCriteria {
  readonly q?: string | undefined;
  readonly status?: readonly PrescriptionStatus[] | undefined;
  readonly refillStatus?: readonly RefillStatus[] | undefined;
  readonly patientId?: string | undefined;
  readonly medication?: string | undefined;
  readonly department?: string | undefined;
  readonly warningSeverity?: SafetyWarningSeverity | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly sort: 'createdAt:asc' | 'createdAt:desc';
  readonly page: number;
  readonly pageSize: number;
}

@Injectable()
export class PrescriptionRepository {
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

  /**
   * A patient by `PT-…` handle.
   *
   * `fullName` comes back because the safety screen's warning text names
   * the patient ("Layla Morsi has a recorded Penicillin allergy"). That
   * is PHI in a response body, which is correct here — the response goes
   * to the clinician who is prescribing for that patient and already has
   * the chart open — and is why §7.5 is guarded by
   * `prescriptions.create` and scoped through `PatientScopeService`.
   */
  patientByPublicId(publicId: string, tx?: Db): Promise<PatientIdentity | null> {
    return this.client(tx).patient.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true, publicId: true, fullName: true },
    });
  }

  /** The department a doctor belongs to, stamped onto their prescriptions. */
  async departmentIdForDoctor(doctorId: string): Promise<string | null> {
    const doctor = await this.prisma.db.doctor.findUnique({
      where: { id: doctorId },
      select: { departmentId: true },
    });

    return doctor?.departmentId ?? null;
  }

  /**
   * The visit a prescription was written at (`MR-…`), scoped to its patient
   * and to the same hospital medical record — `prescriptions_scoped_link_trg`
   * refuses any other link (DR-04).
   */
  async recordForPatient(
    scope: PatientClinicalScope,
    publicId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.db.medicalRecord.findFirst({
      where: {
        publicId,
        patientId: scope.patientId,
        hospitalId: scope.hospitalId,
        hospitalMedicalRecordId: scope.hospitalMedicalRecordId,
      },
      select: { id: true },
    });
  }

  /** The next `RX-…` reference. */
  async nextReference(tx?: Db): Promise<string> {
    const rows = await this.client(tx).$queryRaw<
      Array<{ value: bigint }>
    >`SELECT nextval('prescription_reference_seq') AS value`;

    return `RX-${String(rows[0]?.value ?? 200_000)}`;
  }

  /** API §7.6 — the draft. */
  async createDraft(input: {
    readonly publicId: string;
    /** The chart's scope: patient, hospital, medical record, employment (S4). */
    readonly scope: PatientClinicalScope;
    readonly medicationId: string;
    readonly departmentId: string | null;
    readonly recordId: string | null;
    readonly strength: string;
    readonly dosage: string;
    readonly frequency: string;
    readonly route: MedicationRoute;
    readonly durationDays: number;
    readonly quantity: number;
    readonly instructions: string;
    readonly refillsAllowed: number;
    readonly startDate: Date;
    readonly endDate: Date;
    readonly actorId: string;
  }): Promise<DetailRow> {
    const created = await this.prisma.db.prescription.create({
      data: {
        publicId: input.publicId,
        patientId: input.scope.patientId,
        hospitalId: input.scope.hospitalId,
        hospitalMedicalRecordId: input.scope.hospitalMedicalRecordId,
        doctorEmploymentId: input.scope.doctorEmploymentId,
        medicationId: input.medicationId,
        prescribingDoctorId: input.scope.doctorId,
        ...(input.departmentId === null ? {} : { departmentId: input.departmentId }),
        ...(input.recordId === null ? {} : { recordId: input.recordId }),
        strength: input.strength,
        dosage: input.dosage,
        frequency: input.frequency,
        route: input.route,
        durationDays: input.durationDays,
        quantity: input.quantity,
        instructions: input.instructions,
        refillsAllowed: input.refillsAllowed,
        // A draft has authorised nothing yet, so it carries no refills.
        // `/sign` sets the remaining count — see `sign` below.
        refillsRemaining: 0,
        status: 'DRAFT',
        startDate: input.startDate,
        endDate: input.endDate,
        ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
      },
      select: { id: true },
    });

    // A draft writes **no** timeline event. ADR-002 §1: "A draft has not
    // been prescribed … produces no timeline `prescribed` event." The
    // timeline starts when the prescription does.
    return this.requireDetail(created.id);
  }

  /**
   * Run `fn` in one transaction.
   *
   * Exists so API §7.7's "re-runs the safety check **in-transaction**"
   * is literally true: the service opens the transaction, screens
   * against `tx`, and signs against the same `tx`. Throwing inside rolls
   * the whole thing back, which is what makes a refused signature write
   * nothing at all — not a warning row, not a timeline entry, not a
   * partial status change.
   *
   * The alternative — screen first, then call a method that opens its
   * own transaction — reads almost the same and is not the same: a drug
   * added to the patient's list between the two would be screened
   * against and then ignored.
   */
  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  /** The draft as the signing transaction sees it, locked against a race. */
  findDraftWithin(tx: Prisma.TransactionClient, id: string): Promise<DetailRow | null> {
    return tx.prescription.findFirst({
      where: { id, deletedAt: null },
      select: DETAIL_SELECT,
    });
  }

  /**
   * API §7.7 — sign, and everything that must land with it.
   *
   * Called **inside** the caller's transaction, after the screen has run
   * against the same `tx`. The status write, the warning rows, the
   * acknowledgments, the timeline event and the patient's medication row
   * either all commit or none does: a prescription that reached `active`
   * without its `patient_medications` row is a drug the patient is on
   * that the chart does not show.
   *
   * The status move is **compare-and-set** on `DRAFT`. Two signatures
   * racing on one draft must produce one 200 and one 409, not two
   * timeline entries claiming the same prescription was prescribed
   * twice.
   */
  async signWithin(
    tx: Prisma.TransactionClient,
    input: {
    readonly prescriptionId: string;
    readonly to: PrescriptionStatus;
    readonly actorId: string;
    readonly actorName: string;
    readonly warnings: readonly PersistableWarning[];
    readonly acknowledgedIds: readonly string[];
    readonly acknowledgmentReason: string | null;
    readonly refillsAllowed: number;
    readonly signedAt: Date;
    readonly medicationName: string;
    readonly dosage: string;
    readonly frequency: string;
    readonly patientId: string;
    readonly prescribingDoctorId: string;
      readonly startDate: Date;
      readonly endDate: Date;
      /** The visit this was prescribed at, when §7.6 bound one (M15.2). */
      readonly recordId: string | null;
      readonly instructions: string;
    },
  ): Promise<DetailRow | null> {
    const updated = await tx.prescription.updateMany({
      where: { id: input.prescriptionId, status: 'DRAFT' },
      data: {
        status: input.to,
        signedAt: input.signedAt,
        // The allowance becomes the remaining count at the moment the
        // prescription is authorised. Doing it at creation would let a
        // draft that is never signed still read as refillable.
        refillsRemaining: input.refillsAllowed,
        refillStatus: input.refillsAllowed > 0 ? 'AVAILABLE' : 'NONE',
        ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
      },
    });

    // Lost the compare-and-set. Nothing was written and nothing is
    // written now — a timeline entry for a signature that did not
    // happen is a lie in the record.
    if (updated.count === 0) return null;

    await this.writeWarnings(tx, input);

    await tx.prescriptionTimelineEvent.create({
      data: {
        prescriptionId: input.prescriptionId,
        kind: 'PRESCRIBED',
        ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
        actorName: input.actorName,
        detail: `${input.medicationName} — ${input.dosage}, ${input.frequency}`,
      },
    });

    // M13.6 — the patient's current-medication list. Written by the
    // same transaction as the signature, because "signing an Rx adds a
    // `patient_medications` row" is a property, not a follow-up job.
    // Owned like the prescription (`patient_medications_scoped_link_trg`
    // requires the same patient, hospital and medical record).
    const owner = await tx.prescription.findUniqueOrThrow({
      where: { id: input.prescriptionId },
      select: { hospitalId: true, hospitalMedicalRecordId: true },
    });
    await tx.patientMedication.create({
      data: {
        patientId: input.patientId,
        hospitalId: owner.hospitalId,
        hospitalMedicalRecordId: owner.hospitalMedicalRecordId,
        prescriptionId: input.prescriptionId,
        name: input.medicationName,
        dosage: input.dosage,
        frequency: input.frequency,
        startDate: input.startDate,
        endDate: input.endDate,
        prescribedBy: input.prescribingDoctorId,
        status: 'ACTIVE',
        ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
      },
    });

    // M15.2 — the other half of the link. §7.6 already stores
    // `prescriptions.record_id`, so the prescription has always known
    // which visit it was written at; the *record* did not, and a chart
    // that cannot show what was prescribed at the encounter is the half
    // of the linkage a clinician actually reads.
    //
    // Written here, in the signing transaction, for the reason the
    // `patient_medications` row above is: a draft has prescribed
    // nothing (ADR-002 §1), so a record entry created at §7.6 would put
    // a drug in the chart that nobody has authorised — and a refused
    // signature rolls this back with it.
    if (input.recordId !== null) {
      await tx.recordMedication.create({
        data: {
          recordId: input.recordId,
          prescriptionId: input.prescriptionId,
          name: input.medicationName,
          dosage: input.dosage,
          frequency: input.frequency,
          instructions: input.instructions,
          status: 'ACTIVE',
        },
      });

      // `medication-prescribed` is one of the seven kinds the frontend's
      // `RecordTimelineKind` declares and the first writer of it. A
      // medication that appeared in a chart with no timeline entry is
      // the same defect as an attachment that did (§8.9's
      // `attachment-added`): the document changed and the reader cannot
      // see when, or by whom.
      await tx.recordTimelineEvent.create({
        data: {
          recordId: input.recordId,
          kind: 'MEDICATION_PRESCRIBED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          detail: `${input.medicationName} — ${input.dosage}, ${input.frequency}`,
        },
      });
    }

    return tx.prescription.findUniqueOrThrow({
      where: { id: input.prescriptionId },
      select: DETAIL_SELECT,
    });
  }

  /**
   * The safety warnings the signature was granted against (DB §F4).
   *
   * Persisted on **every** signature, cleared first so a re-run cannot
   * leave a stale finding behind. The acknowledgment columns are the
   * audit trail UX §2.7 requires, and a CHECK ties the reason to the
   * acknowledger, so a tick with no reason is not representable.
   */
  private async writeWarnings(
    tx: Prisma.TransactionClient,
    input: {
      readonly prescriptionId: string;
      readonly actorId: string;
      readonly warnings: readonly PersistableWarning[];
      readonly acknowledgedIds: readonly string[];
      readonly acknowledgmentReason: string | null;
    },
  ): Promise<void> {
    await tx.prescriptionSafetyWarning.deleteMany({
      where: { prescriptionId: input.prescriptionId },
    });

    for (const warning of input.warnings) {
      const acknowledged =
        input.acknowledgedIds.includes(warning.id) &&
        input.acknowledgmentReason !== null &&
        UUID.test(input.actorId);

      await tx.prescriptionSafetyWarning.create({
        data: {
          prescriptionId: input.prescriptionId,
          kind: warning.kind,
          severity: warning.severity,
          title: warning.title,
          detail: warning.detail,
          ...(acknowledged
            ? {
                acknowledgedBy: input.actorId,
                acknowledgedReason: input.acknowledgmentReason,
                acknowledgedAt: new Date(),
              }
            : {}),
        },
      });
    }
  }

  /**
   * One prescription by `RX-…`, scoped to the doctor who wrote it **at the
   * doctor's active hospital** (S3/S4): one written at a previous hospital,
   * or a legacy one with no hospital (#17), is not reachable from here.
   */
  findForDoctor(doctor: ClinicalEmployment, publicId: string): Promise<DetailRow | null> {
    return this.prisma.db.prescription.findFirst({
      where: { publicId, ...mine(doctor) },
      select: DETAIL_SELECT,
    });
  }

  /** API §7.3 — the prescriber's own list. */
  async list(
    doctor: ClinicalEmployment,
    criteria: ListCriteria,
  ): Promise<{ rows: readonly DetailRow[]; totalItems: number }> {
    const where = this.whereFor(doctor, criteria);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.prescription.findMany({
        where,
        select: DETAIL_SELECT,
        orderBy: { createdAt: criteria.sort === 'createdAt:asc' ? 'asc' : 'desc' },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.prescription.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * BR-DEC-002, ADR-044 — discard an unsigned draft: a soft delete.
   *
   * The draft's state is in the predicate rather than checked beforehand,
   * so a signature landing in between makes this move nothing — a signed
   * prescription is never discarded, only cancelled or discontinued.
   * `signed_at IS NULL` is stated beside `status` because the M5.8 CHECK
   * ties the two and the predicate should not rely on it to be correct.
   */
  async discardDraft(prescriptionId: string, actorId: string): Promise<boolean> {
    const discarded = await this.prisma.db.prescription.updateMany({
      where: { id: prescriptionId, status: 'DRAFT', signedAt: null, deletedAt: null },
      data: {
        deletedAt: new Date(),
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });

    return discarded.count === 1;
  }

  /**
   * API §7.9 — discontinue or cancel, both to `discontinued`.
   *
   * One transaction: the status, the P4 reason and the timeline event
   * land together. The reason is not optional at the database either —
   * `prescriptions_discontinued_reason_required` is a CHECK, because
   * ADR-002 §4 makes the reason the only surviving record of *which* act
   * this was.
   *
   * Compare-and-set on the status the caller read, so two clients
   * discontinuing one prescription produce one 200 and one 409 rather
   * than two timeline entries.
   */
  async discontinue(input: {
    readonly prescriptionId: string;
    readonly from: PrescriptionStatus;
    readonly reason: string;
    readonly actorId: string;
    readonly actorName: string;
    /** `cancel` or `discontinue` — the distinction ADR-002 §4 keeps. */
    readonly act: string;
  }): Promise<DetailRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.prescription.updateMany({
        where: { id: input.prescriptionId, status: input.from },
        data: {
          status: 'DISCONTINUED',
          discontinuedReason: input.reason,
          // Nothing is refillable once therapy has stopped.
          refillsRemaining: 0,
          refillStatus: 'NONE',
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });

      if (updated.count === 0) return null;

      await tx.prescriptionTimelineEvent.create({
        data: {
          prescriptionId: input.prescriptionId,
          kind: 'DISCONTINUED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          // The act is recorded here because the status cannot carry it:
          // `/cancel` and `/discontinue` both write `discontinued`.
          detail: `${input.act}: ${input.reason}`,
        },
      });

      // The patient is no longer on the drug, so the medication list
      // must say so — in the same transaction, for the same reason
      // signing writes its row in one.
      await tx.patientMedication.updateMany({
        where: { prescriptionId: input.prescriptionId, status: 'ACTIVE' },
        data: { status: 'DISCONTINUED' },
      });

      // M15.2 — and so must the encounter's entry, for the same reason
      // and in the same transaction. The row records what this visit
      // put the patient on; leaving it `active` after therapy stopped
      // would have the chart assert a drug the patient is no longer
      // taking. The filter is on this prescription, so a medication
      // documented at the visit by hand — `prescription_id` null, never
      // screened by §7.5 — is untouched, exactly as M13.6 leaves an
      // externally reported drug alone.
      await tx.recordMedication.updateMany({
        where: { prescriptionId: input.prescriptionId, status: 'ACTIVE' },
        data: { status: 'DISCONTINUED' },
      });

      return tx.prescription.findUniqueOrThrow({
        where: { id: input.prescriptionId },
        select: DETAIL_SELECT,
      });
    });
  }

  /**
   * API §7.8 — a renewal: a **new draft** copied from the source.
   *
   * Not a status change on the original. A renewal is a second course of
   * therapy, and collapsing it into the first would lose which one was
   * dispensed when, and would let a terminal prescription come back to
   * life — which ADR-002 §3 forbids.
   *
   * The `renewed` timeline event is written on the **source**: that is
   * where a reader looking at the finished course asks "what happened
   * next", and the new draft's own timeline starts empty because a draft
   * has not been prescribed.
   */
  async renew(input: {
    readonly sourceId: string;
    /** The renewing doctor's scope on the chart (S4): the draft is owned by it. */
    readonly scope: PatientClinicalScope;
    readonly publicId: string;
    readonly durationDays: number;
    readonly quantity: number;
    readonly refillsAllowed: number;
    readonly instructions: string;
    readonly startDate: Date;
    readonly endDate: Date;
    readonly actorId: string;
    readonly actorName: string;
  }): Promise<DetailRow> {
    const created = await this.prisma.$transaction(async (tx) => {
      const source = await tx.prescription.findUniqueOrThrow({
        where: { id: input.sourceId },
        select: {
          publicId: true,
          patientId: true,
          medicationId: true,
          prescribingDoctorId: true,
          departmentId: true,
          recordId: true,
          strength: true,
          dosage: true,
          frequency: true,
          route: true,
        },
      });

      const draft = await tx.prescription.create({
        data: {
          publicId: input.publicId,
          // Copied verbatim — the identity of the therapy. Changing any
          // of these would make it a different prescription, not a
          // renewal of this one.
          patientId: source.patientId,
          medicationId: source.medicationId,
          prescribingDoctorId: source.prescribingDoctorId,
          hospitalId: input.scope.hospitalId,
          hospitalMedicalRecordId: input.scope.hospitalMedicalRecordId,
          doctorEmploymentId: input.scope.doctorEmploymentId,
          ...(source.departmentId === null ? {} : { departmentId: source.departmentId }),
          ...(source.recordId === null ? {} : { recordId: source.recordId }),
          strength: source.strength,
          dosage: source.dosage,
          frequency: source.frequency,
          route: source.route,
          // Overridable — the course, not the therapy.
          durationDays: input.durationDays,
          quantity: input.quantity,
          instructions: input.instructions,
          refillsAllowed: input.refillsAllowed,
          refillsRemaining: 0,
          status: 'DRAFT',
          startDate: input.startDate,
          endDate: input.endDate,
          ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
        },
        select: { id: true },
      });

      await tx.prescriptionTimelineEvent.create({
        data: {
          prescriptionId: input.sourceId,
          kind: 'RENEWED',
          ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
          actorName: input.actorName,
          detail: `Renewed as ${input.publicId}`,
        },
      });

      return draft.id;
    });

    return this.requireDetail(created);
  }

  /**
   * RM M13.5 — expire every live prescription whose course has ended.
   *
   * ADR-002 §3's row, unqualified: `active | dispensed |
   * pending-approval` → `expired` past `end_date`. `draft` is absent
   * because a draft has never been prescribed, and the three terminal
   * statuses are absent because they are terminal.
   *
   * `end_date` is a `DATE`, so the comparison is `< today` in whole
   * days: a prescription ending today has not expired until tomorrow.
   * Comparing a `DATE` against a timestamp would expire every
   * prescription whose end date is today the moment the clock passed
   * midnight UTC, which is a day early for most of the world.
   *
   * Each row is moved in its own statement inside one transaction, so
   * the timeline event and the medication-list update land with the
   * status — and a row someone else moved between the select and the
   * update is skipped by the compare-and-set rather than double-swept.
   */
  async expirePast(now: Date): Promise<readonly string[]> {
    const today = toDateOnly(now);

    const candidates = await this.prisma.db.prescription.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'DISPENSED', 'PENDING_APPROVAL'] },
        endDate: { lt: today },
      },
      select: { id: true, publicId: true, status: true },
    });

    const expired: string[] = [];

    for (const candidate of candidates) {
      const moved = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.prescription.updateMany({
          // Compare-and-set on the status this pass read: a prescription
          // a clinician discontinued while the sweep was running is
          // theirs, not the sweep's.
          where: { id: candidate.id, status: candidate.status },
          data: {
            status: 'EXPIRED',
            // Nothing is refillable on a finished course.
            refillsRemaining: 0,
            refillStatus: 'NONE',
          },
        });

        if (updated.count === 0) return false;

        await tx.prescriptionTimelineEvent.create({
          data: {
            prescriptionId: candidate.id,
            kind: 'EXPIRED',
            // No actor: nobody did this, the calendar did. `actor_name`
            // is nullable for exactly this case and the projection
            // renders it as "System".
            detail: 'The prescription passed its end date',
          },
        });

        // The patient is no longer on the drug. `completed` rather than
        // `discontinued`: the course ran its length, which is not the
        // same act as someone deciding to stop it — the distinction
        // `discontinue` writes.
        await tx.patientMedication.updateMany({
          where: { prescriptionId: candidate.id, status: 'ACTIVE' },
          data: { status: 'COMPLETED' },
        });

        // M15.2 — the encounter's entry keeps step, and keeps the same
        // distinction: `completed`, because the course ran its length.
        await tx.recordMedication.updateMany({
          where: { prescriptionId: candidate.id, status: 'ACTIVE' },
          data: { status: 'COMPLETED' },
        });

        return true;
      });

      if (moved) expired.push(candidate.publicId);
    }

    return expired;
  }

  /**
   * RM M13.5 — mark prescriptions whose refill is coming due.
   *
   * `windowDays` is supplied by the caller and has no default here, for
   * the reason `PrescriptionSweepService` records: no source states it.
   *
   * Only `available` rows are considered. A `none` row has no refills to
   * come due, and a `pending` one has already been asked for — moving
   * that back to `due` would lose the request.
   */
  async markRefillsDue(now: Date, windowDays: number): Promise<readonly string[]> {
    const threshold = toDateOnly(now);
    threshold.setUTCDate(threshold.getUTCDate() + windowDays);

    const candidates = await this.prisma.db.prescription.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'DISPENSED'] },
        refillStatus: 'AVAILABLE',
        refillsRemaining: { gt: 0 },
        endDate: { lte: threshold },
      },
      select: { id: true, publicId: true },
    });

    if (candidates.length === 0) return [];

    await this.prisma.db.prescription.updateMany({
      where: { id: { in: candidates.map((row) => row.id) }, refillStatus: 'AVAILABLE' },
      data: { refillStatus: 'DUE' },
    });

    return candidates.map((row) => row.publicId);
  }

  /** API §7.10 — a note, and the timeline entry that announces it. */
  async addNote(input: {
    readonly prescriptionId: string;
    readonly authorId: string;
    readonly actorName: string;
    readonly body: string;
  }): Promise<DetailRow> {
    await this.prisma.$transaction(async (tx) => {
      await tx.prescriptionNote.create({
        data: {
          prescriptionId: input.prescriptionId,
          authorId: input.authorId,
          body: input.body,
        },
      });

      await tx.prescriptionTimelineEvent.create({
        data: {
          prescriptionId: input.prescriptionId,
          kind: 'NOTE_ADDED',
          ...(UUID.test(input.authorId) ? { actorId: input.authorId } : {}),
          actorName: input.actorName,
          // The note's text is **not** copied here: it can be 4 000
          // characters and the timeline is a list of headlines. The note
          // itself is one field away in the same payload.
          detail: 'Note added',
        },
      });
    });

    return this.requireDetail(input.prescriptionId);
  }

  /**
   * API §7's summary cards — RM M27.4.
   *
   * Six counts against indexed predicates, in one transaction so all six
   * describe the same instant: run separately, `total` could be read
   * before a signature and `active` after it, and the cards would show
   * more active prescriptions than prescriptions.
   *
   * The field names and the definitions are the frontend's
   * `summarizePrescriptions` (`pharmacy/model/selectors.ts`) verbatim —
   * including `newToday` meaning *created* today rather than signed
   * today, which is what that function counts.
   */
  summaryFor(
    doctor: ClinicalEmployment,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<{
    total: number;
    active: number;
    pendingRefills: number;
    expired: number;
    highRisk: number;
    newToday: number;
  }> {
    const own = mine(doctor);

    return this.prisma.$transaction(async (tx) => {
      const [total, active, pendingRefills, expired, highRisk, newToday] = await Promise.all([
        tx.prescription.count({ where: own }),
        tx.prescription.count({ where: { ...own, status: 'ACTIVE' } }),
        tx.prescription.count({ where: { ...own, refillStatus: 'PENDING' } }),
        tx.prescription.count({ where: { ...own, status: 'EXPIRED' } }),
        tx.prescription.count({ where: { ...own, medication: { isHighRisk: true } } }),
        tx.prescription.count({ where: { ...own, createdAt: { gte: dayStart, lt: dayEnd } } }),
      ]);

      return { total, active, pendingRefills, expired, highRisk, newToday };
    });
  }

  private whereFor(
    doctor: ClinicalEmployment,
    criteria: ListCriteria,
  ): Prisma.PrescriptionWhereInput {
    return {
      ...mine(doctor),
      ...(criteria.status === undefined ? {} : { status: { in: [...criteria.status] } }),
      ...(criteria.refillStatus === undefined
        ? {}
        : { refillStatus: { in: [...criteria.refillStatus] } }),
      ...(criteria.patientId === undefined ? {} : { patient: { publicId: criteria.patientId } }),
      ...(criteria.department === undefined
        ? {}
        : { department: { name: criteria.department } }),
      ...(criteria.warningSeverity === undefined
        ? {}
        : { safetyWarnings: { some: { severity: criteria.warningSeverity } } }),
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            createdAt: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lte: criteria.to }),
            },
          }),
      ...(criteria.medication === undefined
        ? {}
        : {
            medication: {
              OR: [
                { name: { contains: criteria.medication, mode: 'insensitive' } },
                { genericName: { contains: criteria.medication, mode: 'insensitive' } },
              ],
            },
          }),
      ...(criteria.q === undefined
        ? {}
        : {
            OR: [
              { publicId: { contains: criteria.q, mode: 'insensitive' } },
              { medication: { name: { contains: criteria.q, mode: 'insensitive' } } },
              { medication: { genericName: { contains: criteria.q, mode: 'insensitive' } } },
              // Deliberately **not** the patient's name: §7.3's list is
              // reached by prescription and by drug. A free-text search
              // that matched patient names would turn this into a
              // patient finder with none of §4's masking.
            ],
          }),
    };
  }

  private async requireDetail(id: string): Promise<DetailRow> {
    return this.prisma.db.prescription.findUniqueOrThrow({
      where: { id },
      select: DETAIL_SELECT,
    });
  }
}

/** A screened warning, in the enum members the table stores. */
export interface PersistableWarning {
  readonly id: string;
  readonly kind: SafetyWarningKind;
  readonly severity: SafetyWarningSeverity;
  readonly title: string;
  readonly detail: string;
}

/** Everything §7.4's full document projects. */
const DETAIL_SELECT = {
  id: true,
  publicId: true,
  strength: true,
  dosage: true,
  frequency: true,
  route: true,
  durationDays: true,
  quantity: true,
  instructions: true,
  status: true,
  startDate: true,
  endDate: true,
  refillsAllowed: true,
  refillsRemaining: true,
  refillStatus: true,
  signedAt: true,
  discontinuedReason: true,
  // The uuid as well as `record.publicId` below: the projection speaks
  // the `MR-…` handle, and the M15.2 write inside the signing
  // transaction needs the key it is a handle for.
  recordId: true,
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
      allergies: {
        where: { deletedAt: null },
        select: { allergen: true, severity: true },
        orderBy: { allergen: 'asc' },
      },
    },
  },
  medication: {
    select: {
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
    },
  },
  prescriber: { select: { id: true, fullName: true } },
  department: { select: { name: true } },
  record: { select: { publicId: true } },
  safetyWarnings: {
    select: {
      id: true,
      kind: true,
      severity: true,
      title: true,
      detail: true,
      acknowledgedReason: true,
      acknowledgedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  notes: {
    where: { deletedAt: null },
    select: {
      id: true,
      authoredAt: true,
      body: true,
      author: { select: { displayName: true } },
    },
    orderBy: { authoredAt: 'desc' },
  },
  historyEntries: {
    select: { id: true, occurredOn: true, event: true, detail: true },
    orderBy: { occurredOn: 'desc' },
  },
  timeline: {
    select: { id: true, kind: true, occurredAt: true, actorName: true, detail: true },
    orderBy: { occurredAt: 'desc' },
  },
} satisfies Prisma.PrescriptionSelect;

export type DetailRow = Prisma.PrescriptionGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * Midnight UTC on the day `value` falls in.
 *
 * `start_date` and `end_date` are `DATE` columns, so a comparison
 * against a timestamp would be comparing a day to an instant. Truncating
 * the clock to a day first is what makes "past its end date" mean the
 * whole day has gone by.
 */
function toDateOnly(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/**
 * The prescriber's own prescriptions at the active hospital (S3/S4). Rows
 * with no hospital (#17) or another hospital's are excluded.
 */
function mine(doctor: ClinicalEmployment): {
  prescribingDoctorId: string;
  hospitalId: string;
  deletedAt: null;
} {
  return { prescribingDoctorId: doctor.doctorId, hospitalId: doctor.hospitalId, deletedAt: null };
}
