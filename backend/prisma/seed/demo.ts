import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Demo clinical data (RM M5.10) — **development, test and staging**.
 *
 * DB §14.5-15 is explicit that the mock password `Medora123!` and the
 * mock OTP must never reach production, and ADR-017 §2 allows extra
 * accounts only outside production. The caller gates on `APP_ENV`; this
 * module additionally refuses, so a future caller that forgets cannot
 * quietly seed demo accounts into a live clinic.
 *
 * ## What "equivalent to the frontend roster" means here
 *
 * The five canonical patients of
 * `frontend/src/features/shared-domain/patient-identity/roster.ts`, with
 * their real MRNs, dates of birth, blood types, statuses, risk levels,
 * chronic conditions and allergies. Every module in the frontend reuses
 * exactly these people "so the demo reads as one coherent practice
 * instead of hundreds of generated strangers", and that only stays true
 * if the backend seeds the same five.
 *
 * Dates that are relative in the frontend (`isoDaysFromNow(-730, …)`) are
 * relative here too, so a seeded database is never stale.
 */

/** No password hash is seeded. See `seedDemo` for why. */
export interface DemoPatientSeed {
  readonly publicId: string;
  readonly mrn: string;
  readonly fullName: string;
  readonly dateOfBirth: string;
  readonly gender: 'FEMALE' | 'MALE';
  readonly bloodType: string;
  readonly phone: string;
  readonly status: string;
  readonly riskLevel: string;
  readonly chronicConditions: readonly string[];
  readonly allergies: readonly { readonly allergen: string; readonly severity: string; readonly reaction: string }[];
  readonly registeredDaysAgo: number;
  readonly assignedToPrimaryDoctor: boolean;
}

export const DEMO_PATIENTS: readonly DemoPatientSeed[] = [
  {
    publicId: 'PT-1001',
    mrn: '4411-27',
    fullName: 'Khaled Nassar',
    dateOfBirth: '1974-03-18',
    gender: 'MALE',
    bloodType: 'O_POSITIVE',
    phone: '+20 100 214 3387',
    status: 'FOLLOW_UP',
    riskLevel: 'MEDIUM',
    chronicConditions: ['Hypertension', 'Type 2 diabetes'],
    allergies: [],
    registeredDaysAgo: 730,
    assignedToPrimaryDoctor: true,
  },
  {
    publicId: 'PT-1002',
    mrn: '4436-58',
    fullName: 'Mona Adel',
    dateOfBirth: '1997-08-04',
    gender: 'FEMALE',
    bloodType: 'A_POSITIVE',
    phone: '+20 111 830 2245',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    chronicConditions: ['Asthma'],
    // `hasSevereAllergy: true` in the roster — the flag is derived from
    // exactly this row, never stored (DB §14.5-6).
    allergies: [{ allergen: 'Penicillin', severity: 'SEVERE', reaction: 'Anaphylaxis' }],
    registeredDaysAgo: 9,
    assignedToPrimaryDoctor: true,
  },
  {
    publicId: 'PT-1003',
    mrn: '4468-12',
    fullName: 'Amira Saleh',
    dateOfBirth: '1992-01-27',
    gender: 'FEMALE',
    bloodType: 'B_POSITIVE',
    phone: '+20 122 574 9911',
    status: 'UNDER_TREATMENT',
    riskLevel: 'MEDIUM',
    chronicConditions: ['Hypothyroidism'],
    allergies: [],
    registeredDaysAgo: 365,
    assignedToPrimaryDoctor: true,
  },
  {
    publicId: 'PT-1004',
    mrn: '4472-90',
    fullName: 'Omar Farouk',
    dateOfBirth: '1965-11-09',
    gender: 'MALE',
    bloodType: 'AB_POSITIVE',
    phone: '+20 101 662 7408',
    status: 'CRITICAL',
    riskLevel: 'CRITICAL',
    chronicConditions: ['Chronic kidney disease', 'Hypertension', 'Type 2 diabetes'],
    allergies: [{ allergen: 'Iodine contrast', severity: 'SEVERE', reaction: 'Anaphylactoid reaction' }],
    registeredDaysAgo: 1095,
    assignedToPrimaryDoctor: true,
  },
  {
    publicId: 'PT-1005',
    mrn: '4485-33',
    fullName: 'Layla Mansour',
    dateOfBirth: '1981-06-21',
    gender: 'FEMALE',
    bloodType: 'O_NEGATIVE',
    phone: '+20 112 447 5620',
    status: 'ACTIVE',
    riskLevel: 'HIGH',
    chronicConditions: ['Coronary artery disease'],
    allergies: [{ allergen: 'Sulfa drugs', severity: 'MODERATE', reaction: 'Urticaria' }],
    registeredDaysAgo: 540,
    // The roster assigns this one to Dr. Omar Khalil, which is what makes
    // the "not my patient" case testable at M7.2.
    assignedToPrimaryDoctor: false,
  },
];

/** The five doctors of the roster; the first is the signed-in one. */
export const DEMO_DOCTORS: readonly { readonly name: string; readonly specialty: string; readonly email: string }[] = [
  { name: 'Dr. Amelia Chen', specialty: 'Internal Medicine', email: 'doctor@medora.health' },
  { name: 'Dr. Omar Khalil', specialty: 'Cardiology', email: 'omar.khalil@medora.health' },
  { name: 'Dr. Salma Ibrahim', specialty: 'Endocrinology', email: 'salma.ibrahim@medora.health' },
  { name: 'Dr. Youssef Nabil', specialty: 'Neurology', email: 'youssef.nabil@medora.health' },
  { name: 'Dr. Amira Hassan', specialty: 'Oncology', email: 'amira.hassan@medora.health' },
];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function seedDemo(prisma: PrismaClient): Promise<Record<string, number>> {
  if (process.env['APP_ENV'] === 'production') {
    throw new Error('Refusing to seed demo clinical data into production');
  }

  const doctorRole = await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const department = await prisma.department.findUniqueOrThrow({ where: { name: 'Internal Medicine' } });

  const doctorIds: string[] = [];

  for (const [index, seed] of DEMO_DOCTORS.entries()) {
    // **No credential row is written, in any environment.**
    //
    // The frontend's demo password exists to make a *mock* auth service
    // usable. Seeding a hash for it would put a known-password account
    // in every developer and staging database, and staging databases get
    // restored into places nobody expected. M6 mints credentials through
    // the register flow; until then these accounts cannot sign in, which
    // is the correct state for an account nobody has set a password on.
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      create: {
        publicId: `usr_demo_${String(index + 1)}`,
        firstName: seed.name.replace('Dr. ', '').split(' ')[0] ?? seed.name,
        lastName: seed.name.split(' ').slice(-1)[0] ?? '',
        displayName: seed.name,
        email: seed.email,
        phone: '+20 100 000 0000',
        roleId: doctorRole.id,
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
      update: { displayName: seed.name },
    });

    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        fullName: seed.name,
        specialty: seed.specialty,
        licenseNumber: `MED-DEMO-${String(index + 1).padStart(4, '0')}`,
        contactEmail: seed.email,
        contactPhone: '+20 100 000 0000',
        departmentId: department.id,
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
      },
      update: { specialty: seed.specialty },
    });

    doctorIds.push(doctor.id);
  }

  // ADR-017 §2 — exactly one administrator is seeded.
  await prisma.user.upsert({
    where: { email: 'admin@medora.health' },
    create: {
      publicId: 'usr_demo_admin',
      firstName: 'Marcus',
      lastName: 'Reed',
      displayName: 'Marcus Reed',
      email: 'admin@medora.health',
      phone: '+1 (555) 018-0001',
      roleId: adminRole.id,
      emailVerifiedAt: new Date(),
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
    },
    update: {},
  });

  const primaryDoctorId = doctorIds[0] ?? '';
  const secondDoctorId = doctorIds[1] ?? primaryDoctorId;
  let allergyCount = 0;
  let conditionCount = 0;

  for (const seed of DEMO_PATIENTS) {
    const assignedDoctorId = seed.assignedToPrimaryDoctor ? primaryDoctorId : secondDoctorId;

    const patient = await prisma.patient.upsert({
      where: { mrn: seed.mrn },
      create: {
        publicId: seed.publicId,
        mrn: seed.mrn,
        fullName: seed.fullName,
        dateOfBirth: new Date(seed.dateOfBirth),
        gender: seed.gender as 'MALE',
        bloodType: seed.bloodType as 'O_POSITIVE',
        phone: seed.phone,
        status: seed.status as 'ACTIVE',
        riskLevel: seed.riskLevel as 'LOW',
        registeredAt: daysAgo(seed.registeredDaysAgo),
        assignedDoctorId,
      },
      update: { status: seed.status as 'ACTIVE', riskLevel: seed.riskLevel as 'LOW', assignedDoctorId },
    });

    // The care relationship, which is what authorization actually reads
    // (ADR-010 group 1). `assigned_doctor_id` is the display shortcut;
    // this row is the scope.
    const existing = await prisma.patientDoctorAssignment.findFirst({
      where: { patientId: patient.id, doctorId: assignedDoctorId, revokedAt: null },
    });
    if (existing === null) {
      await prisma.patientDoctorAssignment.create({
        data: { patientId: patient.id, doctorId: assignedDoctorId, role: 'primary' },
      });
    }

    for (const condition of seed.chronicConditions) {
      const row = await prisma.chronicCondition.findUniqueOrThrow({ where: { name: condition } });
      await prisma.patientChronicCondition.upsert({
        where: { patientId_conditionId: { patientId: patient.id, conditionId: row.id } },
        create: { patientId: patient.id, conditionId: row.id },
        update: {},
      });
      conditionCount += 1;
    }

    for (const allergy of seed.allergies) {
      // PatientAllergy uniqueness is split across two partial indexes: one
      // for legacy rows without a hospital medical record and one for
      // hospital-owned rows. PostgreSQL cannot infer either partial index
      // from Prisma's generic ON CONFLICT target, so use an explicit lookup.
      const existingAllergy = await prisma.patientAllergy.findFirst({
        where: {
          patientId: patient.id,
          allergen: allergy.allergen,
          hospitalMedicalRecordId: null,
        },
      });
      const allergyData = {
        severity: allergy.severity as 'SEVERE',
        reaction: allergy.reaction,
      };
      if (existingAllergy === null) {
        await prisma.patientAllergy.create({
          data: {
            patientId: patient.id,
            allergen: allergy.allergen,
            ...allergyData,
          },
        });
      } else {
        await prisma.patientAllergy.update({
          where: { id: existingAllergy.id },
          data: allergyData,
        });
      }
      allergyCount += 1;
    }
  }

  return {
    demoDoctors: DEMO_DOCTORS.length,
    demoPatients: DEMO_PATIENTS.length,
    demoConditions: conditionCount,
    demoAllergies: allergyCount,
  };
}
