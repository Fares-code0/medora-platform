import type { PrismaService } from '../../src/shared/database';

import { releaseOwnership } from './hospital-fixture';

/**
 * A `doctors` row owned by one spec file.
 *
 * ## Why this exists (RA-M10.1)
 *
 * The other half of the hazard `patient-fixture.ts` documents at length.
 * That file brought *patients* under the rule every other support helper
 * already states — everything a suite creates carries the suite's own
 * tag, so two suites can run against one database without colliding —
 * and left *doctors* outside it.
 *
 * The failure it produces is a **teardown** failure, not a test failure,
 * which is what makes it so hard to read. `auth-app.ts`'s `reset()`
 * deletes a suite's users by email suffix; `doctors.user_id` is
 * `ON DELETE CASCADE`, so that deletes the suite's doctors with them.
 * Several clinical tables are `ON DELETE RESTRICT` on `doctor_id`
 * (DB §9) — `appointments`, `prescriptions`, `lab_orders`. So if any
 * *other* concurrently-running suite has borrowed that doctor and hung a
 * row off it, the reset fails with a foreign-key violation and the
 * borrowing suite reports every one of its own tests as passed.
 *
 * The victim therefore rotates: whichever suite happened to own the row
 * the borrower picked up. That is the signature the roadmap records at
 * M15 — `appointments_doctor_id_fkey` with `ai-assistant` as victim,
 * `prescriptions_prescribing_doctor_id_fkey` with `appointments-book`.
 *
 * `findFirstOrThrow()` with no `where` is the borrow. It passes every
 * time the file is run alone, because then there is no other suite's
 * doctor in the table to find.
 *
 * ## `MED-T` marks a licence as a test's, not the clinic's
 *
 * The same convention `TEST_PATIENT_PREFIX` establishes, applied to the
 * one column that identifies a practitioner. `doctors.license_number` is
 * `UNIQUE` and `VarChar(40)`; `clinic-fixture.ts` already writes
 * `MED-<tag>`, and the seed's demo doctors use their own numbering, so
 * the three namespaces cannot overlap.
 */

/** Marks a `doctors` row as created by a spec rather than by the seed. */
export const TEST_DOCTOR_PREFIX = 'MED-T';

export interface DoctorRecord {
  readonly id: string;
  readonly userId: string;
  /** The `users.public_id`, for specs that need to sign in as this doctor. */
  readonly publicId: string;
  readonly licenseNumber: string;
  readonly contactEmail: string;
}

/**
 * Creates a doctor owned by `tag`, with the user row it hangs off.
 *
 * Call once per spec file, from `beforeAll`, and pair it with
 * `destroyTestDoctor` in `afterAll`.
 *
 * The user's email is **deliberately outside the harness's own domain**
 * — `<tag>.doctor.fixture.test` rather than `<suite>.m6.test`. A
 * `harness.reset()` between tests would otherwise cascade this doctor
 * away mid-file, which is the very failure the helper exists to prevent,
 * only self-inflicted. Teardown is explicit instead.
 */
export async function createTestDoctor(prisma: PrismaService, tag: string): Promise<DoctorRecord> {
  const licenseNumber = `${TEST_DOCTOR_PREFIX}${tag}`;
  const contactEmail = `doctor@${tag}.doctor.fixture.test`;

  if (licenseNumber.length > 40) {
    throw new Error(`Tag "${tag}" is too long: license_number is VarChar(40).`);
  }

  // Left over from a run killed between `beforeAll` and `afterAll` — a
  // crashed process, or a watch-mode restart. Creating over the top
  // would fail the unique constraint on license_number and report itself
  // as a fixture error rather than as the stale state it is.
  await destroyTestDoctor(prisma, tag);

  const roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } })).id;
  const departmentId = (
    await prisma.department.findUniqueOrThrow({ where: { name: 'Cardiology' } })
  ).id;

  const user = await prisma.user.create({
    data: {
      publicId: `usr_t${tag}`,
      firstName: 'Priya',
      lastName: 'Nair',
      displayName: 'Dr. Priya Nair',
      email: contactEmail,
      phone: '+1 555 012 8891',
      roleId,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
    },
    select: { id: true, publicId: true },
  });

  const doctor = await prisma.doctor.create({
    data: {
      userId: user.id,
      fullName: 'Dr. Priya Nair',
      specialty: 'Internal Medicine',
      licenseNumber,
      contactEmail,
      contactPhone: '+1 (555) 012-8891',
      departmentId,
    },
    select: { id: true },
  });

  return {
    id: doctor.id,
    userId: user.id,
    publicId: user.publicId,
    licenseNumber,
    contactEmail,
  };
}

/**
 * Removes the doctor `tag` owns, and the user it hangs off.
 *
 * Appointments go first for the reason `destroyPatientRecords` observes:
 * `appointments.doctor_id` is `ON DELETE RESTRICT` (DB §9), because a
 * practitioner with history is deactivated rather than deleted. Deleting
 * the user then cascades the doctor away.
 */
export async function destroyTestDoctor(prisma: PrismaService, tag: string): Promise<void> {
  const doctor = await prisma.doctor.findUnique({
    where: { licenseNumber: `${TEST_DOCTOR_PREFIX}${tag}` },
    select: { id: true, userId: true },
  });

  if (doctor === null) return;

  // Hospital employments restrict `doctors` (S3/S4).
  await releaseOwnership(prisma, { doctorIds: [doctor.id] });
  await prisma.appointment.deleteMany({ where: { doctorId: doctor.id } });
  await prisma.doctor.deleteMany({ where: { id: doctor.id } });
  await prisma.user.deleteMany({ where: { id: doctor.userId } });
}
