import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

/**
 * The M5.3 verification — people and clinic master data (DB §B1–B2, §K).
 *
 * The verify step is "migration applies; FK cycle resolved", and the
 * second half is the interesting one. `departments.head_staff_id` and
 * `staff_members.department_id` point at each other, so the test that
 * matters is not that the tables exist but that a head can actually be
 * assigned — which is only possible because M5.1 created `departments`
 * without the constraint and M5.3 added it by ALTER.
 */
describe('people and clinic master data (RM M5.3)', () => {
  let prisma: PrismaService;
  let roleId: string;
  let departmentId: string;

  const DOMAIN = 'people-spec.test';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } })).id;
    departmentId = (await prisma.department.findUniqueOrThrow({ where: { name: 'Cardiology' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.department.updateMany({
      where: { headStaffId: { not: null } },
      data: { headStaffId: null },
    });
    await prisma.staffMember.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  });

  let counter = 0;
  function next(): string {
    counter += 1;
    return String(counter);
  }

  async function createDoctor(overrides: Record<string, unknown> = {}) {
    const n = next();
    const user = await prisma.user.create({
      data: {
        publicId: `usr_people_${n}`,
        firstName: 'Amelia',
        lastName: 'Chen',
        displayName: 'Dr. Amelia Chen',
        email: `doctor-${n}@${DOMAIN}`,
        phone: '+1 555 012 4477',
        roleId,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
    });

    return prisma.doctor.create({
      data: {
        userId: user.id,
        fullName: 'Dr. Amelia Chen',
        specialty: 'Internal Medicine',
        licenseNumber: `MED-${n.padStart(6, '0')}`,
        contactEmail: `doctor-${n}@${DOMAIN}`,
        contactPhone: '+1 (555) 012-4477',
        ...overrides,
      },
    });
  }

  function staff(overrides: Record<string, unknown> = {}) {
    const n = next();
    return {
      name: 'Nurse Salma Ibrahim',
      role: 'NURSE' as const,
      title: 'Head Nurse',
      departmentId,
      phone: '+20 100 000 0000',
      email: `staff-${n}@${DOMAIN}`,
      workingHours: 'Mon–Fri 08:00–16:00',
      ...overrides,
    };
  }

  describe('the FK cycle (DB §14.2)', () => {
    it('lets a department point at a staff member who points back at it', async () => {
      // The cycle in one write pair. Before M5.3's deferred ALTER this
      // was not expressible; before M5.1 created `departments` without
      // the constraint, neither table could have been created first.
      const head = await prisma.staffMember.create({ data: staff() });

      const department = await prisma.department.update({
        where: { id: departmentId },
        data: { headStaffId: head.id },
      });

      expect(department.headStaffId).toBe(head.id);
      expect(head.departmentId).toBe(departmentId);
    });

    it('keeps the department when its head is removed — SET NULL', async () => {
      const head = await prisma.staffMember.create({ data: staff() });
      await prisma.department.update({
        where: { id: departmentId },
        data: { headStaffId: head.id },
      });

      await prisma.staffMember.delete({ where: { id: head.id } });

      const department = await prisma.department.findUniqueOrThrow({ where: { id: departmentId } });
      expect(department.headStaffId).toBeNull();
    });

    it('refuses to delete a department that still has staff — RESTRICT', async () => {
      await prisma.staffMember.create({ data: staff() });

      await expect(prisma.department.delete({ where: { id: departmentId } })).rejects.toThrow();
    });
  });

  describe('doctor profile constraints (DB §B1, ADR-005)', () => {
    it('rejects an experience figure outside 0–70', async () => {
      await expect(createDoctor({ yearsOfExperience: 71 })).rejects.toThrow(
        /doctors_years_of_experience_range/,
      );
    });

    it('rejects a rating outside 0–5', async () => {
      await expect(createDoctor({ ratingAvg: 5.5 })).rejects.toThrow(/doctors_rating_avg_range/);
    });

    it('rejects a slot length outside the fixed set the contract names', async () => {
      // ADR-005 §2 fixes {15,20,30,45,60}. 25 would render a grid the
      // booking UI has no column widths for.
      await expect(createDoctor({ defaultDurationMin: 25 })).rejects.toThrow(
        /doctors_default_duration_allowed/,
      );
    });

    it('rejects a negative booking buffer', async () => {
      // A negative buffer overlaps adjacent appointments instead of
      // separating them — ADR-005 §4 rule 4 extends the slot by it.
      await expect(createDoctor({ bufferMin: -5 })).rejects.toThrow(
        /doctors_buffer_non_negative/,
      );
    });

    it('caps the bounded string lists', async () => {
      await expect(createDoctor({ skills: Array.from({ length: 13 }, (_, i) => `s${String(i)}`) }))
        .rejects.toThrow(/doctors_skills_max/);
      await expect(
        createDoctor({ languages: Array.from({ length: 9 }, (_, i) => `l${String(i)}`) }),
      ).rejects.toThrow(/doctors_languages_max/);
    });

    it('caps the biography at 600 characters', async () => {
      await expect(createDoctor({ biography: 'x'.repeat(601) })).rejects.toThrow(
        /doctors_biography_length/,
      );
    });

    it('accepts a profile at every boundary value', async () => {
      const doctor = await createDoctor({
        yearsOfExperience: 70,
        ratingAvg: 5,
        defaultDurationMin: 60,
        bufferMin: 0,
        biography: 'x'.repeat(600),
        skills: Array.from({ length: 12 }, (_, i) => `s${String(i)}`),
      });

      expect(doctor.yearsOfExperience).toBe(70);
      expect(doctor.verificationStatus).toBe('PENDING');
      expect(doctor.practiceStatus).toBe('ACTIVE');
    });

    it('allows only one doctor row per account', async () => {
      const doctor = await createDoctor();

      await expect(
        prisma.doctor.create({
          data: {
            userId: doctor.userId,
            fullName: 'Dr. Someone Else',
            specialty: 'Cardiology',
            licenseNumber: 'MED-999999',
            contactEmail: `dupe@${DOMAIN}`,
            contactPhone: '+1 555 000 0000',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('specialty identity (ADR-010 group 4)', () => {
    it('allows many specialties but only one flagged primary', async () => {
      const doctor = await createDoctor();
      const [cardiology, neurology, oncology] = await Promise.all([
        prisma.specialty.findUniqueOrThrow({ where: { name: 'Cardiology' } }),
        prisma.specialty.findUniqueOrThrow({ where: { name: 'Neurology' } }),
        prisma.specialty.findUniqueOrThrow({ where: { name: 'Oncology' } }),
      ]);

      await prisma.doctorSpecialty.create({
        data: { doctorId: doctor.id, specialtyId: cardiology.id, isPrimary: true },
      });
      // A second, non-primary specialty is fine.
      await prisma.doctorSpecialty.create({
        data: { doctorId: doctor.id, specialtyId: neurology.id },
      });

      await expect(
        prisma.doctorSpecialty.create({
          data: { doctorId: doctor.id, specialtyId: oncology.id, isPrimary: true },
        }),
      ).rejects.toThrow();

      expect(await prisma.doctorSpecialty.count({ where: { doctorId: doctor.id } })).toBe(2);
    });
  });

  describe('clinic resources (DB §K3–K6)', () => {
    it('requires a shift mask to cover exactly seven days', async () => {
      const member = await prisma.staffMember.create({ data: staff() });

      await expect(
        prisma.staffShiftAssignment.create({
          data: {
            staffId: member.id,
            kind: 'MORNING',
            days: [true, true, true, true, true, false],
          },
        }),
      ).rejects.toThrow(/staff_shift_assignments_days_is_week/);

      const ok = await prisma.staffShiftAssignment.create({
        data: {
          staffId: member.id,
          kind: 'EVENING',
          days: [true, true, true, true, true, false, false],
        },
      });
      expect(ok.days).toHaveLength(7);
    });

    it('refuses a clinic day that closes before it opens', async () => {
      await expect(
        prisma.clinicWorkingDay.create({
          data: {
            day: 'SUN',
            open: true,
            startTime: new Date('1970-01-01T17:00:00Z'),
            endTime: new Date('1970-01-01T09:00:00Z'),
          },
        }),
      ).rejects.toThrow(/clinic_working_days_end_after_start/);
    });

    it('keys clinic hours by weekday, so a duplicate day is impossible', async () => {
      const monday = await prisma.clinicWorkingDay.upsert({
        where: { day: 'MON' },
        create: {
          day: 'MON',
          open: true,
          startTime: new Date('1970-01-01T08:00:00Z'),
          endTime: new Date('1970-01-01T17:00:00Z'),
        },
        update: {},
      });

      expect(monday.day).toBe('MON');

      await expect(
        prisma.clinicWorkingDay.create({
          data: {
            day: 'MON',
            open: true,
            startTime: new Date('1970-01-01T08:00:00Z'),
            endTime: new Date('1970-01-01T17:00:00Z'),
          },
        }),
      ).rejects.toThrow();

      await prisma.clinicWorkingDay.delete({ where: { day: 'MON' } });
    });

    it('refuses a room with no capacity and negative stock', async () => {
      await expect(
        prisma.room.create({
          data: { name: `room-${next()}`, kind: 'CONSULTATION', capacity: 0, departmentId },
        }),
      ).rejects.toThrow(/rooms_capacity_positive/);

      await expect(
        prisma.resource.create({
          data: {
            name: 'Gloves',
            category: 'Consumables',
            location: 'Store A',
            quantity: -1,
            reorderLevel: 10,
          },
        }),
      ).rejects.toThrow(/resources_quantity_non_negative/);
    });
  });
});
