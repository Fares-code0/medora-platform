import type { HospitalStaffAffiliation, PrismaClient } from '../../src/generated/prisma/client';
import { DEMO_ACCOUNTS } from './demo-accounts';
/**
 * Require the named disposable CI database before this development-only seed
 * can connect. A development label by itself is not evidence that a database
 * is disposable.
 */
export function assertMultiHospitalSeedEnvironment(): string {
  if (process.env['APP_ENV'] !== 'development' || process.env['MEDORA_DISPOSABLE_DB'] !== 'true') {
    throw new Error(
      'Refusing multi-hospital seed unless APP_ENV=development and MEDORA_DISPOSABLE_DB=true',
    );
  }

  const rawDatabaseUrl = process.env['DATABASE_URL'];
  if (rawDatabaseUrl === undefined || rawDatabaseUrl.length === 0) {
    throw new Error('Refusing multi-hospital seed because DATABASE_URL is not set');
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error('Refusing multi-hospital seed because DATABASE_URL is invalid');
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname);
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !isLoopback ||
    databaseUrl.port !== '5432' ||
    databaseName !== 'medora_test'
  ) {
    throw new Error(
      'Refusing multi-hospital seed unless DATABASE_URL targets loopback PostgreSQL medora_test:5432',
    );
  }

  return rawDatabaseUrl;
}

/**
 * Fictional multi-hospital fixtures for a local development database.
 * This seed is intentionally separate from the shared reference-data seed:
 * the separate runner also requires the explicit disposable-database marker and URL.
 *
 * It never claims legacy patient or clinical rows. The only patients used
 * here are the canonical fictional patients created by `seedDemo`; each
 * hospital gets a distinct HospitalMedicalRecord anchor. Clinical examples
 * are created directly against those new anchors.
 */
export async function seedMultiHospital(prisma: PrismaClient): Promise<Record<string, number>> {
  assertMultiHospitalSeedEnvironment();

  const [internalMedicine, cardiology] = await Promise.all([
    prisma.department.findUniqueOrThrow({ where: { name: 'Internal Medicine' } }),
    prisma.department.findUniqueOrThrow({ where: { name: 'Cardiology' } }),
  ]);

  const hospitals = await Promise.all([
    prisma.hospital.upsert({
      where: { publicId: 'hosp_demo_northstar' },
      create: {
        publicId: 'hosp_demo_northstar',
        name: 'Northstar General Hospital',
        legalName: 'Northstar General Hospital (Fictional Demo)',
        timezone: 'America/New_York',
        email: 'northstar@example.test',
        phone: '+1-555-0101',
      },
      update: {},
    }),
    prisma.hospital.upsert({
      where: { publicId: 'hosp_demo_harborview' },
      create: {
        publicId: 'hosp_demo_harborview',
        name: 'Harborview Medical Center',
        legalName: 'Harborview Medical Center (Fictional Demo)',
        timezone: 'America/Los_Angeles',
        email: 'harborview@example.test',
        phone: '+1-555-0102',
      },
      update: {},
    }),
  ]);

  const [northstar, harborview] = hospitals;
  const locationRows = await Promise.all([
    prisma.hospitalLocation.upsert({
      where: { hospitalId_name: { hospitalId: northstar.id, name: 'Northstar Main Campus' } },
      create: {
        hospitalId: northstar.id,
        name: 'Northstar Main Campus',
        addressLine1: '100 Example Avenue',
        city: 'Boston',
        region: 'MA',
        postalCode: '02110',
        countryCode: 'US',
        timezone: 'America/New_York',
      },
      update: {},
    }),
    prisma.hospitalLocation.upsert({
      where: { hospitalId_name: { hospitalId: harborview.id, name: 'Harborview Central' } },
      create: {
        hospitalId: harborview.id,
        name: 'Harborview Central',
        addressLine1: '200 Sample Street',
        city: 'Seattle',
        region: 'WA',
        postalCode: '98101',
        countryCode: 'US',
        timezone: 'America/Los_Angeles',
      },
      update: {},
    }),
  ]);

  const clinics = await Promise.all([
    prisma.clinic.upsert({
      where: { hospitalId_name: { hospitalId: northstar.id, name: 'Northstar Outpatient Clinic' } },
      create: {
        publicId: 'clinic_demo_northstar',
        hospitalId: northstar.id,
        name: 'Northstar Outpatient Clinic',
      },
      update: {},
    }),
    prisma.clinic.upsert({
      where: { hospitalId_name: { hospitalId: harborview.id, name: 'Harborview Family Clinic' } },
      create: {
        publicId: 'clinic_demo_harborview',
        hospitalId: harborview.id,
        name: 'Harborview Family Clinic',
      },
      update: {},
    }),
  ]);

  const departmentRows = await Promise.all([
    prisma.hospitalDepartment.upsert({
      where: { hospitalId_name: { hospitalId: northstar.id, name: 'Internal Medicine' } },
      create: {
        hospitalId: northstar.id,
        name: 'Internal Medicine',
        catalogueDepartmentId: internalMedicine.id,
      },
      update: {},
    }),
    prisma.hospitalDepartment.upsert({
      where: { hospitalId_name: { hospitalId: northstar.id, name: 'Cardiology' } },
      create: {
        hospitalId: northstar.id,
        name: 'Cardiology',
        catalogueDepartmentId: cardiology.id,
      },
      update: {},
    }),
    prisma.hospitalDepartment.upsert({
      where: { hospitalId_name: { hospitalId: harborview.id, name: 'Internal Medicine' } },
      create: {
        hospitalId: harborview.id,
        name: 'Internal Medicine',
        catalogueDepartmentId: internalMedicine.id,
      },
      update: {},
    }),
    prisma.hospitalDepartment.upsert({
      where: { hospitalId_name: { hospitalId: harborview.id, name: 'Cardiology' } },
      create: {
        hospitalId: harborview.id,
        name: 'Cardiology',
        catalogueDepartmentId: cardiology.id,
      },
      update: {},
    }),
  ]);

  const northstarInternalMedicine = departmentRows[0];
  const northstarCardiology = departmentRows[1];
  const harborviewInternalMedicine = departmentRows[2];
  const harborviewCardiology = departmentRows[3];

  const doctorSeeds = [
    {
      email: 'doctor@medora.health',
      hospitalId: northstar.id,
      department: northstarInternalMedicine,
    },
    {
      email: 'salma.ibrahim@medora.health',
      hospitalId: northstar.id,
      department: northstarInternalMedicine,
    },
    {
      email: 'youssef.nabil@medora.health',
      hospitalId: northstar.id,
      department: northstarCardiology,
    },
    {
      email: 'omar.khalil@medora.health',
      hospitalId: harborview.id,
      department: harborviewCardiology,
    },
    {
      email: 'amira.hassan@medora.health',
      hospitalId: harborview.id,
      department: harborviewInternalMedicine,
    },
  ];

  const doctorRole = await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } });
  let employmentCount = 0;
  let roleAssignmentCount = 0;
  const employmentByEmail = new Map<
    string,
    { id: string; doctorId: string; userId: string; hospitalId: string }
  >();

  for (const seed of doctorSeeds) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: seed.email },
      include: { doctor: true },
    });
    if (user.doctor === null) throw new Error(`Missing seeded doctor profile for ${seed.email}`);

    const existingForDoctor = await prisma.doctorEmployment.findMany({
      where: { doctorId: user.doctor.id },
      orderBy: { startedAt: 'asc' },
    });
    const existing = existingForDoctor.find(
      (employment) => employment.hospitalId === seed.hospitalId && employment.endedAt === null,
    );
    const activeElsewhere = existingForDoctor.find(
      (employment) => employment.endedAt === null && employment.hospitalId !== seed.hospitalId,
    );
    if (existing === undefined && activeElsewhere !== undefined) continue;

    const employment =
      existing ??
      (await prisma.doctorEmployment.create({
        data: {
          doctorId: user.doctor.id,
          hospitalId: seed.hospitalId,
          hospitalDepartmentId: seed.department.id,
        },
      }));
    if (existing === undefined) employmentCount += 1;
    employmentByEmail.set(seed.email, {
      id: employment.id,
      doctorId: user.doctor.id,
      userId: user.id,
      hospitalId: seed.hospitalId,
    });

    const priorAssignment = await prisma.hospitalRoleAssignment.findFirst({
      where: { userId: user.id, hospitalId: seed.hospitalId, roleId: doctorRole.id },
    });
    if (priorAssignment === null) {
      await prisma.hospitalRoleAssignment.create({
        data: {
          userId: user.id,
          hospitalId: seed.hospitalId,
          roleId: doctorRole.id,
          sourceDoctorEmploymentId: employment.id,
        },
      });
      roleAssignmentCount += 1;
    }
  }

  const staffSeeds = [
    {
      email: 'reception@medora.health',
      hospitalDepartments: [northstarInternalMedicine, harborviewInternalMedicine],
    },
    {
      email: 'lab@medora.health',
      hospitalDepartments: [northstarInternalMedicine, harborviewInternalMedicine],
    },
    {
      email: 'pharmacy@medora.health',
      hospitalDepartments: [northstarInternalMedicine, harborviewInternalMedicine],
    },
    {
      email: 'nurse@medora.health',
      hospitalDepartments: [northstarCardiology, harborviewCardiology],
    },
  ];
  let affiliationCount = 0;

  for (const seed of staffSeeds) {
    const account = DEMO_ACCOUNTS.find((candidate) => candidate.email === seed.email);
    if (account === undefined || account.profile.kind !== 'staff') {
      throw new Error(`Missing fictional staff account definition for ${seed.email}`);
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { code: account.roleCode } });
    const staffRole = account.profile.staffRole;
    // This guarded disposable-development seed creates account/profile
    // fixtures without passwords or credentials. The general seed keeps
    // credential provisioning disabled unless APP_ENV is explicitly
    // development; CI intentionally seeds clinical data with it unset.
    const user = await prisma.user.upsert({
      where: { email: account.email },
      create: {
        publicId: account.publicId,
        firstName: account.firstName,
        lastName: account.lastName,
        displayName: account.displayName,
        email: account.email,
        phone: '+20 100 000 0000',
        roleId: role.id,
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
      update: {},
    });
    if (user.deletedAt !== null || user.status !== 'ACTIVE') {
      throw new Error(`Staff fixture account ${seed.email} is not active`);
    }
    const existingStaff = await prisma.staffMember.findUnique({
      where: { email: account.email },
    });
    if (existingStaff !== null && existingStaff.deletedAt !== null) {
      throw new Error(`Staff profile ${seed.email} is soft-deleted`);
    }
    const staffMember =
      existingStaff ??
      (await prisma.staffMember.create({
        data: {
          userId: user.id,
          name: account.displayName,
          role: staffRole,
          title: account.profile.title,
          departmentId: internalMedicine.id,
          phone: '+20 100 000 0000',
          email: account.email,
          workingHours: 'Sun–Thu 09:00–17:00',
        },
      }));
    if (existingStaff?.userId === null) {
      await prisma.staffMember.update({
        where: { id: existingStaff.id },
        data: { userId: user.id },
      });
    } else if (existingStaff !== null && existingStaff.userId !== user.id) {
      throw new Error(`Staff profile ${seed.email} is linked to a different user`);
    }

    for (const department of seed.hospitalDepartments) {
      const hospitalId = department.hospitalId;
      const existing: HospitalStaffAffiliation | null =
        await prisma.hospitalStaffAffiliation.findFirst({
          where: { staffId: staffMember.id, hospitalId, endedAt: null },
          orderBy: { startedAt: 'asc' },
        });
      const affiliation: HospitalStaffAffiliation =
        existing ??
        (await prisma.hospitalStaffAffiliation.create({
          data: {
            staffId: staffMember.id,
            hospitalId,
            hospitalDepartmentId: department.id,
          },
        }));
      if (existing === null) affiliationCount += 1;

      const priorAssignment = await prisma.hospitalRoleAssignment.findFirst({
        where: { userId: user.id, hospitalId, roleId: role.id },
      });
      if (priorAssignment === null) {
        await prisma.hospitalRoleAssignment.create({
          data: {
            userId: user.id,
            hospitalId,
            roleId: role.id,
            sourceStaffAffiliationId: affiliation.id,
          },
        });
        roleAssignmentCount += 1;
      }
    }
  }

  const patients = await prisma.patient.findMany({
    where: { mrn: { in: ['4411-27', '4436-58'] } },
    orderBy: { mrn: 'asc' },
  });
  if (patients.length !== 2)
    throw new Error('The canonical fictional demo patient rows must be seeded first');

  const patientRecords = new Map<string, { id: string; patientId: string; hospitalId: string }>();
  let medicalRecordCount = 0;
  for (const hospital of hospitals) {
    for (const patient of patients) {
      const existing = await prisma.hospitalMedicalRecord.findUnique({
        where: { patientId_hospitalId: { patientId: patient.id, hospitalId: hospital.id } },
      });
      const medicalRecord =
        existing ??
        (await prisma.hospitalMedicalRecord.create({
          data: { patientId: patient.id, hospitalId: hospital.id },
        }));
      if (existing === null) medicalRecordCount += 1;
      patientRecords.set(`${hospital.id}:${patient.mrn}`, {
        id: medicalRecord.id,
        patientId: patient.id,
        hospitalId: hospital.id,
      });
    }
  }

  const hospitalAllergies = [
    {
      hospital: northstar,
      patient: patients[0],
      allergen: 'Demo-only pollen',
      severity: 'MILD' as const,
      reaction: 'Seasonal irritation',
    },
    {
      hospital: harborview,
      patient: patients[1],
      allergen: 'Demo-only adhesive',
      severity: 'MODERATE' as const,
      reaction: 'Localized irritation',
    },
  ];
  let clinicalCount = 0;
  for (const sample of hospitalAllergies) {
    if (sample === undefined || sample.patient === undefined) continue;
    const anchor = patientRecords.get(`${sample.hospital.id}:${sample.patient.mrn}`);
    if (anchor === undefined)
      throw new Error('Missing hospital medical record for fictional clinical sample');
    const existing = await prisma.patientAllergy.findFirst({
      where: { hospitalMedicalRecordId: anchor.id, allergen: sample.allergen },
    });
    if (existing === null) {
      await prisma.patientAllergy.create({
        data: {
          patientId: sample.patient.id,
          hospitalId: sample.hospital.id,
          hospitalMedicalRecordId: anchor.id,
          allergen: sample.allergen,
          severity: sample.severity,
          reaction: sample.reaction,
        },
      });
      clinicalCount += 1;
    }
  }

  const [visitType, northstarPatient, harborviewPatient] = await Promise.all([
    prisma.visitType.findFirstOrThrow({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.patient.findUniqueOrThrow({ where: { mrn: '4411-27' } }),
    prisma.patient.findUniqueOrThrow({ where: { mrn: '4436-58' } }),
  ]);
  const slotSpecs = [
    {
      id: 'a3000000-0000-4000-8000-000000000001',
      publicId: 'APT-MH-0001',
      hospital: northstar,
      patient: northstarPatient,
      employment: employmentByEmail.get('doctor@medora.health'),
      department: northstarInternalMedicine,
      startsAt: new Date('2030-01-15T15:00:00.000Z'),
    },
    {
      id: 'a3000000-0000-4000-8000-000000000002',
      publicId: 'APT-MH-0002',
      hospital: harborview,
      patient: harborviewPatient,
      employment: employmentByEmail.get('omar.khalil@medora.health'),
      department: harborviewCardiology,
      startsAt: new Date('2030-01-16T18:00:00.000Z'),
    },
  ];
  let appointmentCount = 0;
  for (const spec of slotSpecs) {
    if (spec.employment === undefined) continue;
    const slot = await prisma.publishedSlot.upsert({
      where: { id: spec.id },
      create: {
        id: spec.id,
        hospitalId: spec.hospital.id,
        doctorEmploymentId: spec.employment.id,
        startsAt: spec.startsAt,
        durationMinutes: 30,
      },
      update: {},
    });
    const anchor = patientRecords.get(`${spec.hospital.id}:${spec.patient.mrn}`);
    if (anchor === undefined)
      throw new Error('Missing hospital medical record for fictional appointment');
    const existing = await prisma.appointment.findUnique({ where: { publicId: spec.publicId } });
    if (existing === null) {
      await prisma.appointment.create({
        data: {
          publicId: spec.publicId,
          patientId: spec.patient.id,
          doctorId: spec.employment.doctorId,
          departmentId: spec.department.catalogueDepartmentId,
          visitTypeId: visitType.id,
          startsAt: slot.startsAt,
          durationMin: slot.durationMinutes,
          reason: 'Fictional multi-hospital development appointment',
          hospitalId: spec.hospital.id,
          hospitalDepartmentId: spec.department.id,
          hospitalMedicalRecordId: anchor.id,
          doctorEmploymentId: spec.employment.id,
          publishedSlotId: slot.id,
        },
      });
      appointmentCount += 1;
    }
  }

  return {
    hospitals: hospitals.length,
    locations: locationRows.length,
    clinics: clinics.length,
    hospitalDepartments: departmentRows.length,
    doctorEmployments: employmentCount,
    staffAffiliations: affiliationCount,
    hospitalRoleAssignments: roleAssignmentCount,
    hospitalMedicalRecords: medicalRecordCount,
    hospitalClinicalSamples: clinicalCount,
    publishedSlots: slotSpecs.length,
    appointments: appointmentCount,
  };
}
