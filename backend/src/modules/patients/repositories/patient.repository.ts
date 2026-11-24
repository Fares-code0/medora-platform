/**
 * Patient reads and writes (RM M10 — API §4, DB §B3–B14).
 *
 * ## Care scoping is a WHERE clause here, and a guard above
 *
 * `PatientScopeService` answers "may this doctor reach this patient" for
 * a **single** record. A list cannot be served that way — asking it per
 * row would be one query per patient — so the list takes a
 * `doctorId` and joins `patient_doctor_assignments` with `revoked_at IS
 * NULL`. The two must agree, and they do because they read the same
 * table with the same predicate; `patient-api.e2e-spec.ts`-style tests
 * assert a doctor's list and their per-record access match.
 *
 * A caller that passes no `doctorId` gets the unscoped set. That path
 * exists for the administrator's masked directory (API §4.11) and for
 * nothing else, which is why the parameter is required and explicitly
 * nullable rather than optional — "I forgot to scope" and "this is
 * deliberately unscoped" must not look the same at the call site.
 *
 * ## Identifier auto-detect
 *
 * API §4.1 wants one `q` to find a name, a `PT-…` handle, a phone number
 * or an MRN. The shape of the input decides: `PT-` prefix → public id,
 * mostly digits and separators → phone, a digit-and-dash pattern → MRN,
 * anything else → name. All four are trigram-indexed
 * (`patients_full_name_trgm_idx` and its siblings), so the fallback of
 * trying several is a few index probes rather than a scan.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type {
  AlertSeverity,
  AllergySeverity,
  BloodType,
  Gender,
  PatientStatus,
  RiskLevel,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appointment statuses that count as "upcoming" for the derived field. */
const LIVE_APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'PENDING',
  'AWAITING_PATIENT',
] as const;

const ALLERGY_SELECT = {
  id: true,
  // The owning hospital, so a doctor's view keeps only its own (S3, #17).
  hospitalId: true,
  allergen: true,
  severity: true,
  reaction: true,
  notes: true,
  recordedAt: true,
  recorder: { select: { publicId: true } },
} as const;

/** Exactly the identifiers `MaskedIdentity` hides — and nothing clinical. */
const REVEAL_SELECT = {
  publicId: true,
  fullName: true,
  mrn: true,
  email: true,
  phone: true,
  dateOfBirth: true,
} as const;

export type RevealRow = Prisma.PatientGetPayload<{ select: typeof REVEAL_SELECT }>;

const PATIENT_SELECT = {
  id: true,
  publicId: true,
  mrn: true,
  fullName: true,
  dateOfBirth: true,
  gender: true,
  bloodType: true,
  phone: true,
  email: true,
  address: true,
  photoUrl: true,
  status: true,
  riskLevel: true,
  registeredAt: true,
  lastVisitAt: true,
  userId: true,
  assignedDoctor: { select: { id: true, fullName: true, specialty: true } },
  // `deletedAt: null` is stated explicitly, and it is not redundant. The
  // soft-delete extension rewrites the **top-level** `where` of an
  // operation and nothing else, so a relation pulled through a `select`
  // comes back unfiltered — a withdrawn allergy would keep appearing on
  // the chart and in `hasSevereAllergy`. See `shared/database/soft-delete.ts`.
  allergies: {
    where: { deletedAt: null },
    select: ALLERGY_SELECT,
    orderBy: { recordedAt: 'desc' },
  },
} as const;

export type PatientRow = Prisma.PatientGetPayload<{ select: typeof PATIENT_SELECT }>;
export type AllergyRow = Prisma.PatientAllergyGetPayload<{ select: typeof ALLERGY_SELECT }>;

const ALERT_SELECT = {
  id: true,
  severity: true,
  message: true,
  active: true,
  resolutionReason: true,
  createdAt: true,
} as const;

export type AlertRow = Prisma.PatientClinicalAlertGetPayload<{ select: typeof ALERT_SELECT }>;

export interface PatientListCriteria {
  readonly q?: string | undefined;
  readonly scope?: 'name' | 'id' | 'phone' | 'mrn' | undefined;
  readonly status?: PatientStatus | undefined;
  readonly gender?: Gender | undefined;
  readonly riskLevel?: RiskLevel | undefined;
  readonly condition?: string | undefined;
  readonly ageMin?: number | undefined;
  readonly ageMax?: number | undefined;
  readonly lastVisitFrom?: Date | undefined;
  readonly lastVisitTo?: Date | undefined;
  readonly hasUpcoming?: boolean | undefined;
  readonly sort: 'name:asc' | 'name:desc' | 'lastVisit:desc' | 'lastVisit:asc' | 'registered:desc';
  readonly page: number;
  readonly pageSize: number;
}

/** The doctor's clinical employment, from `PatientScopeService` (S3/S4). */
export interface DoctorListScope {
  readonly doctorId: string;
  readonly doctorEmploymentId: string;
  readonly hospitalId: string;
}

/** The reachable chart, from `PatientScopeService.assertCanReach`. */
export interface ChartScope {
  /** `patients.id` (uuid). */
  readonly patientId: string;
  readonly hospitalId: string;
  readonly hospitalMedicalRecordId: string;
}

/** Read filter: this patient's rows owned by the active hospital only. */
function owned(scope: ChartScope): { patientId: string; hospitalId: string } {
  return { patientId: scope.patientId, hospitalId: scope.hospitalId };
}

/** Write stamp: the patient, the active hospital and its medical record. */
function stamp(scope: ChartScope): ChartScope {
  return {
    patientId: scope.patientId,
    hospitalId: scope.hospitalId,
    hospitalMedicalRecordId: scope.hospitalMedicalRecordId,
  };
}

@Injectable()
export class PatientRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A page of patients.
   *
   * `doctor` is the care scope: it restricts the set to the live
   * assignments owned by the doctor's active employment at the active
   * hospital (S3/S4; legacy assignments with no hospital never count, #17).
   * `null` is the deliberately unscoped administrator directory. Required
   * and nullable rather than optional, so a forgotten argument is a compile
   * error rather than a disclosure.
   */
  async list(
    doctor: DoctorListScope | null,
    criteria: PatientListCriteria,
  ): Promise<{ rows: readonly PatientRow[]; totalItems: number }> {
    const where = this.whereFor(doctor, criteria);

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.patient.findMany({
        where,
        select: PATIENT_SELECT,
        orderBy: orderFor(criteria.sort),
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.patient.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** One patient by the `PT-…` handle. Care scoping is the caller's. */
  findByPublicId(publicId: string): Promise<PatientRow | null> {
    return this.prisma.db.patient.findFirst({
      where: { publicId },
      select: PATIENT_SELECT,
    });
  }

  /**
   * The clear identity for an audited reveal (API §4.9, RM M7.3), read on
   * the same transaction as the audit row `record` writes.
   *
   * `record` runs only when the patient exists — revealing nothing is not
   * an event — and the identity leaves this method only if it resolved.
   * If it throws, the transaction rolls back and so does the read: the
   * caller never holds an identity whose disclosure is not on the ledger.
   */
  revealWithin(
    publicId: string,
    record: (tx: Prisma.TransactionClient, row: RevealRow) => Promise<void>,
  ): Promise<RevealRow | null> {
    return this.prisma.$transaction(async (tx) => {
      // `tx` is the raw client, not `prisma.db`, so the soft-delete
      // filter `findByPublicId` gets from the M4.2 extension is stated
      // here: a deactivated chart answers 404 on both paths.
      const row = await tx.patient.findFirst({
        where: { publicId, deletedAt: null },
        select: REVEAL_SELECT,
      });
      if (row === null) return null;

      await record(tx, row);

      return row;
    });
  }

  /**
   * The next live appointment per patient — the derived `nextAppointment`
   * (M10.6).
   *
   * One `groupBy` for the whole page rather than a query per row. The
   * minimum `starts_at` over live statuses from now on *is* the next
   * appointment, so the aggregate answers it directly and
   * `@@index([patientId])` on `appointments` serves it.
   */
  async nextAppointments(
    patientIds: readonly string[],
    hospitalId: string,
  ): Promise<Readonly<Record<string, Date>>> {
    if (patientIds.length === 0) return {};

    const rows = await this.prisma.db.appointment.groupBy({
      by: ['patientId'],
      where: {
        patientId: { in: [...patientIds] },
        // Only the active hospital's book (S3): another hospital's, or an
        // unowned legacy appointment (#17), is not this chart's.
        hospitalId,
        startsAt: { gte: new Date() },
        status: { in: [...LIVE_APPOINTMENT_STATUSES] },
      },
      _min: { startsAt: true },
    });

    const next: Record<string, Date> = {};
    for (const row of rows) {
      if (row._min.startsAt !== null) next[row.patientId] = row._min.startsAt;
    }

    return next;
  }

  /**
   * Creates the chart, its allergies and its conditions, and assigns the
   * creating doctor — all in one transaction.
   *
   * Since S4 the chart is opened **at the doctor's active hospital**: the
   * patient's hospital medical record there is created (OD-09: on the first
   * real interaction), and the allergies and the care assignment are owned
   * by it and by the doctor's employment — server-derived, never client
   * input. An assignment created without that ownership would be invisible
   * to the hospital-aware patient scope.
   *
   * The assignment is not an afterthought: `PatientScopeService` decides
   * access from `patient_doctor_assignments`, so a patient created
   * without one is a chart the clinician who just registered it cannot
   * open. Doing it in the same transaction means that state is
   * unreachable rather than a race.
   */
  async create(input: {
    readonly publicId: string;
    readonly mrn: string;
    readonly fullName: string;
    readonly dateOfBirth: Date;
    readonly gender: Gender;
    readonly bloodType: BloodType;
    readonly phone: string;
    readonly email?: string | undefined;
    readonly address?: string | undefined;
    readonly medicalNotes?: string | undefined;
    readonly doctor: DoctorListScope;
    readonly actorId: string;
    readonly allergies: readonly {
      readonly allergen: string;
      readonly severity: AllergySeverity;
      readonly reaction: string;
      readonly notes?: string | null | undefined;
    }[];
    readonly conditionIds: readonly string[];
  }): Promise<PatientRow> {
    return this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: {
          publicId: input.publicId,
          mrn: input.mrn,
          fullName: input.fullName,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          bloodType: input.bloodType,
          phone: input.phone,
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.address === undefined ? {} : { address: input.address }),
          ...(input.medicalNotes === undefined ? {} : { medicalNotes: input.medicalNotes }),
          assignedDoctorId: input.doctor.doctorId,
          ...(UUID.test(input.actorId)
            ? { createdBy: input.actorId, updatedBy: input.actorId }
            : {}),
        },
        select: { id: true },
      });

      const record = await tx.hospitalMedicalRecord.create({
        data: { patientId: patient.id, hospitalId: input.doctor.hospitalId },
        select: { id: true },
      });
      const scope: ChartScope = {
        patientId: patient.id,
        hospitalId: input.doctor.hospitalId,
        hospitalMedicalRecordId: record.id,
      };

      if (input.allergies.length > 0) {
        await tx.patientAllergy.createMany({
          data: input.allergies.map((allergy) => ({
            ...stamp(scope),
            allergen: allergy.allergen,
            severity: allergy.severity,
            reaction: allergy.reaction,
            ...(allergy.notes === undefined || allergy.notes === null
              ? {}
              : { notes: allergy.notes }),
            ...(UUID.test(input.actorId)
              ? { recordedBy: input.actorId, createdBy: input.actorId }
              : {}),
          })),
        });
      }

      if (input.conditionIds.length > 0) {
        await tx.patientChronicCondition.createMany({
          data: input.conditionIds.map((conditionId) => ({
            patientId: patient.id,
            conditionId,
            ...(UUID.test(input.actorId) ? { recordedBy: input.actorId } : {}),
          })),
        });
      }

      // `role: 'primary'` — the clinician who registered the patient is
      // their primary care relationship until someone changes it.
      await tx.patientDoctorAssignment.create({
        data: {
          ...stamp(scope),
          doctorId: input.doctor.doctorId,
          doctorEmploymentId: input.doctor.doctorEmploymentId,
          role: 'primary',
          ...(UUID.test(input.actorId) ? { grantedBy: input.actorId } : {}),
        },
      });

      return tx.patient.findUniqueOrThrow({ where: { id: patient.id }, select: PATIENT_SELECT });
    });
  }

  async update(
    patientId: string,
    actorId: string,
    data: {
      readonly status?: PatientStatus | undefined;
      readonly riskLevel?: RiskLevel | undefined;
      readonly phone?: string | undefined;
      readonly email?: string | null | undefined;
      readonly address?: string | null | undefined;
      readonly medicalNotes?: string | null | undefined;
    },
  ): Promise<PatientRow> {
    return this.prisma.db.patient.update({
      where: { id: patientId },
      data: {
        ...(data.status === undefined ? {} : { status: data.status }),
        ...(data.riskLevel === undefined ? {} : { riskLevel: data.riskLevel }),
        ...(data.phone === undefined ? {} : { phone: data.phone }),
        ...(data.email === undefined ? {} : { email: data.email }),
        ...(data.address === undefined ? {} : { address: data.address }),
        ...(data.medicalNotes === undefined ? {} : { medicalNotes: data.medicalNotes }),
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
      select: PATIENT_SELECT,
    });
  }

  /**
   * Soft deactivation — API §4: "patient deletion does not exist".
   *
   * `deleted_at`, which the soft-delete extension then hides from every
   * ordinary read. DB §7 is categorical that PHI is never hard-deleted,
   * and the row is referenced by appointments, records and orders that
   * would be orphaned by a delete.
   */
  async deactivate(patientId: string, actorId: string): Promise<void> {
    await this.prisma.db.patient.update({
      where: { id: patientId },
      data: {
        deletedAt: new Date(),
        status: 'DISCHARGED',
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });
  }

  /** The chronic-condition rows for a list of names, from the vocabulary. */
  async conditionIdsByName(
    names: readonly string[],
  ): Promise<{ ids: readonly string[]; unknown: readonly string[] }> {
    if (names.length === 0) return { ids: [], unknown: [] };

    const rows = await this.prisma.db.chronicCondition.findMany({
      where: { name: { in: [...names] } },
      select: { id: true, name: true },
    });

    const found = new Set(rows.map((row) => row.name));

    return {
      ids: rows.map((row) => row.id),
      unknown: names.filter((name) => !found.has(name)),
    };
  }

  createAllergy(input: {
    readonly scope: ChartScope;
    readonly actorId: string;
    readonly allergen: string;
    readonly severity: AllergySeverity;
    readonly reaction: string;
    readonly notes?: string | null | undefined;
  }): Promise<AllergyRow> {
    return this.prisma.db.patientAllergy.create({
      data: {
        ...stamp(input.scope),
        allergen: input.allergen,
        severity: input.severity,
        reaction: input.reaction,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(UUID.test(input.actorId)
          ? { recordedBy: input.actorId, createdBy: input.actorId }
          : {}),
      },
      select: ALLERGY_SELECT,
    });
  }

  /** Scoped by patient: an allergy id from another chart matches nothing. */
  async updateAllergy(
    scope: ChartScope,
    allergyId: string,
    actorId: string,
    data: {
      readonly allergen?: string | undefined;
      readonly severity?: AllergySeverity | undefined;
      readonly reaction?: string | undefined;
      readonly notes?: string | null | undefined;
    },
  ): Promise<AllergyRow | null> {
    if (!UUID.test(allergyId)) return null;

    const moved = await this.prisma.db.patientAllergy.updateMany({
      where: { id: allergyId, ...owned(scope) },
      data: {
        ...(data.allergen === undefined ? {} : { allergen: data.allergen }),
        ...(data.severity === undefined ? {} : { severity: data.severity }),
        ...(data.reaction === undefined ? {} : { reaction: data.reaction }),
        ...(data.notes === undefined ? {} : { notes: data.notes }),
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });

    if (moved.count === 0) return null;

    return this.prisma.db.patientAllergy.findUniqueOrThrow({
      where: { id: allergyId },
      select: ALLERGY_SELECT,
    });
  }

  /**
   * Soft-removes an allergy. Returns rows moved — 0 or 1.
   *
   * Soft, like every clinical row: an allergy that was recorded and then
   * withdrawn is a clinical fact, and the safety screen's history needs
   * to be able to say it was once believed.
   */
  async removeAllergy(scope: ChartScope, allergyId: string, actorId: string): Promise<number> {
    if (!UUID.test(allergyId)) return 0;

    const result = await this.prisma.db.patientAllergy.updateMany({
      where: { id: allergyId, ...owned(scope) },
      data: { deletedAt: new Date(), ...(UUID.test(actorId) ? { updatedBy: actorId } : {}) },
    });

    return result.count;
  }

  alerts(scope: ChartScope, activeOnly: boolean): Promise<readonly AlertRow[]> {
    return this.prisma.db.patientClinicalAlert.findMany({
      where: { ...owned(scope), ...(activeOnly ? { active: true } : {}) },
      select: ALERT_SELECT,
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });
  }

  createAlert(input: {
    readonly scope: ChartScope;
    readonly actorId: string;
    readonly severity: AlertSeverity;
    readonly message: string;
  }): Promise<AlertRow> {
    return this.prisma.db.patientClinicalAlert.create({
      data: {
        ...stamp(input.scope),
        severity: input.severity,
        message: input.message,
        ...(UUID.test(input.actorId) ? { createdBy: input.actorId, updatedBy: input.actorId } : {}),
      },
      select: ALERT_SELECT,
    });
  }

  async updateAlert(
    scope: ChartScope,
    alertId: string,
    actorId: string,
    data: {
      readonly severity?: AlertSeverity | undefined;
      readonly message?: string | undefined;
      readonly active?: boolean | undefined;
      readonly reason?: string | undefined;
    },
  ): Promise<AlertRow | null> {
    if (!UUID.test(alertId)) return null;

    const moved = await this.prisma.db.patientClinicalAlert.updateMany({
      where: { id: alertId, ...owned(scope) },
      data: {
        ...(data.severity === undefined ? {} : { severity: data.severity }),
        ...(data.message === undefined ? {} : { message: data.message }),
        ...(data.active === undefined ? {} : { active: data.active }),
        // Written on resolution only (the schema refuses a reason without
        // `active: false`). A resolution without one clears the previous
        // resolution's reason rather than leaving it to describe this one.
        ...(data.active === false ? { resolutionReason: data.reason ?? null } : {}),
        ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
      },
    });

    if (moved.count === 0) return null;

    return this.prisma.db.patientClinicalAlert.findUniqueOrThrow({
      where: { id: alertId },
      select: ALERT_SELECT,
    });
  }

  /**
   * The profile bundle's satellites, in one round trip each (API §4.4).
   * Hospital-owned satellites (vitals, medications, alerts) are the active
   * hospital's only; conditions and contacts are patient-level.
   */
  async bundleFor(scope: ChartScope): Promise<{
    latestVitals: Prisma.PatientVitalSignGetPayload<{
      select: {
        recordedAt: true;
        bloodPressureSystolic: true;
        bloodPressureDiastolic: true;
        heartRateBpm: true;
        temperatureC: true;
        respiratoryRate: true;
        oxygenSaturation: true;
        weightKg: true;
        heightCm: true;
        bmi: true;
      };
    }> | null;
    medications: readonly Prisma.PatientMedicationGetPayload<{
      select: {
        id: true;
        name: true;
        dosage: true;
        frequency: true;
        status: true;
        startDate: true;
        endDate: true;
        prescription: { select: { publicId: true } };
      };
    }>[];
    conditions: readonly string[];
    emergencyContacts: readonly Prisma.PatientEmergencyContactGetPayload<{
      select: { id: true; name: true; relationship: true; phone: true; isPrimary: true };
    }>[];
    alerts: readonly AlertRow[];
  }> {
    const [latestVitals, medications, conditions, emergencyContacts, alerts] = await Promise.all([
      this.prisma.db.patientVitalSign.findFirst({
        where: owned(scope),
        select: {
          recordedAt: true,
          bloodPressureSystolic: true,
          bloodPressureDiastolic: true,
          heartRateBpm: true,
          temperatureC: true,
          respiratoryRate: true,
          oxygenSaturation: true,
          weightKg: true,
          heightCm: true,
          bmi: true,
        },
        orderBy: { recordedAt: 'desc' },
      }),
      this.prisma.db.patientMedication.findMany({
        where: { ...owned(scope), status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          dosage: true,
          frequency: true,
          status: true,
          startDate: true,
          endDate: true,
          // RM M13.6 — Rx-linked or externally reported. See the field's
          // note on `PatientMedicationView` for why the card must say.
          prescription: { select: { publicId: true } },
        },
        orderBy: { startDate: 'desc' },
        // The summary card, not the tab. §4.5's `/medications` is the
        // full list; ten is what the card can show without scrolling.
        take: 10,
      }),
      this.prisma.db.patientChronicCondition.findMany({
        where: { patientId: scope.patientId },
        select: { condition: { select: { name: true } } },
      }),
      this.prisma.db.patientEmergencyContact.findMany({
        where: { patientId: scope.patientId },
        select: { id: true, name: true, relationship: true, phone: true, isPrimary: true },
        orderBy: { isPrimary: 'desc' },
      }),
      this.alerts(scope, true),
    ]);

    return {
      latestVitals,
      medications,
      conditions: conditions.map((row) => row.condition.name),
      emergencyContacts,
      alerts,
    };
  }

  /** The next free sequence value behind the `PT-…` handle and the MRN. */
  async nextIdentitySequence(): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      Array<{ value: bigint }>
    >`SELECT nextval('patient_identity_seq') AS value`;

    return Number(rows[0]?.value ?? 1);
  }

  private whereFor(
    doctor: DoctorListScope | null,
    criteria: PatientListCriteria,
  ): Prisma.PatientWhereInput {
    const now = Date.now();

    return {
      // The care scope. `revokedAt: null` is what makes removing a doctor
      // from a patient's care actually remove their access.
      ...(doctor === null
        ? {}
        : {
            careAssignments: {
              some: {
                doctorId: doctor.doctorId,
                doctorEmploymentId: doctor.doctorEmploymentId,
                hospitalId: doctor.hospitalId,
                revokedAt: null,
              },
            },
          }),
      ...searchWhere(criteria.q, criteria.scope),
      ...(criteria.status === undefined ? {} : { status: criteria.status }),
      ...(criteria.gender === undefined ? {} : { gender: criteria.gender }),
      ...(criteria.riskLevel === undefined ? {} : { riskLevel: criteria.riskLevel }),
      ...(criteria.condition === undefined
        ? {}
        : { chronicConditions: { some: { condition: { name: criteria.condition } } } }),
      // Age is derived, so the filter is expressed as a date-of-birth
      // range — which is what an index can serve. `ageMin` is the *older*
      // bound, so it becomes the *earlier* birth date, and getting that
      // backwards silently returns the complement of what was asked.
      ...(criteria.ageMin === undefined && criteria.ageMax === undefined
        ? {}
        : {
            dateOfBirth: {
              ...(criteria.ageMax === undefined
                ? {}
                : { gte: birthDateForAge(criteria.ageMax + 1, now) }),
              ...(criteria.ageMin === undefined
                ? {}
                : { lte: birthDateForAge(criteria.ageMin, now) }),
            },
          }),
      ...(criteria.lastVisitFrom === undefined && criteria.lastVisitTo === undefined
        ? {}
        : {
            lastVisitAt: {
              ...(criteria.lastVisitFrom === undefined ? {} : { gte: criteria.lastVisitFrom }),
              ...(criteria.lastVisitTo === undefined ? {} : { lte: criteria.lastVisitTo }),
            },
          }),
      ...(criteria.hasUpcoming === undefined
        ? {}
        : {
            appointments: criteria.hasUpcoming
              ? {
                  some: {
                    startsAt: { gte: new Date(now) },
                    status: { in: [...LIVE_APPOINTMENT_STATUSES] },
                  },
                }
              : {
                  none: {
                    startsAt: { gte: new Date(now) },
                    status: { in: [...LIVE_APPOINTMENT_STATUSES] },
                  },
                },
          }),
    };
  }
}

/**
 * The identifier auto-detect of API §4.1.
 *
 * The shape of the input decides which column to probe, and an explicit
 * `scope` overrides the guess. Each branch is a single trigram-indexed
 * `contains`, so the detection is about *precision* rather than cost — a
 * clinician typing a phone number should not get every patient whose
 * name contains those digits.
 */
function searchWhere(
  q: string | undefined,
  scope: PatientListCriteria['scope'],
): Prisma.PatientWhereInput {
  if (q === undefined) return {};

  const resolved = scope ?? detectScope(q);

  switch (resolved) {
    case 'id':
      return { publicId: { contains: q, mode: 'insensitive' } };
    case 'phone':
      return { phone: { contains: q } };
    case 'mrn':
      return { mrn: { contains: q, mode: 'insensitive' } };
    case 'name':
    default:
      return { fullName: { contains: q, mode: 'insensitive' } };
  }
}

/**
 * Which identifier a search term looks like.
 *
 * **The order is the whole function.** The three numeric patterns
 * overlap, and each is a subset of the one below it:
 *
 *  · `PT-2009` matches the MRN pattern and the phone pattern.
 *  · `4411-27` matches the phone pattern — it is seven characters of
 *    digits and a dash — which is why MRN is tested *before* phone.
 *    Getting this backwards is not a near miss: an MRN searched against
 *    `patients.phone` finds nothing, so a clinician typing the number on
 *    a wristband gets "no results" for a patient who is standing in
 *    front of them.
 *
 * Anything left is a name, which is the safe default — a name search
 * over a phone number returns nothing rather than something wrong.
 */
function detectScope(q: string): NonNullable<PatientListCriteria['scope']> {
  const trimmed = q.trim();

  if (/^pt-/i.test(trimmed)) return 'id';
  if (/^\d+-\d+$/.test(trimmed)) return 'mrn';
  if (/^\+?[\d\s()-]{7,}$/.test(trimmed)) return 'phone';

  return 'name';
}

/** The birth date of someone turning exactly `age` today, in UTC. */
function birthDateForAge(age: number, now: number): Date {
  const today = new Date(now);
  return new Date(Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate()));
}

function orderFor(sort: PatientListCriteria['sort']): Prisma.PatientOrderByWithRelationInput {
  switch (sort) {
    case 'name:desc':
      return { fullName: 'desc' };
    case 'lastVisit:desc':
      // Nulls last: a patient who has never visited is not the most
      // recent one, and sorting them to the top of "most recent first"
      // would say they are.
      return { lastVisitAt: { sort: 'desc', nulls: 'last' } };
    case 'lastVisit:asc':
      return { lastVisitAt: { sort: 'asc', nulls: 'last' } };
    case 'registered:desc':
      return { registeredAt: 'desc' };
    case 'name:asc':
    default:
      return { fullName: 'asc' };
  }
}
