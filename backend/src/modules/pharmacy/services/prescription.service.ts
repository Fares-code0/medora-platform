/**
 * Prescribing (RM M13.2–M13.6 — API §7.5–§7.10).
 *
 * The module's one write surface. Every clinical rule it enforces lives
 * in `safety-screen.ts` (what is unsafe) or
 * `prescription-status.machine.ts` (what may follow what); this file
 * decides *when* to ask them and what to do with the answer.
 */

import { HttpStatus, Inject, Injectable } from '@nestjs/common';

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
import { AUDIT_DISPATCHER, type AuditDispatcher, MandatoryAuditWriter } from '../../../shared/audit';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type {
  PrescriptionStatus,
  RefillStatus,
  SafetyWarningKind,
  SafetyWarningSeverity,
} from '../../../generated/prisma/enums';
import {
  PRESCRIPTION_STATUS_FROM_WIRE,
  REFILL_STATUS_FROM_WIRE,
  WARNING_SEVERITY_FROM_WIRE,
  prescriptionStatusToWire,
} from '../dto/pharmacy-enums';
import type {
  PrescriptionDetailView,
  PrescriptionSummaryView,
  PrescriptionView,
} from '../dto/prescription.dto';
import type { SafetyCheckView, SafetyWarningView } from '../dto/safety.dto';
import type {
  CreatePrescriptionInput,
  CreatePrescriptionNoteInput,
  DiscontinuePrescriptionInput,
  PrescriptionExportQuery,
  PrescriptionListQuery,
  RenewPrescriptionInput,
  SafetyCheckInput,
  SignPrescriptionInput,
} from '../dto/prescription.schema';
import { MedicationRepository } from '../repositories/medication.repository';
import {
  PrescriptionRepository,
  type Db,
  type ListCriteria,
  type PersistableWarning,
} from '../repositories/prescription.repository';

import { InteractionSourceUnavailable } from './interaction-source';
import { toPrescriptionDetailView, toPrescriptionView } from './prescription-projection';
import { assertDiscontinuable, signedStatusFor } from './prescription-status.machine';
import {
  blockingWarnings,
  warningsNeedingAcknowledgment,
  type ScreenWarning,
} from './safety-screen';
import { SafetyService } from './safety.service';

export interface PaginatedPrescriptions {
  readonly items: readonly PrescriptionView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class PrescriptionService {
  constructor(
    /** Mandatory audit of disclosures: a failed write refuses the read (F-02). */
    private readonly disclosures: MandatoryAuditWriter,
    private readonly safety: SafetyService,
    private readonly prescriptions: PrescriptionRepository,
    private readonly medications: MedicationRepository,
    private readonly scope: PatientScopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /**
   * API §7.5 — the advisory screen the stepper runs as the doctor types.
   *
   * **Advisory, and the word is load-bearing.** Nothing here prevents
   * anything: the binding screen is the in-transaction re-run at §7.7,
   * because a check answered thirty seconds ago describes a patient who
   * may since have been prescribed something else. This endpoint exists
   * so the clinician sees the conflict before filling in the rest of the
   * form, not so the client can decide the prescription is safe.
   *
   * ## An unavailable source is 503 here and 409 at §7.7
   *
   * The contract gives `safety_check_unavailable` a 409 at §7.7 because
   * there is a prescription whose state the failure decides — it stays
   * in `draft`. At §7.5 no prescription exists yet, so there is no
   * conflicting state to report; the dependency is simply down, which is
   * what 503 means and what this repository already answers when a
   * dependency is missing (`registration.service.ts`, the file-storage
   * stub). The **code is deliberately the same**, so a client handles
   * one condition in one place.
   *
   * What must never happen in either place is an empty warning list.
   * That is the fail-open this module exists to prevent.
   */
  async safetyCheck(user: AuthenticatedUser, input: SafetyCheckInput): Promise<SafetyCheckView> {
    try {
      const outcome = await this.safety.screen(user, {
        patientId: input.patientId,
        medicationId: input.medicationId,
      });

      return toSafetyCheckView(outcome.warnings, outcome.blocking);
    } catch (error) {
      if (error instanceof InteractionSourceUnavailable) {
        throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
          message: 'The drug-interaction check is unavailable',
          code: 'safety_check_unavailable',
          detail:
            'The safety screen could not complete, so no prescription may be signed. ' +
            'Drafts can still be saved.',
        });
      }

      throw error;
    }
  }

  /**
   * API §7.6 — create a draft.
   *
   * **No safety gate here, and that is deliberate.** A draft is a
   * clinician thinking: refusing to save one because the patient is
   * allergic would lose the work rather than prevent the harm, and the
   * harm is prescribing, not drafting. RM M13.3's chaos test says this
   * in as many words — "proves send is impossible but **draft save
   * works**". Every gate is on `/sign`, which is where the prescription
   * becomes real.
   *
   * `endDate` is derived rather than accepted: it is `startDate +
   * durationDays`, and letting a client send both invites a row whose
   * duration and dates disagree about how long the course is.
   */
  async create(
    user: AuthenticatedUser,
    input: CreatePrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    const doctorId = await this.requireDoctor(user);
    await this.scope.assertCanReach(principalOf(user), input.patientId);

    const patient = await this.prescriptions.patientByPublicId(input.patientId);
    if (patient === null) throw AppException.notFound('Patient not found');

    const medication = await this.medications.findById(input.medicationId);
    if (medication === null) {
      throw AppException.validation({ medicationId: ['Unknown medication'] }, 'Unknown medication');
    }

    // The strength must be one the catalogue dispenses (DB §F2). A free
    // string here is how "500mg" and "500 mg" end up on two prescriptions
    // for one drug, and how a strength nobody stocks reaches a pharmacy.
    const strengths = medication.strengths.map((entry) => entry.strength);
    if (!strengths.includes(input.strength)) {
      throw AppException.validation(
        { strength: [`Not a dispensable strength. Available: ${strengths.join(', ')}`] },
        'Unknown strength',
      );
    }

    // `authoring.ts:213`, verbatim and rank-1: a controlled medication
    // cannot carry refills. Enforced here rather than in the schema
    // because it needs the catalogue row, and enforced at all because
    // the API is the surface that actually dispenses — a rule that lives
    // only in the stepper is not a rule.
    if (input.refillsAllowed > 0 && medication.isControlled) {
      throw AppException.validation(
        { refillsAllowed: ['A controlled medication cannot carry refills.'] },
        'A controlled medication cannot carry refills',
      );
    }

    const record =
      input.recordId === undefined
        ? null
        : await this.prescriptions.recordForPatient(patient.id, input.recordId);

    if (input.recordId !== undefined && record === null) {
      throw AppException.validation(
        { recordId: ['Unknown record for this patient'] },
        'Unknown record',
      );
    }

    const startDate = input.startDate ?? new Date();
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + input.durationDays);

    const row = await this.prescriptions.createDraft({
      publicId: await this.prescriptions.nextReference(),
      patientId: patient.id,
      medicationId: medication.id,
      prescribingDoctorId: doctorId,
      departmentId: await this.prescriptions.departmentIdForDoctor(doctorId),
      recordId: record?.id ?? null,
      strength: input.strength,
      dosage: input.dosage,
      frequency: input.frequency,
      // The catalogue's route, not a client's: `medications.route` is
      // what the drug is given by, and §7.6's body does not carry one.
      route: medication.route,
      durationDays: input.durationDays,
      quantity: input.quantity,
      instructions: input.instructions,
      refillsAllowed: input.refillsAllowed,
      startDate,
      endDate,
      actorId: user.id,
    });

    await this.audit.record({
      action: 'prescription.create_draft',
      actor: { userId: user.id, role: user.role },
      entityType: 'prescription',
      entityId: row.publicId,
      metadata: { medication: medication.name, patientId: patient.publicId },
    });

    // No outbox message and no timeline event: a draft is not a
    // prescription, and notifying a patient about one would be telling
    // them about a decision nobody has taken (ADR-002 §1).
    return toPrescriptionDetailView(row, new Date());
  }

  /**
   * API §7.7 — sign & send. The milestone's whole point.
   *
   * ## The screen re-runs inside the transaction
   *
   * The advisory answer at §7.5 describes a patient as they were when
   * the stepper asked. Between then and now the patient may have been
   * prescribed something else, had an allergy recorded, or had this very
   * draft signed by a colleague. So the binding screen runs **inside the
   * signing transaction**, against the same snapshot the status write
   * commits against, and it is that run — not the client's echo — that
   * decides.
   *
   * ## Three refusals, three codes, one posture
   *
   * | Finding | Code | Result |
   * |---|---|---|
   * | Allergy conflict | `allergy_conflict` | 409, **no override exists** |
   * | Unacknowledged warning | `acknowledgment_required` | 409 until ticked *with a reason* |
   * | Source unreachable | `safety_check_unavailable` | 409, stays `draft` |
   *
   * All three leave the prescription in `draft`, which is the fail-closed
   * rule ADR-002 §1 calls load-bearing: the failure is a *state* a client
   * can see and filter on, not an error it can retry past.
   *
   * The transaction is opened before the screen runs and rolled back by
   * throwing, so a refusal writes nothing at all — not the warning rows,
   * not a timeline entry, not a partial status change.
   */
  async sign(
    user: AuthenticatedUser,
    publicId: string,
    input: SignPrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    const doctorId = await this.requireDoctor(user);
    const current = await this.prescriptions.findForDoctor(doctorId, publicId);
    if (current === null) throw AppException.notFound('Prescription not found');

    // The machine first: "this is already signed" is a different failure
    // from "this is unsafe", and a client must be able to tell them
    // apart. Signing an active prescription is a stale client, not a
    // clinical problem.
    if (current.status !== 'DRAFT') {
      throw AppException.conflict(
        `A ${prescriptionStatusToWire(current.status)} prescription cannot be signed`,
        'invalid_status_transition',
      );
    }

    await this.scope.assertCanReach(principalOf(user), current.patient.publicId);

    const actorName = await this.actorName(user);
    const signedAt = new Date();
    const acknowledged = input.acknowledgedWarningIds ?? [];
    const reason = input.reason?.trim() ?? '';

    // Everything below runs in one transaction, and every refusal throws
    // out of it — so a refused signature leaves no trace at all.
    const signed = await this.prescriptions.runInTransaction(async (tx) => {
      const outcome = await this.screenForSigning(
        user,
        current.patient.publicId,
        current,
        tx,
      );

      // 1. Allergy — no override path exists (API §7.7, UX §2.7).
      const blocking = blockingWarnings(outcome.warnings);
      if (blocking.length > 0) {
        throw AppException.conflict(
          blocking.map((warning) => warning.detail).join(' '),
          'allergy_conflict',
          blocking[0]?.title ?? 'Allergy conflict',
        );
      }

      // 2. Severe findings need an explicit tick **and** a reason. A tick
      //    with no reason is not an acknowledgment (UX §2.7, and the
      //    frontend's `acknowledgmentApplies` says the same).
      const required = warningsNeedingAcknowledgment(outcome.warnings);
      const missing = required.filter((warning) => !acknowledged.includes(warning.id));

      if (missing.length > 0 || (required.length > 0 && reason === '')) {
        throw AppException.conflict(
          missing.length > 0
            ? `Acknowledge every safety warning before signing: ${missing
                .map((warning) => warning.title)
                .join('; ')}`
            : 'An acknowledgment must carry a reason, which is audit-logged.',
          'acknowledgment_required',
          'Acknowledgment required',
        );
      }

      return {
        row: await this.prescriptions.signWithin(tx, {
          prescriptionId: current.id,
          to: signedStatusFor(current.medication.isControlled),
          actorId: user.id,
          actorName,
          warnings: outcome.warnings.map(toPersistable),
          acknowledgedIds: acknowledged,
          acknowledgmentReason: reason === '' ? null : reason,
          refillsAllowed: current.refillsAllowed,
          signedAt,
          medicationName: current.medication.name,
          dosage: current.dosage,
          frequency: current.frequency,
          patientId: current.patient.id,
          prescribingDoctorId: doctorId,
          startDate: current.startDate,
          endDate: current.endDate,
          // M15.2 — the visit §7.6 bound, if any. Null is the ordinary
          // case: a prescription written from the pharmacy screen
          // rather than from inside an encounter belongs to no record.
          recordId: current.recordId,
          instructions: current.instructions,
        }),
        warnings: outcome.warnings,
      };
    });

    const row = signed.row;

    // Lost the compare-and-set: a colleague signed this draft between
    // the read and the write.
    if (row === null) {
      throw AppException.conflict(
        'This prescription was signed by someone else while this request was in flight',
        'conflict',
      );
    }

    await this.audit.record({
      action: 'prescription.sign',
      actor: { userId: user.id, role: user.role },
      entityType: 'prescription',
      entityId: row.publicId,
      metadata: {
        status: prescriptionStatusToWire(row.status),
        medication: current.medication.name,
        warnings: signed.warnings.length,
        acknowledged: acknowledged.length,
        // The reason is stored on the warning rows; the audit entry
        // records that one was given, which is what a later review asks
        // first.
        acknowledgmentGiven: reason !== '',
      },
    });

    await this.activity.record({
      userId: user.id,
      // `profile` is the closest of the seven account-activity kinds, and
      // the one M12 uses for the same purpose. The detail carries the
      // reference and **not** the medication: the activity feed's own
      // rule is that a summary names what changed, never the clinical
      // value it changed to.
      kind: 'profile',
      summary: 'Signed a prescription',
      detail: row.publicId,
    });

    // After commit, never before (ADR-002 consequences, API §0.5).
    await this.outbox.publish({
      topic: 'prescription.prescribed',
      payload: {
        prescriptionId: row.publicId,
        patientId: current.patient.publicId,
        medication: current.medication.name,
        status: prescriptionStatusToWire(row.status),
      },
      dedupeKey: `prescription.prescribed:${row.publicId}:${signedAt.toISOString()}`,
    });

    return toPrescriptionDetailView(row, new Date());
  }

  /** API §7.3 — the prescriber's own list. */
  async list(
    user: AuthenticatedUser,
    query: PrescriptionListQuery,
  ): Promise<PaginatedPrescriptions> {
    const doctorId = await this.requireDoctor(user);

    const { rows, totalItems } = await this.prescriptions.list(
      doctorId,
      criteriaFor(query, query.page, query.pageSize),
    );

    const now = new Date();

    return {
      items: rows.map((row) => toPrescriptionView(row, now)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /**
   * API §7.10 — the prescriber's filtered list as a CSV file.
   *
   * `list`'s repository call with `list`'s criteria, so the file is the
   * prescriber's own list and nothing wider: the scope is `doctorId` in
   * the WHERE clause, exactly as the screen's. Audited once, after the
   * read, with the row count and the filter *names*.
   */
  async export(user: AuthenticatedUser, query: PrescriptionExportQuery): Promise<CsvFile> {
    const doctorId = await this.requireDoctor(user);

    const { rows, totalItems } = await this.prescriptions.list(
      doctorId,
      criteriaFor(query, 1, EXPORT_ROW_LIMIT),
    );

    if (totalItems > EXPORT_ROW_LIMIT) throw exportTooLarge(totalItems);

    const now = new Date();
    const body = toCsv(EXPORT_COLUMNS, rows.map((row) => toPrescriptionView(row, now)));

    await this.disclosures.record({
      action: 'prescription.export',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'prescription',
      entityId: 'export',
      metadata: { rowCount: rows.length, filters: appliedFilterNames(query), sort: query.sort },
    });

    return { fileName: csvFileName('prescriptions', now), body, rowCount: rows.length };
  }

  /**
   * API §7.9 — `/discontinue` and `/cancel`.
   *
   * **Both write `discontinued`** (ADR-002 §4): neither the coded enum
   * nor `PrescriptionTimelineKind` has a `cancelled` value, and
   * inventing one to match a UX badge would contradict rank-1 and rank-3
   * evidence. The distinction the two routes carry — cancelling an
   * unsent draft is not clinically the same act as stopping an active
   * therapy — is preserved in the **audit event and the timeline
   * detail**, which is exactly where ADR-002 §4 puts it.
   *
   * The reason is P4 and is not optional at any layer: the schema
   * refuses an empty one with a 422, and
   * `prescriptions_discontinued_reason_required` refuses the row.
   */
  async discontinue(
    user: AuthenticatedUser,
    publicId: string,
    input: DiscontinuePrescriptionInput,
    act: 'cancel' | 'discontinue',
  ): Promise<PrescriptionDetailView> {
    const doctorId = await this.requireDoctor(user);
    const current = await this.prescriptions.findForDoctor(doctorId, publicId);
    if (current === null) throw AppException.notFound('Prescription not found');

    await this.scope.assertCanReach(principalOf(user), current.patient.publicId);

    // 409 when it has already ended — the caller is permitted, the
    // prescription is not in a state that accepts the write.
    assertDiscontinuable(current.status);

    const row = await this.prescriptions.discontinue({
      prescriptionId: current.id,
      from: current.status,
      reason: input.reason,
      actorId: user.id,
      actorName: await this.actorName(user),
      act,
    });

    if (row === null) {
      throw AppException.conflict(
        'This prescription changed while the request was in flight',
        'conflict',
      );
    }

    await this.audit.record({
      action: act === 'cancel' ? 'prescription.cancel' : 'prescription.discontinue',
      actor: { userId: user.id, role: user.role },
      entityType: 'prescription',
      entityId: row.publicId,
      // The act and the reason, because the status column cannot hold
      // either: both routes write `discontinued`.
      metadata: { act, reason: input.reason, previousStatus: prescriptionStatusToWire(current.status) },
    });

    await this.outbox.publish({
      topic: 'prescription.discontinued',
      payload: { prescriptionId: row.publicId, patientId: current.patient.publicId, act },
      dedupeKey: `prescription.discontinued:${row.publicId}:${row.updatedAt.toISOString()}`,
    });

    return toPrescriptionDetailView(row, new Date());
  }

  /**
   * BR-DEC-002 (DEC-002), ADR-044 — discard an unsigned draft.
   *
   * `/cancel` and `/discontinue` refuse a draft (D-13.1), so before this a
   * draft a prescriber abandoned could only be left in their list. A draft
   * dispenses nothing and no one has attested it, so discarding it is a
   * soft delete: gone from every list and read, kept as a row for the
   * audit trail that names it.
   *
   * The prescriber only, by construction — `findForDoctor` scopes by
   * `prescribing_doctor_id`, so anyone else's draft is the same 404 as a
   * missing one. Anything past `draft` is **409 `prescription_not_draft`**:
   * a signed prescription is withdrawn through `/cancel` or `/discontinue`,
   * which keep the record a pharmacist may already have acted on.
   */
  async discard(user: AuthenticatedUser, publicId: string): Promise<void> {
    const doctorId = await this.requireDoctor(user);
    const current = await this.prescriptions.findForDoctor(doctorId, publicId);
    if (current === null) throw AppException.notFound('Prescription not found');

    await this.scope.assertCanReach(principalOf(user), current.patient.publicId);

    // The status check refuses the common case before any write; the
    // predicate in `discardDraft` refuses a signature that lands between.
    const discarded =
      current.status === 'DRAFT' && (await this.prescriptions.discardDraft(current.id, user.id));

    if (!discarded) {
      throw AppException.conflict(
        'Only an unsigned draft can be discarded. A signed prescription is withdrawn with ' +
          '/cancel or /discontinue.',
        'prescription_not_draft',
      );
    }

    await this.audit.record({
      action: 'prescription.discard',
      actor: { userId: user.id, role: user.role },
      entityType: 'prescription',
      entityId: current.publicId,
      metadata: { patientId: current.patient.publicId },
    });
  }

  /**
   * API §7.8 — renew: a pre-filled **new draft**, not a status change.
   *
   * A renewal is a second course of therapy. Collapsing it into the
   * first would lose which course was dispensed when, and would need a
   * terminal prescription to come back to life, which ADR-002 §3
   * forbids.
   *
   * What is copied is the *therapy* — patient, medication, strength,
   * dosage, frequency, route. What may be overridden is the *course* —
   * duration, quantity, refills, instructions, start date. Renewing with
   * an empty body means "the same again", which is the common case and
   * the reason the endpoint exists.
   *
   * The new draft is a draft: it has been prescribed by nobody and must
   * go through `/sign`, with the safety screen re-running against the
   * patient as they are **now**. A renewal that skipped the screen would
   * be the easiest way to re-prescribe a drug the patient has since
   * become allergic to.
   */
  async renew(
    user: AuthenticatedUser,
    publicId: string,
    input: RenewPrescriptionInput,
  ): Promise<PrescriptionDetailView> {
    const doctorId = await this.requireDoctor(user);
    const source = await this.prescriptions.findForDoctor(doctorId, publicId);
    if (source === null) throw AppException.notFound('Prescription not found');

    await this.scope.assertCanReach(principalOf(user), source.patient.publicId);

    // A draft is not a course that can be renewed — it was never
    // prescribed. Renewing one would produce a second draft identical to
    // the first, which is a copy button, not a renewal.
    if (source.status === 'DRAFT') {
      throw AppException.conflict(
        'A draft has not been prescribed, so there is nothing to renew',
        'invalid_status_transition',
      );
    }

    const refillsAllowed = input.refillsAllowed ?? source.refillsAllowed;

    // The rank-1 rule from `authoring.ts:213`, re-checked here because a
    // renewal can change the refill count without going through create.
    if (refillsAllowed > 0 && source.medication.isControlled) {
      throw AppException.validation(
        { refillsAllowed: ['A controlled medication cannot carry refills.'] },
        'A controlled medication cannot carry refills',
      );
    }

    const durationDays = input.durationDays ?? source.durationDays;
    const startDate = input.startDate ?? new Date();
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + durationDays);

    const row = await this.prescriptions.renew({
      sourceId: source.id,
      publicId: await this.prescriptions.nextReference(),
      durationDays,
      quantity: input.quantity ?? source.quantity,
      refillsAllowed,
      instructions: input.instructions ?? source.instructions,
      startDate,
      endDate,
      actorId: user.id,
      actorName: await this.actorName(user),
    });

    await this.audit.record({
      action: 'prescription.renew',
      actor: { userId: user.id, role: user.role },
      entityType: 'prescription',
      entityId: row.publicId,
      metadata: { renewedFrom: source.publicId, medication: source.medication.name },
    });

    return toPrescriptionDetailView(row, new Date());
  }

  /** API §7.10 — a note, and the `note-added` timeline entry. */
  async addNote(
    user: AuthenticatedUser,
    publicId: string,
    input: CreatePrescriptionNoteInput,
  ): Promise<PrescriptionDetailView> {
    const doctorId = await this.requireDoctor(user);
    const current = await this.prescriptions.findForDoctor(doctorId, publicId);
    if (current === null) throw AppException.notFound('Prescription not found');

    await this.scope.assertCanReach(principalOf(user), current.patient.publicId);

    const row = await this.prescriptions.addNote({
      prescriptionId: current.id,
      authorId: user.id,
      actorName: await this.actorName(user),
      body: input.body,
    });

    await this.audit.record({
      action: 'prescription.note',
      actor: { userId: user.id, role: user.role },
      entityType: 'prescription',
      entityId: row.publicId,
      // The note's text is not copied into the audit metadata: it is
      // clinical prose about a patient, and the row it lives on is
      // already the record.
      metadata: { length: input.body.length },
    });

    return toPrescriptionDetailView(row, new Date());
  }

  /** API §7.4 — the full document. */
  async detail(user: AuthenticatedUser, publicId: string): Promise<PrescriptionDetailView> {
    const doctorId = await this.requireDoctor(user);
    const row = await this.prescriptions.findForDoctor(doctorId, publicId);
    if (row === null) throw AppException.notFound('Prescription not found');

    await this.scope.assertCanReach(principalOf(user), row.patient.publicId);

    return toPrescriptionDetailView(row, new Date());
  }

  /**
   * The authoritative screen, and the one place
   * `safety_check_unavailable` is raised on a signature.
   *
   * Separated from `sign` so the fail-closed branch is one short
   * function that can be read in full: any failure of the source becomes
   * a 409 and the caller returns before touching the prescription.
   */
  private async screenForSigning(
    user: AuthenticatedUser,
    patientPublicId: string,
    current: { readonly id: string; readonly medication: { readonly id: string } },
    tx: Db,
  ): Promise<{ readonly warnings: readonly ScreenWarning[] }> {
    try {
      return await this.safety.screen(
        user,
        {
          patientId: patientPublicId,
          medicationId: current.medication.id,
          // Without this the draft would be screened against itself the
          // moment it becomes a row, and report duplicate therapy with
          // itself — refusing every signature.
          excludePrescriptionId: current.id,
        },
        tx,
      );
    } catch (error) {
      if (error instanceof InteractionSourceUnavailable) {
        // Fail closed. The prescription is untouched and stays `draft`,
        // which is the state RM M13.3's chaos test asserts.
        throw AppException.conflict(
          'The drug-interaction check could not run, so this prescription cannot be signed. ' +
            'It remains a draft.',
          'safety_check_unavailable',
          'Safety check unavailable',
        );
      }

      throw error;
    }
  }

  /**
   * API §7's summary cards — RM M27.4.
   *
   * "Today" is the request's UTC day, the same window the dashboard's KPI
   * block uses. The clinic's own timezone lives in M24's `localization`
   * slice and applying it here would mean deciding whether a doctor's
   * cards follow the clinic or the viewer — a product question no source
   * answers, and one this endpoint must not answer differently from the
   * dashboard it sits beside.
   */
  async summary(user: AuthenticatedUser, now = new Date()): Promise<PrescriptionSummaryView> {
    const doctorId = await this.requireDoctor(user);
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    return this.prescriptions.summaryFor(
      doctorId,
      dayStart,
      new Date(dayStart.getTime() + 24 * 60 * 60 * 1000),
    );
  }

  private async requireDoctor(user: AuthenticatedUser): Promise<string> {
    const doctorId = await this.prescriptions.doctorIdForUser(user.id);
    if (doctorId === null) throw AppException.notFound('No doctor profile for this account');

    return doctorId;
  }

  private async actorName(user: AuthenticatedUser): Promise<string> {
    return (await this.prescriptions.displayNameForUser(user.id)) ?? user.publicId;
  }
}

/** One translation of the wire filters, shared by the list and the export. */
function criteriaFor(
  query: PrescriptionExportQuery,
  page: number,
  pageSize: number,
): ListCriteria {
  return {
    q: query.q,
    status: query.status?.map((value) => PRESCRIPTION_STATUS_FROM_WIRE[value] as PrescriptionStatus),
    refillStatus: query.refillStatus?.map((value) => REFILL_STATUS_FROM_WIRE[value] as RefillStatus),
    patientId: query.patientId,
    medication: query.medication,
    department: query.department,
    warningSeverity:
      query.warningSeverity === undefined
        ? undefined
        : WARNING_SEVERITY_FROM_WIRE[query.warningSeverity],
    from: query.from,
    to: query.to,
    sort: query.sort,
    page,
    pageSize,
  };
}

/**
 * The list row, one line per prescription. Warnings are named with
 * their severity rather than counted: "2 warnings" on a printed list is
 * a reason to open the chart, not information.
 */
const EXPORT_COLUMNS: readonly CsvColumn<PrescriptionView>[] = [
  { header: 'prescriptionId', value: (row) => row.id },
  { header: 'createdAt', value: (row) => row.createdAt },
  { header: 'patientId', value: (row) => row.patient.id },
  { header: 'patientName', value: (row) => row.patient.name },
  { header: 'mrn', value: (row) => row.patient.mrn },
  { header: 'medication', value: (row) => row.medication.name },
  { header: 'strength', value: (row) => row.medication.strength },
  { header: 'dosage', value: (row) => row.dosage },
  { header: 'frequency', value: (row) => row.frequency },
  { header: 'route', value: (row) => row.route },
  { header: 'duration', value: (row) => row.duration },
  { header: 'quantity', value: (row) => row.quantity },
  { header: 'status', value: (row) => row.status },
  { header: 'startDate', value: (row) => row.startDate },
  { header: 'endDate', value: (row) => row.endDate },
  { header: 'refillsRemaining', value: (row) => row.refillsRemaining },
  { header: 'refillStatus', value: (row) => row.refillStatus },
  { header: 'prescribingDoctor', value: (row) => row.prescribingDoctor },
  {
    header: 'warnings',
    value: (row) => row.warnings.map((warning) => `${warning.severity}: ${warning.title}`).join('; '),
  },
  { header: 'signedAt', value: (row) => row.signedAt },
];

/** Wire severities and kinds back to the enum members the table stores. */
function toPersistable(warning: ScreenWarning): PersistableWarning {
  return {
    id: warning.id,
    kind: warning.kind.toUpperCase() as SafetyWarningKind,
    severity: warning.severity.toUpperCase() as SafetyWarningSeverity,
    title: warning.title,
    detail: warning.detail,
  };
}

export function toSafetyCheckView(
  warnings: readonly ScreenWarning[],
  blocking: boolean,
): SafetyCheckView {
  return {
    warnings: warnings.map(toWarningView),
    blocking,
    requiresAcknowledgment: warningsNeedingAcknowledgment(warnings).map((warning) => warning.id),
  };
}

function toWarningView(warning: ScreenWarning): SafetyWarningView {
  return {
    id: warning.id,
    kind: warning.kind,
    severity: warning.severity,
    title: warning.title,
    detail: warning.detail,
    against: warning.against,
    blocking: warning.blocking,
  };
}
