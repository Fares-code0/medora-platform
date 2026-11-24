/**
 * Hospital attribution for new clinical rows (multi-hospital §2.7, fix-list
 * item 8).
 *
 * Every clinical row a doctor creates is stamped with the hospital it
 * belongs to, the patient's Hospital Medical Record there, and the
 * employment the doctor acted under. That stamp is what Row-Level Security,
 * Exceptional Access reads and the per-resource DR-05 check all key on. A row
 * without it is legacy and stays isolated.
 *
 * The hospital is the doctor's one active employment at an ACTIVE hospital,
 * and the patient must hold a record there. Otherwise there is no stamp, and
 * the caller must refuse rather than write an unattributed row.
 */

export interface HospitalStamp {
  readonly hospitalId: string;
  readonly hospitalMedicalRecordId: string;
  readonly doctorEmploymentId: string;
}

/** The structural slice of a Prisma client (or transaction) this needs. */
export interface StampClient {
  doctorEmployment: {
    findMany(args: {
      where: object;
      select: { id: true; hospitalId: true };
      take: number;
    }): Promise<{ id: string; hospitalId: string }[]>;
  };
  hospitalMedicalRecord: {
    findFirst(args: { where: object; select: { id: true } }): Promise<{ id: string } | null>;
  };
}

export async function hospitalStampFor(
  client: StampClient,
  doctorId: string,
  patientId: string,
): Promise<HospitalStamp | null> {
  // Exactly one: two active employments are ambiguous standing, and the
  // read scope (`PatientScopeService.clinicalHospitalOf`) refuses them too,
  // so a write can never be stamped with a hospital its author cannot read.
  const employments = await client.doctorEmployment.findMany({
    where: { doctorId, endedAt: null, hospital: { is: { status: 'ACTIVE', deletedAt: null } } },
    select: { id: true, hospitalId: true },
    take: 2,
  });
  const employment = employments.length === 1 ? employments[0] : undefined;
  if (employment === undefined) return null;
  const record = await client.hospitalMedicalRecord.findFirst({
    where: { patientId, hospitalId: employment.hospitalId },
    select: { id: true },
  });
  if (record === null) return null;
  return {
    hospitalId: employment.hospitalId,
    hospitalMedicalRecordId: record.id,
    doctorEmploymentId: employment.id,
  };
}
