import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

/**
 * The M5.4 verification — patients, satellites and availability.
 *
 * The verify step is "vitals CHECK ranges reject out-of-range inserts",
 * and these are the constraints where the cost of being wrong is
 * clinical rather than cosmetic: a systolic of 1280 from a slipped
 * decimal point should fail the write, not reach a chart.
 *
 * Two structural claims are tested alongside them, because both are
 * things the schema *shape* is supposed to guarantee and neither is
 * visible from reading the model:
 *
 *   · blood pressure is two range-checked columns, not the string
 *     `"128/82"` the frontend carries (DB §14.5-14)
 *   · `bmi` is GENERATED ALWAYS, so it cannot be written at all — which
 *     is the difference between "derived" and "stored twice"
 */
describe('patients and availability (RM M5.4)', () => {
  let prisma: PrismaService;
  let roleId: string;
  let patientId: string;
  let doctorId: string;

  const DOMAIN = 'patient-spec.test';
  const MRN_PREFIX = 'SPEC-';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } })).id;

    const user = await prisma.user.create({
      data: {
        publicId: 'usr_patient_spec',
        firstName: 'Amelia',
        lastName: 'Chen',
        displayName: 'Dr. Amelia Chen',
        email: `owner@${DOMAIN}`,
        phone: '+1 555 012 4477',
        roleId,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
    });
    doctorId = (
      await prisma.doctor.create({
        data: {
          userId: user.id,
          fullName: 'Dr. Amelia Chen',
          specialty: 'Internal Medicine',
          licenseNumber: 'MED-SPEC-01',
          contactEmail: `owner@${DOMAIN}`,
          contactPhone: '+1 (555) 012-4477',
        },
      })
    ).id;

    patientId = (
      await prisma.patient.create({
        data: {
          publicId: 'PT-9001',
          mrn: `${MRN_PREFIX}0001`,
          fullName: 'Khaled Nassar',
          dateOfBirth: new Date('1974-03-18'),
          gender: 'MALE',
          bloodType: 'O_POSITIVE',
          phone: '+20 100 214 3387',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.patient.deleteMany({ where: { mrn: { startsWith: MRN_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.patientVitalSign.deleteMany({ where: { patientId } });
    await prisma.patientEmergencyContact.deleteMany({ where: { patientId } });
    await prisma.patientAllergy.deleteMany({ where: { patientId } });
    await prisma.patientMedication.deleteMany({ where: { patientId } });
    await prisma.doctorAvailability.deleteMany({ where: { doctorId } });
    await prisma.doctorTimeOff.deleteMany({ where: { doctorId } });
  });

  /** A clinically ordinary set of vitals, to vary one field at a time. */
  function vitals(overrides: Record<string, unknown> = {}) {
    return {
      patientId,
      bloodPressureSystolic: 128,
      bloodPressureDiastolic: 82,
      heartRateBpm: 76,
      temperatureC: 36.8,
      respiratoryRate: 16,
      oxygenSaturation: 98,
      weightKg: 84,
      heightCm: 178,
      ...overrides,
    };
  }

  describe('vitals ranges (DB §9, §B11)', () => {
    it.each([
      ['bloodPressureSystolic', 1280, 'systolic_range'],
      ['bloodPressureSystolic', 39, 'systolic_range'],
      ['bloodPressureDiastolic', 201, 'diastolic_range'],
      ['heartRateBpm', 19, 'heart_rate_range'],
      ['temperatureC', 46, 'temperature_range'],
      ['respiratoryRate', 3, 'respiratory_rate_range'],
      ['oxygenSaturation', 101, 'oxygen_saturation_range'],
    ])('rejects %s = %s', async (field, value, constraint) => {
      await expect(
        prisma.patientVitalSign.create({ data: vitals({ [field]: value }) }),
      ).rejects.toThrow(new RegExp(constraint));
    });

    it('rejects a non-positive weight or height', async () => {
      await expect(prisma.patientVitalSign.create({ data: vitals({ weightKg: 0 }) })).rejects.toThrow(
        /weight_positive/,
      );

      // A height of 0 is the case the NULLIF guard in the bmi expression
      // exists for. Postgres evaluates a generated column *before* the
      // CHECK constraints, so an unguarded divisor would reject this row
      // with `division_by_zero` — still a rejection, but one that tells
      // the caller nothing about which rule it broke.
      await expect(prisma.patientVitalSign.create({ data: vitals({ heightCm: 0 }) })).rejects.toThrow(
        /height_positive/,
      );
    });

    it('accepts a reading sitting on every boundary at once', async () => {
      // The constraints have to reject without over-rejecting; a range
      // written `> 40` instead of `>= 40` passes every test above.
      const row = await prisma.patientVitalSign.create({
        data: vitals({
          bloodPressureSystolic: 40,
          bloodPressureDiastolic: 20,
          heartRateBpm: 20,
          temperatureC: 30,
          respiratoryRate: 4,
          oxygenSaturation: 0,
        }),
      });

      expect(row.bloodPressureSystolic).toBe(40);
    });
  });

  describe('blood pressure and BMI (DB §14.5-14, §14.5-6)', () => {
    it('stores blood pressure as two numeric columns, not one string', async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'patient_vital_signs' AND column_name LIKE 'blood_pressure%'
        ORDER BY column_name
      `;

      expect(columns).toEqual([
        { column_name: 'blood_pressure_diastolic', data_type: 'smallint' },
        { column_name: 'blood_pressure_systolic', data_type: 'smallint' },
      ]);
    });

    it('computes bmi from weight and height', async () => {
      const row = await prisma.patientVitalSign.create({
        data: vitals({ weightKg: 84, heightCm: 178 }),
      });

      // 84 / 1.78² = 26.51…
      expect(Number(row.bmi)).toBeCloseTo(26.5, 1);
    });

    it('recomputes bmi when the inputs change', async () => {
      const row = await prisma.patientVitalSign.create({ data: vitals() });
      const updated = await prisma.patientVitalSign.update({
        where: { id: row.id },
        data: { weightKg: 96 },
      });

      expect(Number(updated.bmi)).toBeCloseTo(30.3, 1);
    });

    it('refuses a bmi supplied by the caller', async () => {
      // The difference between "derived" and "stored twice". A DEFAULT
      // would have accepted this and let the row contradict itself.
      await expect(
        prisma.$executeRaw`
          INSERT INTO patient_vital_signs
            (patient_id, blood_pressure_systolic, blood_pressure_diastolic, heart_rate_bpm,
             temperature_c, respiratory_rate, oxygen_saturation, weight_kg, height_cm, bmi)
          VALUES (${patientId}::uuid, 128, 82, 76, 36.8, 16, 98, 84, 178, 99.9)
        `,
      ).rejects.toThrow(/cannot insert a non-DEFAULT value into column/);
    });
  });

  describe('partial unique constraints (DB §8)', () => {
    it('allows one primary emergency contact and any number of others', async () => {
      await prisma.patientEmergencyContact.create({
        data: { patientId, name: 'Huda Nassar', relationship: 'Spouse', phone: '+20 100 000 0001' },
      });
      await prisma.patientEmergencyContact.create({
        data: {
          patientId,
          name: 'Omar Nassar',
          relationship: 'Son',
          phone: '+20 100 000 0002',
          isPrimary: false,
        },
      });
      await prisma.patientEmergencyContact.create({
        data: {
          patientId,
          name: 'Layla Nassar',
          relationship: 'Daughter',
          phone: '+20 100 000 0003',
          isPrimary: false,
        },
      });

      await expect(
        prisma.patientEmergencyContact.create({
          data: {
            patientId,
            name: 'Second Primary',
            relationship: 'Brother',
            phone: '+20 100 000 0004',
          },
        }),
      ).rejects.toThrow();

      expect(await prisma.patientEmergencyContact.count({ where: { patientId } })).toBe(3);
    });

    it('rejects the same allergen recorded twice for one patient', async () => {
      await prisma.patientAllergy.create({
        data: { patientId, allergen: 'Penicillin', severity: 'SEVERE', reaction: 'Anaphylaxis' },
      });

      await expect(
        prisma.patientAllergy.create({
          data: { patientId, allergen: 'Penicillin', severity: 'MILD', reaction: 'Rash' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('patient identity (DB §B3)', () => {
    it('requires the PT- prefix', async () => {
      await expect(
        prisma.patient.create({
          data: {
            publicId: '9002',
            mrn: `${MRN_PREFIX}0002`,
            fullName: 'No Prefix',
            dateOfBirth: new Date('1990-01-01'),
            gender: 'FEMALE',
            bloodType: 'A_POSITIVE',
            phone: '+20 100 000 0000',
          },
        }),
      ).rejects.toThrow(/patients_public_id_prefix/);
    });

    it('rejects a date of birth in the future', async () => {
      // Age is derived from this column, so a typo here is a negative age
      // on every screen that shows one.
      await expect(
        prisma.patient.create({
          data: {
            publicId: 'PT-9003',
            mrn: `${MRN_PREFIX}0003`,
            fullName: 'Not Yet Born',
            dateOfBirth: new Date('2099-01-01'),
            gender: 'FEMALE',
            bloodType: 'A_POSITIVE',
            phone: '+20 100 000 0000',
          },
        }),
      ).rejects.toThrow(/patients_date_of_birth_past/);
    });

    it('does not store age — it is derived from the date of birth', async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'patients' AND column_name IN ('age', 'next_appointment', 'has_severe_allergy')
      `;

      expect(columns).toEqual([]);
    });

    it('carries the patient id on every satellite, for the M37 RLS anchor', async () => {
      // ADR-022: every PHI table must carry the owning patient id
      // reachable without a multi-table join, or an RLS policy cannot be
      // written against it later without restructuring.
      const satellites = [
        'patient_allergies',
        'patient_chronic_conditions',
        'patient_emergency_contacts',
        'patient_insurance',
        'patient_documents',
        'patient_notes',
        'patient_medical_history',
        'patient_vital_signs',
        'patient_clinical_alerts',
        'patient_medications',
        'patient_studies',
      ];

      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'patient_id' AND table_name = ANY(${satellites})
      `;

      expect(rows.map((row) => row.table_name).sort()).toEqual([...satellites].sort());
    });
  });

  describe('the availability model (ADR-005)', () => {
    it('models a break as a row inside a working range, not as columns', async () => {
      // ADR-005 §1 rejects break_start/break_end explicitly: those limit
      // a day to one break. Two breaks in one day proves the shape.
      await prisma.doctorAvailability.create({
        data: {
          doctorId,
          weekday: 'MON',
          startTime: new Date('1970-01-01T09:00:00Z'),
          endTime: new Date('1970-01-01T17:00:00Z'),
        },
      });
      await prisma.doctorAvailability.create({
        data: {
          doctorId,
          weekday: 'MON',
          startTime: new Date('1970-01-01T12:00:00Z'),
          endTime: new Date('1970-01-01T12:30:00Z'),
          isBreak: true,
        },
      });
      await prisma.doctorAvailability.create({
        data: {
          doctorId,
          weekday: 'MON',
          startTime: new Date('1970-01-01T15:00:00Z'),
          endTime: new Date('1970-01-01T15:15:00Z'),
          isBreak: true,
        },
      });

      expect(await prisma.doctorAvailability.count({ where: { doctorId, isBreak: true } })).toBe(2);
    });

    it('says "not working" by having no rows, with no second way to say it', async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'doctor_availability' AND column_name IN ('enabled', 'open', 'active')
      `;

      expect(columns).toEqual([]);
      expect(await prisma.doctorAvailability.count({ where: { doctorId, weekday: 'SUN' } })).toBe(0);
    });

    it('refuses an availability range that ends before it starts', async () => {
      await expect(
        prisma.doctorAvailability.create({
          data: {
            doctorId,
            weekday: 'TUE',
            startTime: new Date('1970-01-01T17:00:00Z'),
            endTime: new Date('1970-01-01T09:00:00Z'),
          },
        }),
      ).rejects.toThrow(/doctor_availability_end_after_start/);
    });

    it('closes the time-off vocabularies', async () => {
      await expect(
        prisma.doctorTimeOff.create({
          data: {
            doctorId,
            startsAt: new Date('2026-09-01T00:00:00Z'),
            endsAt: new Date('2026-09-08T00:00:00Z'),
            kind: 'sabbatical',
            autoBehavior: 'block-new',
          },
        }),
      ).rejects.toThrow(/doctor_time_off_kind_check/);

      const ok = await prisma.doctorTimeOff.create({
        data: {
          doctorId,
          startsAt: new Date('2026-09-01T00:00:00Z'),
          endsAt: new Date('2026-09-08T00:00:00Z'),
          kind: 'emergency-block',
          autoBehavior: 'reschedule-existing',
        },
      });
      expect(ok.kind).toBe('emergency-block');
    });
  });

  describe('verification documents (DB §S1)', () => {
    it('will not record a rejection without a reason', async () => {
      const file = await prisma.file.create({
        data: {
          storageKey: 'test/verification/licence.pdf',
          originalName: 'licence.pdf',
          mimeType: 'application/pdf',
          sizeBytes: BigInt(2048),
          checksumSha256: 'b'.repeat(64),
          kind: 'verification_document',
        },
      });

      await expect(
        prisma.doctorVerificationDocument.create({
          data: { doctorId, kind: 'medical_license', fileId: file.id, decision: 'rejected' },
        }),
      ).rejects.toThrow(/reject_reason_required/);

      const ok = await prisma.doctorVerificationDocument.create({
        data: {
          doctorId,
          kind: 'medical_license',
          fileId: file.id,
          decision: 'rejected',
          rejectReason: 'Licence expired before the upload date.',
        },
      });
      expect(ok.decision).toBe('rejected');

      await prisma.doctorVerificationDocument.delete({ where: { id: ok.id } });
      await prisma.file.delete({ where: { id: file.id } });
    });
  });
});
