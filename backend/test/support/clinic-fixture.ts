import type { PrismaService } from '../../src/shared/database';

import { releaseOwnership } from './hospital-fixture';

/**
 * A minimal but complete clinic, for the schema specs from M5.6 onward.
 *
 * By this point a single appointment needs a user, a doctor, a patient, a
 * department and a visit type — five rows before the row under test.
 * Building that inline in every spec makes the assertion hard to find,
 * and makes each spec's cleanup subtly different.
 *
 * Everything created carries the caller's `tag` in its identifiers, so a
 * suite can delete exactly what it made and two suites can run against
 * one database without colliding.
 */
export interface ClinicFixture {
  readonly userId: string;
  readonly doctorId: string;
  readonly patientId: string;
  readonly departmentId: string;
  readonly visitTypeId: string;
  readonly emailDomain: string;
}

export async function createClinicFixture(
  prisma: PrismaService,
  tag: string,
): Promise<ClinicFixture> {
  const emailDomain = `${tag}.test`;
  const roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } })).id;
  const departmentId = (
    await prisma.department.findUniqueOrThrow({ where: { name: 'Cardiology' } })
  ).id;
  const visitTypeId = (
    await prisma.visitType.findUniqueOrThrow({ where: { name: 'Consultation' } })
  ).id;

  const user = await prisma.user.create({
    data: {
      publicId: `usr_${tag}`,
      firstName: 'Amelia',
      lastName: 'Chen',
      displayName: 'Dr. Amelia Chen',
      email: `doctor@${emailDomain}`,
      phone: '+1 555 012 4477',
      roleId,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
    },
  });

  const doctor = await prisma.doctor.create({
    data: {
      userId: user.id,
      fullName: 'Dr. Amelia Chen',
      specialty: 'Internal Medicine',
      licenseNumber: `MED-${tag}`,
      contactEmail: `doctor@${emailDomain}`,
      contactPhone: '+1 (555) 012-4477',
      departmentId,
    },
  });

  const patient = await prisma.patient.create({
    data: {
      publicId: `PT-${tag}`,
      mrn: `MRN-${tag}`,
      fullName: 'Khaled Nassar',
      dateOfBirth: new Date('1974-03-18'),
      gender: 'MALE',
      bloodType: 'O_POSITIVE',
      phone: '+20 100 214 3387',
      assignedDoctorId: doctor.id,
    },
  });

  return {
    userId: user.id,
    doctorId: doctor.id,
    patientId: patient.id,
    departmentId,
    visitTypeId,
    emailDomain,
  };
}

/**
 * Removes the fixture. Order matters: the clinical anchors are RESTRICT
 * (DB §9), so the fact rows have to go before the patient and doctor —
 * which is the deletion policy working as designed, not an inconvenience.
 */
export async function destroyClinicFixture(
  prisma: PrismaService,
  fixture: ClinicFixture,
): Promise<void> {
  await releaseOwnership(prisma, {
    patientIds: [fixture.patientId],
    doctorIds: [fixture.doctorId],
  });
  await prisma.appointment.deleteMany({ where: { patientId: fixture.patientId } });
  await prisma.patient.deleteMany({ where: { id: fixture.patientId } });
  await prisma.doctor.deleteMany({ where: { id: fixture.doctorId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}
