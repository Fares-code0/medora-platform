import type { Prisma } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/shared/database';

/**
 * Hospital-owned care for spec files (enforcement stages S3/S4).
 *
 * ## Why this exists
 *
 * Since S3 a doctor reaches a patient only through a live care assignment
 * **owned by the doctor's active hospital employment** — `hospital_id`,
 * `doctor_employment_id` and `hospital_medical_record_id` all set — and only
 * while the doctor is verified, `ACTIVE` or `VACATION`, and not deleted
 * (#17, #18, OD-12). A bare `patient_doctor_assignments` row, the shape
 * every spec used to insert, is a legacy row with unknown ownership and
 * grants nothing.
 *
 * So the ordinary fixture is now **properly owned** data: a hospital, an
 * active employment, the patient's hospital medical record there, and an
 * assignment tied to all three. Specs that need the legacy or
 * cross-hospital shapes build them on purpose, for negative tests.
 *
 * ## Ownership and teardown
 *
 * Every hospital a suite creates carries the suite's `tag` in its public
 * id (`hsp_t<tag>…`), so `destroyTestHospitals` deletes exactly what the
 * suite made. Hospital-owned rows are `ON DELETE RESTRICT` towards the
 * hospital, the medical record and the employment, so they are removed
 * here in dependency order, scoped to the suite's hospitals — call it
 * **before** removing the suite's patients and doctors, because
 * `hospital_medical_records` and `doctor_employments` restrict those too.
 */

export interface TestHospital {
  readonly id: string;
  readonly publicId: string;
}

export interface OwnedCare {
  readonly hospitalId: string;
  readonly doctorEmploymentId: string;
  readonly hospitalMedicalRecordId: string;
}

const PREFIX = 'hsp_t';

/** Creates (or recreates) an `ACTIVE` hospital owned by `tag`. */
export async function createTestHospital(
  prisma: PrismaService,
  tag: string,
  suffix = 'a',
): Promise<TestHospital> {
  const publicId = `${PREFIX}${tag}_${suffix}`;
  if (publicId.length > 40) throw new Error(`Tag "${tag}" is too long for hospitals.public_id.`);

  const existing = await prisma.hospital.findUnique({ where: { publicId }, select: { id: true } });
  if (existing !== null) await purgeHospitals(prisma, [existing.id]);

  return prisma.hospital.create({
    data: { publicId, name: `Test Hospital ${tag} ${suffix}` },
    select: { id: true, publicId: true },
  });
}

/**
 * Employs a doctor at a hospital and makes the doctor clinically usable
 * (#18): `VERIFIED`. Ends any other active employment first — DR-02 allows
 * one — and returns the new employment's id.
 */
export async function employDoctor(
  prisma: PrismaService,
  doctorId: string,
  hospitalId: string,
): Promise<string> {
  await prisma.doctor.update({
    where: { id: doctorId },
    data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() },
  });

  const active = await prisma.doctorEmployment.findFirst({
    where: { doctorId, endedAt: null },
    select: { id: true, hospitalId: true },
  });
  if (active?.hospitalId === hospitalId) return active.id;
  if (active !== null) {
    await prisma.doctorEmployment.update({
      where: { id: active.id },
      data: { endedAt: new Date() },
    });
  }

  const employment = await prisma.doctorEmployment.create({
    data: { doctorId, hospitalId },
    select: { id: true },
  });
  return employment.id;
}

/** The patient's medical record at the hospital, created on first use (OD-09). */
export async function hospitalRecordFor(
  prisma: PrismaService,
  patientId: string,
  hospitalId: string,
): Promise<string> {
  const record = await prisma.hospitalMedicalRecord.upsert({
    where: { patientId_hospitalId: { patientId, hospitalId } },
    create: { patientId, hospitalId },
    update: {},
    select: { id: true },
  });
  return record.id;
}

/**
 * A live care assignment owned by the doctor's **active** employment, its
 * hospital and the patient's medical record there — the shape that grants
 * clinical access. A live legacy or differently owned row for the same pair
 * is revoked first (`one_live_per_pair`), never rewritten (#17).
 */
export async function assignOwned(
  prisma: PrismaService,
  input: { doctorId: string; patientId: string; role?: 'primary' | 'consulting' },
): Promise<OwnedCare> {
  const employment = await prisma.doctorEmployment.findFirstOrThrow({
    where: { doctorId: input.doctorId, endedAt: null },
    select: { id: true, hospitalId: true },
  });
  const hospitalMedicalRecordId = await hospitalRecordFor(
    prisma,
    input.patientId,
    employment.hospitalId,
  );
  const care: OwnedCare = {
    hospitalId: employment.hospitalId,
    doctorEmploymentId: employment.id,
    hospitalMedicalRecordId,
  };

  const live = await prisma.patientDoctorAssignment.findFirst({
    where: { doctorId: input.doctorId, patientId: input.patientId, revokedAt: null },
    select: { id: true, doctorEmploymentId: true },
  });
  if (live?.doctorEmploymentId === employment.id) return care;
  if (live !== null) {
    await prisma.patientDoctorAssignment.update({
      where: { id: live.id },
      data: { revokedAt: new Date() },
    });
  }

  await prisma.patientDoctorAssignment.create({
    data: {
      patientId: input.patientId,
      doctorId: input.doctorId,
      role: input.role ?? 'consulting',
      hospitalId: care.hospitalId,
      doctorEmploymentId: care.doctorEmploymentId,
      hospitalMedicalRecordId: care.hospitalMedicalRecordId,
    },
  });
  return care;
}

/** `employDoctor` for an account, by user id — for doctors registered through the API. */
export async function employUser(
  prisma: PrismaService,
  userId: string,
  hospitalId: string,
): Promise<string> {
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { userId }, select: { id: true } });
  return employDoctor(prisma, doctor.id, hospitalId);
}

/**
 * The patient's one hospital medical record, as the two columns a
 * hospital-owned chart row (allergy, medication, note, …) carries. For specs
 * whose patient was registered at exactly one hospital.
 */
export async function ownedChart(
  prisma: PrismaService,
  patientId: string,
): Promise<{ hospitalId: string; hospitalMedicalRecordId: string }> {
  const record = await prisma.hospitalMedicalRecord.findFirstOrThrow({
    where: { patientId },
    select: { id: true, hospitalId: true },
  });
  return { hospitalId: record.hospitalId, hospitalMedicalRecordId: record.id };
}

/**
 * Employs the doctor at `hospitalId` (if not already) and owns the
 * assignment there — the one-call happy path most specs need.
 */
export async function ownedCareFor(
  prisma: PrismaService,
  input: {
    hospitalId: string;
    doctorId: string;
    patientId: string;
    role?: 'primary' | 'consulting';
  },
): Promise<OwnedCare> {
  await employDoctor(prisma, input.doctorId, input.hospitalId);
  return assignOwned(prisma, input);
}

/**
 * `patient.deleteMany` for a suite's patients, releasing their hospital
 * medical records (and the rows tied to them) first.
 */
export async function deletePatients(
  prisma: PrismaService,
  args: { where: Prisma.PatientWhereInput },
): Promise<void> {
  const patients = await prisma.patient.findMany({ where: args.where, select: { id: true } });
  if (patients.length === 0) return;
  const ids = patients.map((patient) => patient.id);
  await releaseOwnership(prisma, { patientIds: ids });
  await prisma.patient.deleteMany({ where: { id: { in: ids } } });
}

/**
 * `doctor.deleteMany` for a suite's doctors, releasing their employments
 * (and the rows tied to them) first.
 */
export async function deleteDoctors(
  prisma: PrismaService,
  args: { where: Prisma.DoctorWhereInput },
): Promise<void> {
  const doctors = await prisma.doctor.findMany({ where: args.where, select: { id: true } });
  if (doctors.length === 0) return;
  const ids = doctors.map((doctor) => doctor.id);
  await releaseOwnership(prisma, { doctorIds: ids });
  await prisma.doctor.deleteMany({ where: { id: { in: ids } } });
}

/** Every hospital `tag` created. Call before deleting the suite's patients and doctors. */
export async function destroyTestHospitals(prisma: PrismaService, tag: string): Promise<void> {
  const hospitals = await prisma.hospital.findMany({
    where: { publicId: { startsWith: `${PREFIX}${tag}_` } },
    select: { id: true },
  });
  await purgeHospitals(
    prisma,
    hospitals.map((hospital) => hospital.id),
  );
}

/**
 * Releases the hospital ownership of these patients and doctors: deletes
 * every row tied to their hospital medical records or employments, then
 * the records and employments themselves. Both are `ON DELETE RESTRICT`
 * towards `patients` and `doctors`, so a suite's own teardown of patients
 * and doctors calls this first; the hospitals stay (see
 * `destroyTestHospitals`).
 */
export async function releaseOwnership(
  prisma: PrismaService,
  input: { patientIds?: readonly string[]; doctorIds?: readonly string[] },
): Promise<void> {
  const patientIds = [...(input.patientIds ?? [])];
  const doctorIds = [...(input.doctorIds ?? [])];
  if (patientIds.length === 0 && doctorIds.length === 0) return;

  const recordIds = (
    await prisma.hospitalMedicalRecord.findMany({
      where: { patientId: { in: patientIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const employmentIds = (
    await prisma.doctorEmployment.findMany({
      where: { doctorId: { in: doctorIds } },
      select: { id: true },
    })
  ).map((row) => row.id);

  await purgeScoped(prisma, { recordIds, employmentIds });
  await prisma.hospitalMedicalRecord.deleteMany({ where: { id: { in: recordIds } } });
  await prisma.doctorEmployment.deleteMany({ where: { id: { in: employmentIds } } });
}

/**
 * Deletes every hospital-owned row tied to these hospitals, medical
 * records or employments, children before parents. Rows that cascade from
 * a deleted parent (record children, lab results, prescription items,
 * messages) go with it.
 */
async function purgeScoped(
  prisma: PrismaService,
  input: { hospitalIds?: string[]; recordIds?: string[]; employmentIds?: string[] },
): Promise<void> {
  const hospitalIds = input.hospitalIds ?? [];
  const recordIds = input.recordIds ?? [];
  const employmentIds = input.employmentIds ?? [];
  const byRecord = {
    OR: [{ hospitalId: { in: hospitalIds } }, { hospitalMedicalRecordId: { in: recordIds } }],
  };
  const byRecordOrEmployment = {
    OR: [...byRecord.OR, { doctorEmploymentId: { in: employmentIds } }],
  };
  const byEmployment = {
    OR: [{ hospitalId: { in: hospitalIds } }, { doctorEmploymentId: { in: employmentIds } }],
  };

  await prisma.notification.deleteMany({ where: byRecord });
  await prisma.aiConversation.deleteMany({ where: byRecord });
  await prisma.conversation.deleteMany({ where: byRecord });
  await prisma.hospitalMedicalRecordCondition.deleteMany({ where: byRecord });
  await prisma.patientMedication.deleteMany({ where: byRecord });
  await prisma.patientStudy.deleteMany({ where: byRecord });
  await prisma.patientVitalSign.deleteMany({ where: byRecord });
  await prisma.patientAllergy.deleteMany({ where: byRecord });
  await prisma.patientDocument.deleteMany({ where: byRecord });
  await prisma.patientNote.deleteMany({ where: byRecord });
  await prisma.patientMedicalHistory.deleteMany({ where: byRecord });
  await prisma.patientClinicalAlert.deleteMany({ where: byRecord });
  await prisma.prescription.deleteMany({ where: byRecordOrEmployment });
  await prisma.labOrder.deleteMany({ where: byRecordOrEmployment });
  await prisma.medicalRecord.deleteMany({ where: byRecordOrEmployment });
  await prisma.appointment.deleteMany({ where: byRecordOrEmployment });
  await prisma.patientDoctorAssignment.deleteMany({ where: byRecordOrEmployment });
  await prisma.publishedSlot.deleteMany({ where: byEmployment });
  await prisma.hospitalRoleAssignment.deleteMany({
    where: {
      OR: [
        { hospitalId: { in: hospitalIds } },
        { sourceDoctorEmploymentId: { in: employmentIds } },
      ],
    },
  });
  await prisma.doctorAvailability.deleteMany({ where: byEmployment });
  await prisma.doctorTimeOff.deleteMany({ where: byEmployment });
}

/** Deletes everything owned by these hospitals, then the hospitals. */
async function purgeHospitals(
  prisma: PrismaService,
  hospitalIds: readonly string[],
): Promise<void> {
  if (hospitalIds.length === 0) return;
  const ids = [...hospitalIds];
  const inHospital = { hospitalId: { in: ids } };

  await purgeScoped(prisma, { hospitalIds: ids });
  await prisma.queueEntry.deleteMany({ where: inHospital });
  await prisma.waitingRoomEntry.deleteMany({ where: inHospital });
  await prisma.hospitalMedicalRecord.deleteMany({ where: inHospital });
  await prisma.doctorEmployment.deleteMany({ where: inHospital });
  await prisma.hospitalDepartment.deleteMany({ where: inHospital });
  await prisma.file.deleteMany({ where: inHospital });
  await prisma.domainEvent.deleteMany({ where: inHospital });
  await prisma.hospital.deleteMany({ where: { id: { in: ids } } });
}
