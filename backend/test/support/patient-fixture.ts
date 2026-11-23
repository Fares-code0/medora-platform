import { purgeHospitalRecords } from './auth-app';
import type { PrismaService } from '../../src/shared/database';

/**
 * Clinical records owned by one spec file.
 *
 * ## Why this exists
 *
 * The three patient specs each need a `patients` row to link an account
 * to (`patients.user_id`, ADR-030 §1). They originally borrowed the
 * seeded demo records — `findFirstOrThrow()`, or `findMany({ take: 2,
 * orderBy: { publicId: 'asc' } })` — which meant all three reached for
 * `PT-1001` and `PT-1002`, the same two rows.
 *
 * Vitest runs spec files in parallel. Each of those specs linked a
 * seeded row, made a request, and then reset the link to `null`. So one
 * file's cleanup would null the link another file was mid-request on,
 * and `GET /me/profile` would answer `patient: null` for an account that
 * had been linked a millisecond earlier. It fails perhaps half the time
 * under load, passes every time when the file is run alone, and passed
 * CI often enough to merge.
 *
 * `patients.user_id` is `UNIQUE`, so this is not a hazard that more
 * retries or longer timeouts would fix: two suites cannot both own the
 * same record, by construction.
 *
 * ## The rule this restores
 *
 * Both existing support helpers already state it. `auth-app.ts`: "the
 * identity tables are cleaned by email suffix, and each spec file passes
 * its own suffix … one auth spec cannot delete another's fixtures
 * mid-run, which is a failure that only appears in a full-suite run and
 * never when the file is run alone." `clinic-fixture.ts`: "everything
 * created carries the caller's `tag` in its identifiers, so a suite can
 * delete exactly what it made and two suites can run against one
 * database without colliding."
 *
 * Patient rows were the one shared mutable fixture left outside that
 * rule. This helper brings them under it.
 *
 * ## `PT-T` marks a record as a test's, not the clinic's
 *
 * `patient-appointments.e2e-spec.ts` already scopes its cleanup with an
 * `APT-T` prefix for the same reason; this is that convention applied to
 * `patients`. The prefix is load-bearing beyond cleanup: it is what lets
 * `patient-identity.e2e-spec.ts` assert that *seeded* records are
 * unlinked without that assertion racing every other suite's fixtures.
 *
 * Seeded records are `PT-1001`–`PT-1005` with numeric MRNs, so the
 * namespaces cannot overlap.
 *
 * `patients.public_id` and `patients.mrn` are both `VarChar(20)` and
 * both `UNIQUE`, which is why tags are short: `MRN-T` + tag + index must
 * fit in twenty characters.
 */

/** Marks a `patients` row as created by a spec rather than by the seed. */
export const TEST_PATIENT_PREFIX = 'PT-T';

export interface PatientRecord {
  readonly id: string;
  readonly publicId: string;
}

/**
 * Creates `count` clinical records owned by `tag`.
 *
 * Call once per spec file, from `beforeAll`. The rows deliberately
 * outlive `harness.reset()`, which deletes only this suite's *users* —
 * and because `patients.user_id` is `SET NULL` on user delete (DB §7,
 * ADR-030 §1), that reset also unlinks these records for free. A test
 * therefore starts from an unlinked record without any explicit
 * teardown of its own.
 *
 * `assignedDoctorId` is left null: it is optional, and none of the
 * patient-facing reads under test project it.
 */
export async function createPatientRecords(
  prisma: PrismaService,
  tag: string,
  count = 2,
): Promise<PatientRecord[]> {
  const publicIdFor = (index: number): string => `${TEST_PATIENT_PREFIX}${tag}${index}`;

  if (publicIdFor(count - 1).length > 20 || `MRN-T${tag}${count - 1}`.length > 20) {
    throw new Error(`Tag "${tag}" is too long: public_id and mrn are VarChar(20).`);
  }

  // Left over from a run that was killed between `beforeAll` and
  // `afterAll` — a crashed process, or a watch-mode restart. Creating
  // over the top of those would fail the unique constraint on public_id
  // and report itself as a fixture error rather than as the stale state
  // it is.
  await destroyPatientRecords(prisma, tag);

  const records: PatientRecord[] = [];

  for (let index = 0; index < count; index += 1) {
    const created = await prisma.patient.create({
      data: {
        publicId: publicIdFor(index),
        mrn: `MRN-T${tag}${index}`,
        fullName: `Test Patient ${index + 1}`,
        dateOfBirth: new Date('1984-05-12'),
        gender: index % 2 === 0 ? 'FEMALE' : 'MALE',
        bloodType: 'O_POSITIVE',
        phone: '+20 100 214 3387',
      },
      select: { id: true, publicId: true },
    });

    records.push(created);
  }

  return records;
}

/**
 * Removes every record `tag` owns.
 *
 * Appointments go first: `appointments.patient_id` is `ON DELETE
 * RESTRICT` (DB §9), because a patient with history is deactivated
 * rather than deleted. That is the deletion policy working, not an
 * obstacle — the same order `destroyClinicFixture` observes.
 */
export async function destroyPatientRecords(prisma: PrismaService, tag: string): Promise<void> {
  const owned = { publicId: { startsWith: `${TEST_PATIENT_PREFIX}${tag}` } };
  const ids = (await prisma.patient.findMany({ where: owned, select: { id: true } })).map(
    (row) => row.id,
  );

  if (ids.length === 0) return;

  await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
  // Hospital Medical Records restrict their patient (DR-05 fixtures make them).
  await purgeHospitalRecords(prisma, ids);
  await prisma.patient.deleteMany({ where: { id: { in: ids } } });
}
