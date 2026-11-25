/**
 * The clinician's patient surface (RM M10 — API §4).
 *
 * ## Two audiences, two shapes, and the branch is at the top
 *
 * API §0.4: "admin patient projections are **masked** unless revealed".
 * A doctor with a care relationship sees identifiers in the clear
 * because they are treating this person; an administrator sees
 * `MaskedIdentity` until they elevate through the audited reveal of
 * M7.3.
 *
 * The branch is made once, from the principal, at the entry to each
 * read — never inside a projection function. A `masked: boolean`
 * threaded through the mappers would put the disclosure one forgotten
 * branch away, and `MaskedIdentity` exists precisely so that a handler
 * *cannot* return a clear value by omission.
 *
 * ## Every clinical read and write goes through `PatientScopeService`
 *
 * RM M7.2 states it as a standing obligation on M9–M14: "each new
 * clinical route must call `assertCanReach` rather than query a PHI
 * table directly". This module is the first to inherit it, and every
 * single-record path here calls it before touching a row.
 *
 * The **list** cannot: asking per row would be one query per patient, so
 * the care scope is a join in the repository (`careAssignments: { some:
 * { doctorId, revokedAt: null } }`). The two must agree, and they do
 * because they read the same table with the same predicate — a patient
 * absent from a doctor's list is a patient whose chart answers 404, and
 * the spec asserts exactly that pairing.
 *
 * ## Out of scope is 404, never 403
 *
 * `assertCanReach` throws a `Patient not found` that is byte-identical
 * to a genuinely missing record's. ADR-022: a 403 confirms the patient
 * exists, and walking `PT-1000`, `PT-1001`, … against a 403/404 split
 * would disclose the clinic's roster without opening a single chart.
 */

import { Inject, Injectable } from '@nestjs/common';

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
import type { Prisma } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import {
  AUDIT_DISPATCHER,
  TransactionalAuditWriter,
  type AuditDispatcher,
  MandatoryAuditWriter,
} from '../../../shared/audit';
import { PatientScopeService, principalOf, TenantContextResolver } from '../../../shared/authz';
import { isUniqueViolation, runAsSystem } from '../../../shared/database';
import { maskPatientIdentity, type MaskedIdentity } from '../../../shared/phi';
import { bloodTypeToWire, genderToWire } from '../dto/clinical-enums';
import {
  ALERT_SEVERITY_FROM_WIRE,
  ALLERGY_SEVERITY_FROM_WIRE,
  alertSeverityToWire,
  allergySeverityToWire,
  medicationStatusToWire,
  PATIENT_STATUS_FROM_WIRE,
  patientStatusToWire,
  RISK_LEVEL_FROM_WIRE,
  riskLevelToWire,
} from '../dto/patient-enums';
import {
  ageOn,
  type PatientAlertView,
  type PatientAllergyView,
  type PatientProfileBundle,
  type PatientView,
  type RevealedIdentity,
} from '../dto/patient.dto';
import type {
  CreateAlertInput,
  CreateAllergyInput,
  CreatePatientInput,
  PatientExportQuery,
  PatientListQuery,
  RevealIdentityInput,
  UpdateAlertInput,
  UpdateAllergyInput,
  UpdatePatientInput,
} from '../dto/patient.schema';
import {
  PatientRepository,
  type AlertRow,
  type AllergyRow,
  type PatientListCriteria,
  type PatientRow,
} from '../repositories/patient.repository';
import type { ChartScope } from '../repositories/patient-tabs.repository';

export interface PaginatedPatients<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class PatientService {
  constructor(
    /** Mandatory audit of disclosures: a failed write refuses the read (F-02). */
    private readonly disclosures: MandatoryAuditWriter,
    private readonly patients: PatientRepository,
    private readonly scope: PatientScopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    private readonly disclosureAudit: TransactionalAuditWriter,
    private readonly tenants: TenantContextResolver,
  ) {}

  /**
   * API §4.1.
   *
   * A doctor gets their own assigned patients in the clear; anyone else
   * holding `patients.view` gets the masked directory. The clear branch
   * is gated on there actually being a `doctors` row, not on the role
   * string — the same reasoning M9.4 gives, and it fails closed: an
   * account that claims the doctor role with no professional profile
   * gets the masked view rather than everyone's chart.
   */
  async list(
    user: AuthenticatedUser,
    query: PatientListQuery,
  ): Promise<PaginatedPatients<PatientView | MaskedIdentity>> {
    const care = await this.careOf(user);
    const clear = care !== null;
    const directory = care === null ? await this.directoryOf(user) : undefined;

    const { rows: found, totalItems } = await this.patients.list(
      care,
      criteriaFor(query, query.page, query.pageSize),
      directory,
    );
    const rows = care === null ? found : found.map((row) => atHospital(row, care.hospitalId));

    // The masked branch needs no appointment lookup — a masked row does
    // not carry `nextAppointment`, and a query for a field nobody will
    // see is a query worth not making.
    const nextByPatient = clear
      ? await this.patients.nextAppointments(rows.map((row) => row.id))
      : {};

    const now = new Date();

    return {
      items: rows.map((row) =>
        clear ? toView(row, nextByPatient[row.id] ?? null, now) : toMasked(row),
      ),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /**
   * API §4.10 — the filtered list as a CSV file.
   *
   * **The same scope and the same masking as the list**, because it is
   * the list: the repository call is `list`'s, with `list`'s criteria, so
   * a doctor exports exactly the patients their screen shows and an
   * administrator exports the masked directory. A second query path would
   * be a second place for the care scope to drift (M10's status note).
   *
   * **Audited once, after the read**, as `patient.export` with the row
   * count and the *names* of the filters applied — never their values.
   * `q` is a name or a phone number typed into a search box, and the
   * ledger keeps field names, not field values (`audit.types`). Bulk
   * export is the act an investigator of a leak looks for first, which is
   * why it is a `warning` in the taxonomy rather than an ordinary read.
   */
  async export(user: AuthenticatedUser, query: PatientExportQuery): Promise<CsvFile> {
    const care = await this.careOf(user);
    const clear = care !== null;
    const directory = care === null ? await this.directoryOf(user) : undefined;

    const { rows: found, totalItems } = await this.patients.list(
      care,
      criteriaFor(query, 1, EXPORT_ROW_LIMIT),
      directory,
    );
    const rows = care === null ? found : found.map((row) => atHospital(row, care.hospitalId));

    if (totalItems > EXPORT_ROW_LIMIT) throw exportTooLarge(totalItems);

    const now = new Date();
    let body: string;

    if (clear) {
      const nextByPatient = await this.patients.nextAppointments(rows.map((row) => row.id));
      body = toCsv(
        CLEAR_EXPORT_COLUMNS,
        rows.map((row) => toView(row, nextByPatient[row.id] ?? null, now)),
      );
    } else {
      body = toCsv(MASKED_EXPORT_COLUMNS, rows.map(toMasked));
    }

    await this.disclosures.record({
      action: 'patient.export',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'patient',
      entityId: 'export',
      metadata: {
        rowCount: rows.length,
        masked: !clear,
        filters: appliedFilterNames(query),
        sort: query.sort,
      },
    });

    return { fileName: csvFileName('patients', now), body, rowCount: rows.length };
  }

  /** API §4.3 — one patient, care-scoped for a doctor, masked for anyone else. */
  async detail(
    user: AuthenticatedUser,
    publicId: string,
  ): Promise<PatientView | MaskedIdentity> {
    const row = await this.patients.findByPublicId(publicId);
    // 404 **before** the scope check, and identical to it: a caller must
    // not be able to tell a chart they may not reach from one that does
    // not exist.
    if (row === null) throw notFound();

    if (user.role !== 'doctor') {
      // The masked directory's reach (F-08, OD-07): a patient holding a
      // record at the caller's hospital — the same 404 otherwise.
      const hospitalId = await this.directoryOf(user);
      if (hospitalId === null || !(await this.patients.hasRecordAt(row.id, hospitalId))) throw notFound();
      await this.recordPhiRead(user, row, 'patient.view_masked');
      return toMasked(row);
    }

    const reach = await this.scope.reachAt(principalOf(user), publicId);
    await this.recordPhiRead(user, row, 'patient.view');

    const next = await this.patients.nextAppointments([row.id]);

    return toView(atHospital(row, reach.hospitalId), next[row.id] ?? null, new Date());
  }

  /**
   * API §4.9 — unmask a patient's identity, atomically audit-logged
   * (RM M7.3).
   *
   * ## Atomic means the identity cannot leave without its row
   *
   * The identifiers are read on the same transaction as the audit insert,
   * and the insert goes through `TransactionalAuditWriter`, which throws.
   * A ledger that cannot take the row turns the reveal into a 503
   * `audit_unavailable` with nothing disclosed — the opposite of the
   * best-effort dispatcher every other read here uses, and on purpose: a
   * reveal is the one read whose *only* safeguard is that it is recorded.
   *
   * ## The capability is not a care relationship
   *
   * `patients.revealIdentity` is seeded on the doctor row as well as the
   * admin row. For an administrator it is the elevation the masked
   * directory points at. For a doctor it must not become a way round
   * M7.2: a doctor reaches only their own patients, so the scope check
   * runs first and a stranger's chart is the same 404 as a missing one.
   *
   * ## What the ledger keeps
   *
   * The category, never the free-text reason. ADM-10 made the same call
   * for its own log (`logs.ts`, `fromPhiAccess`): the reason is typed by
   * an administrator at reveal time and is the one field on this path that
   * can contain the patient's name, which would put the identity the
   * reveal is about into a ledger that masks it everywhere else. The
   * reason is still required — the reveal does not happen without one.
   */
  async revealIdentity(
    user: AuthenticatedUser,
    publicId: string,
    input: RevealIdentityInput,
  ): Promise<RevealedIdentity> {
    if (user.role === 'doctor') {
      await this.scope.assertCanReach(principalOf(user), publicId);
    }

    const revealedAt = new Date();

    const row = await this.patients.revealWithin(publicId, (tx, found) =>
      this.disclosureAudit.recordWithin(tx, {
        action: 'patient_identity.reveal',
        actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
        entityType: 'patient',
        entityId: found.publicId,
        occurredAt: revealedAt,
        metadata: { category: input.category },
      }),
    );

    if (row === null) throw notFound();

    return {
      patientId: row.publicId,
      fullName: row.fullName,
      mrn: row.mrn,
      ...(row.email === null ? {} : { email: row.email }),
      phone: row.phone,
      dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
      revealed: true,
      revealedAt: revealedAt.toISOString(),
    };
  }

  /** API §4.4 — the profile bundle the chart screen loads first. */
  async profile(user: AuthenticatedUser, publicId: string): Promise<PatientProfileBundle> {
    const row = await this.requireReachable(user, publicId);

    const [bundle, next] = await Promise.all([
      this.patients.bundleFor(row.chart),
      this.patients.nextAppointments([row.id]),
    ]);

    await this.recordPhiRead(user, row, 'patient.profile_view');

    return {
      patient: toView(row, next[row.id] ?? null, new Date()),
      latestVitals:
        bundle.latestVitals === null
          ? null
          : {
              recordedAt: bundle.latestVitals.recordedAt.toISOString(),
              // Two columns, two fields (API §4.6's "systolic/diastolic
              // split"): `"120/80"` is a value nobody can chart or flag.
              systolic: bundle.latestVitals.bloodPressureSystolic,
              diastolic: bundle.latestVitals.bloodPressureDiastolic,
              heartRate: bundle.latestVitals.heartRateBpm,
              temperatureC: Number(bundle.latestVitals.temperatureC),
              respiratoryRate: bundle.latestVitals.respiratoryRate,
              oxygenSaturation: bundle.latestVitals.oxygenSaturation,
              weightKg: Number(bundle.latestVitals.weightKg),
              heightCm: Number(bundle.latestVitals.heightCm),
              bmi: bundle.latestVitals.bmi === null ? null : Number(bundle.latestVitals.bmi),
            },
      medications: bundle.medications.map((medication) => ({
        id: medication.id,
        name: medication.name,
        dosage: medication.dosage,
        frequency: medication.frequency,
        status: medicationStatusToWire(medication.status),
        startDate: medication.startDate.toISOString().slice(0, 10),
        endDate: medication.endDate?.toISOString().slice(0, 10) ?? null,
        prescriptionId: medication.prescription?.publicId ?? null,
      })),
      chronicConditions: bundle.conditions,
      emergencyContacts: bundle.emergencyContacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        relationship: contact.relationship,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
      })),
      clinicalAlerts: bundle.alerts.map(toAlertView),
    };
  }

  /**
   * API §4.2 — register a patient.
   *
   * Generates the `PT-…` handle from a sequence and the MRN at random,
   * and the difference is the point: the handle is quoted aloud and is
   * never masked, so an MRN derivable from it would make `maskMrn`'s
   * last-4 protect nothing.
   */
  async create(user: AuthenticatedUser, input: CreatePatientInput): Promise<PatientView> {
    const employment = await this.patients.clinicalEmploymentForUser(user.id);
    // A patient must be registered *by* a practitioner employed at a
    // hospital, because registration opens the Hospital Medical Record
    // that makes the chart reachable there (DR-05). An account with no
    // `doctors` row, or no active employment, has nowhere to record it.
    if (employment === null) {
      throw AppException.forbidden('Only a practitioner can register a patient');
    }
    const { doctorId } = employment;

    const { ids, unknown } = await this.patients.conditionIdsByName(input.chronicConditions);
    if (unknown.length > 0) {
      // ADR-004 makes `chronic_conditions` the single source. A free-text
      // condition cannot be matched by the safety screen or the filters,
      // so it is rejected rather than stored as an orphan string.
      throw AppException.validation(
        { chronicConditions: [`Unknown condition(s): ${unknown.join(', ')}`] },
        'Unknown chronic condition',
      );
    }

    const sequence = await this.patients.nextIdentitySequence();
    const publicId = `PT-${String(sequence)}`;

    const row = await this.createWithUniqueMrn(
      {
        publicId,
        input,
        doctorId,
        hospitalId: employment.hospitalId,
        doctorEmploymentId: employment.employmentId,
        actorId: user.id,
        conditionIds: ids,
      },
      // L1: the registration is the moment the patient comes to belong to
      // this hospital (its Hospital Medical Record and care assignment). The
      // audit row is that ownership's evidence, so it is written in the same
      // transaction, through the throwing writer: no chart without its row,
      // no row without its chart.
      (tx) =>
        this.disclosures.recordIn(tx, {
          action: 'patient.create',
          actor: { userId: user.id, role: user.role },
          entityType: 'patient',
          entityId: publicId,
          hospitalId: employment.hospitalId,
          // Counts and flags, never the name, the MRN or the birth date —
          // `AuditMetadata` forbids clinical values and these are the
          // identifiers the whole masking apparatus exists to protect.
          metadata: {
            allergies: input.allergies.length,
            chronicConditions: ids.length,
            hasEmail: input.email !== undefined,
            medicalRecordOpened: true,
            careAssignment: 'primary',
          },
        }),
    );

    await this.activity.record({
      userId: user.id,
      kind: 'profile',
      summary: 'Registered a patient',
      detail: row.publicId,
    });

    return toView(row, null, new Date());
  }

  /** API §4.8 — status, risk level and contact details. */
  async update(
    user: AuthenticatedUser,
    publicId: string,
    input: UpdatePatientInput,
  ): Promise<PatientView> {
    const row = await this.requireReachable(user, publicId);

    const updated = await this.patients.update(row.id, user.id, {
      status: input.status === undefined ? undefined : PATIENT_STATUS_FROM_WIRE[input.status],
      riskLevel:
        input.riskLevel === undefined ? undefined : RISK_LEVEL_FROM_WIRE[input.riskLevel],
      phone: input.phone,
      email: input.email,
      address: input.address,
      medicalNotes: input.medicalNotes,
    });

    await this.audit.record({
      action: 'patient.update',
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      metadata: {
        fields: Object.keys(input).sort().join(','),
        // Status and risk level are clinical *classifications* rather
        // than clinical content, and an investigation into why a chart
        // was marked critical needs both sides of the change.
        ...(input.status === undefined
          ? {}
          : { statusBefore: patientStatusToWire(row.status), statusAfter: input.status }),
        ...(input.riskLevel === undefined
          ? {}
          : { riskBefore: riskLevelToWire(row.riskLevel), riskAfter: input.riskLevel }),
      },
    });

    const next = await this.patients.nextAppointments([row.id]);

    return toView(updated, next[row.id] ?? null, new Date());
  }

  /** API §4: "patient deletion does not exist" — deactivate only. */
  async deactivate(user: AuthenticatedUser, publicId: string): Promise<void> {
    const row = await this.requireReachable(user, publicId);

    await this.patients.deactivate(row.id, user.id);

    await this.audit.record({
      action: 'patient.deactivate',
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      metadata: { softDeleted: true },
    });
  }

  /** API §4.6 — the allergy list that feeds the fixed safety strip. */
  async allergies(
    user: AuthenticatedUser,
    publicId: string,
  ): Promise<readonly PatientAllergyView[]> {
    const row = await this.requireReachable(user, publicId);
    return row.allergies.map(toAllergyView);
  }

  async addAllergy(
    user: AuthenticatedUser,
    publicId: string,
    input: CreateAllergyInput,
  ): Promise<PatientAllergyView> {
    const row = await this.requireReachable(user, publicId);

    let created: AllergyRow;
    try {
      created = await this.patients.createAllergy({
        scope: row.chart,
        actorId: user.id,
        allergen: input.allergen,
        severity: ALLERGY_SEVERITY_FROM_WIRE[input.severity] ?? 'MILD',
        reaction: input.reaction,
        notes: input.notes,
      });
    } catch (error) {
      // `@@unique([patientId, allergen])`. Two rows for one allergen
      // would let a chart say both "severe" and "mild" about the same
      // substance, which is the worst possible answer for the safety
      // screen to have to choose between.
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'That allergen is already recorded for this patient',
          'conflict',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'patient.allergy_add',
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      // The severity is what makes this safety-critical and is a
      // category rather than content; the allergen itself is clinical
      // data and stays out of the ledger.
      metadata: { severity: input.severity },
    });

    return toAllergyView(created);
  }

  async updateAllergy(
    user: AuthenticatedUser,
    publicId: string,
    allergyId: string,
    input: UpdateAllergyInput,
  ): Promise<PatientAllergyView> {
    const row = await this.requireReachable(user, publicId);

    const updated = await this.patients.updateAllergy(row.chart, allergyId, user.id, {
      allergen: input.allergen,
      severity:
        input.severity === undefined ? undefined : ALLERGY_SEVERITY_FROM_WIRE[input.severity],
      reaction: input.reaction,
      notes: input.notes,
    });

    if (updated === null) throw AppException.notFound('Allergy not found');

    await this.audit.record({
      action: 'patient.allergy_update',
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      metadata: { allergyId, fields: Object.keys(input).sort().join(',') },
    });

    return toAllergyView(updated);
  }

  async removeAllergy(
    user: AuthenticatedUser,
    publicId: string,
    allergyId: string,
  ): Promise<void> {
    const row = await this.requireReachable(user, publicId);

    const removed = await this.patients.removeAllergy(row.chart, allergyId, user.id);
    if (removed === 0) throw AppException.notFound('Allergy not found');

    // Removing an allergy narrows what the prescription safety screen
    // will block, so it is the write on this surface most worth being
    // able to reconstruct later.
    await this.audit.record({
      action: 'patient.allergy_remove',
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      metadata: { allergyId, softDeleted: true },
    });
  }

  /** API §4.5 — clinical alerts (M10.5). */
  async alerts(
    user: AuthenticatedUser,
    publicId: string,
    activeOnly: boolean,
  ): Promise<readonly PatientAlertView[]> {
    const row = await this.requireReachable(user, publicId);
    return (await this.patients.alerts(row.chart, activeOnly)).map(toAlertView);
  }

  async addAlert(
    user: AuthenticatedUser,
    publicId: string,
    input: CreateAlertInput,
  ): Promise<PatientAlertView> {
    const row = await this.requireReachable(user, publicId);

    const created = await this.patients.createAlert({
      scope: row.chart,
      actorId: user.id,
      severity: ALERT_SEVERITY_FROM_WIRE[input.severity] ?? 'WARNING',
      message: input.message,
    });

    await this.audit.record({
      action: 'patient.alert_add',
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      metadata: { severity: input.severity },
    });

    return toAlertView(created);
  }

  async updateAlert(
    user: AuthenticatedUser,
    publicId: string,
    alertId: string,
    input: UpdateAlertInput,
  ): Promise<PatientAlertView> {
    const row = await this.requireReachable(user, publicId);

    const updated = await this.patients.updateAlert(row.chart, alertId, user.id, {
      severity:
        input.severity === undefined ? undefined : ALERT_SEVERITY_FROM_WIRE[input.severity],
      message: input.message,
      active: input.active,
      reason: input.reason,
    });

    if (updated === null) throw AppException.notFound('Alert not found');

    await this.audit.record({
      action: 'patient.alert_update',
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: publicId,
      metadata: { alertId, fields: Object.keys(input).sort().join(',') },
    });

    return toAlertView(updated);
  }

  /**
   * The masked directory's reach (F-08), from the caller's own staffing: a
   * Hospital Admin's or a staff member's is the patients holding a record at
   * their hospital; anyone else — a Platform Admin (OD-07), an administrator
   * without a scope, a doctor without standing — gets none at all (`null`).
   */
  private async directoryOf(user: AuthenticatedUser): Promise<string | null> {
    const tenant = await runAsSystem(() => this.tenants.resolve(user));
    // A Platform Admin holds no clinical access (OD-07, §2.1): no patient
    // directory, masked or not — as Row-Level Security has it too.
    if (tenant?.scope === 'hospital' && tenant.hospitalId !== undefined) return tenant.hospitalId;
    return null;
  }

  /**
   * A doctor's list scope: their doctor row and their one clinical hospital
   * (F-01). A doctor without unambiguous clinical standing has no clear
   * list — they get the masked directory every other role gets, never an
   * unscoped one.
   */
  private async careOf(
    user: AuthenticatedUser,
  ): Promise<{ readonly doctorId: string; readonly hospitalId: string } | null> {
    if (user.role !== 'doctor') return null;
    const [doctorId, hospitalId] = await Promise.all([
      this.patients.doctorIdForUser(user.id),
      this.scope.clinicalHospitalOf(principalOf(user)),
    ]);
    return doctorId === null || hospitalId === null ? null : { doctorId, hospitalId };
  }

  /**
   * The chart, or a 404 that does not say which kind of 404 it is.
   *
   * Every clinical read and write on this surface starts here, which is
   * how M7.2's standing obligation — "each new clinical route must call
   * `assertCanReach`" — is kept by construction rather than by review.
   */
  private async requireReachable(
    user: AuthenticatedUser,
    publicId: string,
  ): Promise<PatientRow & { readonly chart: ChartScope }> {
    const row = await this.patients.findByPublicId(publicId);
    if (row === null) throw notFound();

    // DR-05 at resource level (F-01): the chart is the patient's record at
    // the doctor's hospital — its rows only, and its stamp on every write.
    const reach = await this.scope.reachAt(principalOf(user), publicId);
    const chart: ChartScope = {
      patientId: row.id,
      hospitalId: reach.hospitalId,
      hospitalMedicalRecordId: reach.hospitalMedicalRecordId,
    };

    return { ...atHospital(row, reach.hospitalId), chart };
  }

  /**
   * Records that PHI was read (API §14, MG §6.4).
   *
   * A *read* of a chart is an audited event in this platform, not only a
   * write — which is the difference between a clinical audit trail and
   * an application changelog. The entity id is the `PT-…` handle and
   * nothing else crosses.
   */
  private async recordPhiRead(
    user: AuthenticatedUser,
    row: PatientRow,
    action: string,
  ): Promise<void> {
    await this.disclosures.record({
      action,
      actor: { userId: user.id, role: user.role },
      entityType: 'patient',
      entityId: row.publicId,
      metadata: { masked: action.endsWith('_masked') },
    });
  }

  /**
   * Creates the chart, retrying on an MRN collision.
   *
   * The MRN is six random digits, so collisions are rare and inevitable
   * — the UNIQUE index is the guarantee and this is the recovery. Three
   * attempts: at a clinic's scale the probability of three consecutive
   * collisions is negligible, and looping forever on a genuinely
   * exhausted space would hang the request instead of reporting it.
   */
  private async createWithUniqueMrn(
    input: {
      readonly publicId: string;
      readonly input: CreatePatientInput;
      readonly doctorId: string;
      readonly hospitalId: string;
      readonly doctorEmploymentId: string;
      readonly actorId: string;
      readonly conditionIds: readonly string[];
    },
    onCreated: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<PatientRow> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.patients.create({
          publicId: input.publicId,
          mrn: generateMrn(),
          fullName: input.input.fullName,
          dateOfBirth: new Date(`${input.input.dateOfBirth}T00:00:00Z`),
          gender: input.input.gender === 'male' ? 'MALE' : 'FEMALE',
          bloodType: BLOOD_TYPE_FROM_WIRE[input.input.bloodType] ?? 'O_POSITIVE',
          phone: input.input.phone,
          email: input.input.email,
          address: input.input.address,
          medicalNotes: input.input.medicalNotes,
          doctorId: input.doctorId,
          hospitalId: input.hospitalId,
          doctorEmploymentId: input.doctorEmploymentId,
          actorId: input.actorId,
          allergies: input.input.allergies.map((allergy) => ({
            allergen: allergy.allergen,
            severity: ALLERGY_SEVERITY_FROM_WIRE[allergy.severity] ?? 'MILD',
            reaction: allergy.reaction,
            notes: allergy.notes,
          })),
          conditionIds: input.conditionIds,
        }, onCreated);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) throw error;
      }
    }

    // Unreachable: the loop either returns or rethrows on its last pass.
    throw AppException.conflict('Could not allocate a medical record number');
  }
}

/** 404 with no patient id in it (MG §11.6 forbids PHI in error messages). */
function notFound(): AppException {
  return AppException.notFound('Patient not found');
}

/**
 * Six random digits as `NNNN-NN`, matching the seeded format.
 *
 * Random rather than sequential, and that is the whole design: an
 * administrator sees the MRN masked to its last four digits, and an MRN
 * derivable from the never-masked `PT-…` handle would make that mask
 * protect nothing.
 */
function generateMrn(): string {
  const value = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');

  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

/**
 * The repository criteria for a list or an export. One translation of
 * the wire filters, so the export cannot respect a filter differently
 * from the screen it was taken from.
 */
function criteriaFor(
  query: PatientExportQuery,
  page: number,
  pageSize: number,
): PatientListCriteria {
  return {
    q: query.q,
    scope: query.scope,
    status: query.status === undefined ? undefined : PATIENT_STATUS_FROM_WIRE[query.status],
    gender: query.gender === undefined ? undefined : query.gender === 'male' ? 'MALE' : 'FEMALE',
    riskLevel: query.riskLevel === undefined ? undefined : RISK_LEVEL_FROM_WIRE[query.riskLevel],
    condition: query.condition,
    ageMin: query.ageMin,
    ageMax: query.ageMax,
    lastVisitFrom: query.lastVisitFrom === undefined ? undefined : new Date(query.lastVisitFrom),
    lastVisitTo: query.lastVisitTo === undefined ? undefined : new Date(query.lastVisitTo),
    hasUpcoming: query.hasUpcoming,
    sort: query.sort,
    page,
    pageSize,
  };
}

/**
 * The clinician's export: the list row's identity and status columns.
 * Allergies are named rather than counted, because a list of patients
 * with "severe allergy: yes" and no allergen is a list nobody can act on.
 */
const CLEAR_EXPORT_COLUMNS: readonly CsvColumn<PatientView>[] = [
  { header: 'patientId', value: (row) => row.id },
  { header: 'mrn', value: (row) => row.mrn },
  { header: 'fullName', value: (row) => row.fullName },
  { header: 'dateOfBirth', value: (row) => row.dateOfBirth },
  { header: 'age', value: (row) => row.age },
  { header: 'gender', value: (row) => row.gender },
  { header: 'bloodType', value: (row) => row.bloodType },
  { header: 'phone', value: (row) => row.phone },
  { header: 'email', value: (row) => row.email },
  { header: 'status', value: (row) => row.status },
  { header: 'riskLevel', value: (row) => row.riskLevel },
  { header: 'hasSevereAllergy', value: (row) => row.hasSevereAllergy },
  {
    header: 'allergies',
    value: (row) => row.allergies.map((allergy) => `${allergy.allergen} (${allergy.severity})`).join('; '),
  },
  { header: 'registeredAt', value: (row) => row.registeredAt },
  { header: 'lastVisit', value: (row) => row.lastVisit },
  { header: 'nextAppointment', value: (row) => row.nextAppointment },
  { header: 'assignedDoctor', value: (row) => row.assignedDoctor?.fullName ?? null },
];

/** The administrator's export: `MaskedIdentity`, field for field. */
const MASKED_EXPORT_COLUMNS: readonly CsvColumn<MaskedIdentity>[] = [
  { header: 'patientId', value: (row) => row.patientId },
  { header: 'name', value: (row) => row.name },
  { header: 'mrn', value: (row) => row.mrn },
  { header: 'email', value: (row) => row.email },
  { header: 'phone', value: (row) => row.phone },
  { header: 'dateOfBirth', value: (row) => row.dateOfBirth },
];

function toView(row: PatientRow, nextAppointment: Date | null, now: Date): PatientView {
  const allergies = row.allergies.map(toAllergyView);

  return {
    id: row.publicId,
    mrn: row.mrn,
    fullName: row.fullName,
    // A `date` column: a full ISO timestamp would invite a client to
    // apply its own zone to a birthday and shift it by a day.
    dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
    age: ageOn(row.dateOfBirth, now),
    gender: genderToWire(row.gender),
    bloodType: bloodTypeToWire(row.bloodType),
    phone: row.phone,
    email: row.email,
    address: row.address,
    photoUrl: row.photoUrl,
    status: patientStatusToWire(row.status),
    riskLevel: riskLevelToWire(row.riskLevel),
    registeredAt: row.registeredAt.toISOString(),
    lastVisit: row.lastVisitAt?.toISOString() ?? null,
    nextAppointment: nextAppointment?.toISOString() ?? null,
    assignedDoctor:
      row.assignedDoctor === null
        ? null
        : {
            id: row.assignedDoctor.id,
            fullName: row.assignedDoctor.fullName,
            specialty: row.assignedDoctor.specialty,
          },
    allergies,
    // Derived, never stored: a cached flag that disagreed with the
    // allergy list is a patient-safety failure rather than a stale cache.
    hasSevereAllergy: allergies.some((allergy) => allergy.severity === 'severe'),
    // A boolean, never the `usr_…` handle: which account a patient signs
    // in as is not a clinical fact and has no place on a chart.
    hasPortalAccount: row.userId !== null,
  };
}

/**
 * The administrator's projection.
 *
 * `maskPatientIdentity` is the only way this shape is built, and
 * `MaskedIdentity` has no field that can hold a clear value — so a
 * handler cannot leak an identifier by forgetting to mask one.
 */
function toMasked(row: PatientRow): MaskedIdentity {
  return maskPatientIdentity({
    patientId: row.publicId,
    fullName: row.fullName,
    mrn: row.mrn,
    ...(row.email === null ? {} : { email: row.email }),
    phone: row.phone,
    dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
  });
}

function toAllergyView(row: AllergyRow): PatientAllergyView {
  return {
    id: row.id,
    allergen: row.allergen,
    severity: allergySeverityToWire(row.severity),
    reaction: row.reaction,
    notes: row.notes,
    recordedAt: row.recordedAt.toISOString(),
    recordedBy: row.recorder?.publicId ?? null,
  };
}

function toAlertView(row: AlertRow): PatientAlertView {
  return {
    id: row.id,
    severity: alertSeverityToWire(row.severity),
    message: row.message,
    active: row.active,
    resolutionReason: row.resolutionReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Wire value → Prisma member. `O+` is `O_POSITIVE`; nothing mechanical works. */
const BLOOD_TYPE_FROM_WIRE: Readonly<Record<string, PatientRow['bloodType']>> = {
  'A+': 'A_POSITIVE',
  'A-': 'A_NEGATIVE',
  'B+': 'B_POSITIVE',
  'B-': 'B_NEGATIVE',
  'AB+': 'AB_POSITIVE',
  'AB-': 'AB_NEGATIVE',
  'O+': 'O_POSITIVE',
  'O-': 'O_NEGATIVE',
};

/** The chart as one hospital sees it: its own allergy rows only (F-01). */
function atHospital<T extends PatientRow>(row: T, hospitalId: string): T {
  return { ...row, allergies: row.allergies.filter((allergy) => allergy.hospitalId === hospitalId) };
}
