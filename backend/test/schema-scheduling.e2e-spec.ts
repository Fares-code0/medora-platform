import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

import { type ClinicFixture, createClinicFixture, destroyClinicFixture } from './support/clinic-fixture';

/**
 * The M5.6 verification — scheduling (DB §C, §K8–K9, §S3, §S7, §13.1).
 *
 * Verify: `duration_min > 0` CHECK; status enum includes
 * `awaiting-patient` per ADR-001.
 *
 * The care-relationship table is tested alongside them and matters more
 * than its size suggests: ADR-010 scopes `patient_doctor_assignments` in
 * because RM M7.2's `PatientScopeService` and M37.3's RLS are both
 * unimplementable without it, and it has no UI to catch a mistake later.
 */
describe('scheduling (RM M5.6)', () => {
  let prisma: PrismaService;
  let clinic: ClinicFixture;
  /// Two more doctors, so "one primary, many consulting" is testable with
  /// real distinct care-team members rather than with one row twice.
  let consultingDoctorId: string;
  let thirdDoctorId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    clinic = await createClinicFixture(prisma, 'sched');

    consultingDoctorId = await createExtraDoctor('consult');
    thirdDoctorId = await createExtraDoctor('third');
  });

  async function createExtraDoctor(suffix: string): Promise<string> {
    const roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } })).id;
    const user = await prisma.user.create({
      data: {
        publicId: `usr_sched_${suffix}`,
        firstName: 'Extra',
        lastName: suffix,
        displayName: `Dr. ${suffix}`,
        email: `${suffix}@${clinic.emailDomain}`,
        phone: '+1 555 000 0000',
        roleId,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
    });

    const doctor = await prisma.doctor.create({
      data: {
        userId: user.id,
        fullName: `Dr. ${suffix}`,
        specialty: 'Cardiology',
        licenseNumber: `MED-sched-${suffix}`,
        contactEmail: `${suffix}@${clinic.emailDomain}`,
        contactPhone: '+1 555 000 0000',
      },
    });

    return doctor.id;
  }

  afterAll(async () => {
    await prisma.patientDoctorAssignment.deleteMany({ where: { patientId: clinic.patientId } });
    await destroyClinicFixture(prisma, clinic);
    await prisma.doctor.deleteMany({ where: { id: { in: [consultingDoctorId, thirdDoctorId] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: clinic.emailDomain } } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.appointment.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.patientDoctorAssignment.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.queueEntry.deleteMany({ where: { patientId: clinic.patientId } });
  });

  let counter = 0;
  function appointment(overrides: Record<string, unknown> = {}) {
    counter += 1;
    return {
      publicId: `APT-${String(9000 + counter)}`,
      patientId: clinic.patientId,
      doctorId: clinic.doctorId,
      visitTypeId: clinic.visitTypeId,
      departmentId: clinic.departmentId,
      startsAt: new Date('2026-09-01T15:00:00Z'),
      reason: 'Quarterly diabetes review',
      ...overrides,
    };
  }

  describe('the appointment status vocabulary (ADR-001)', () => {
    it('accepts awaiting-patient, the eighth value', async () => {
      const row = await prisma.appointment.create({
        data: appointment({ status: 'AWAITING_PATIENT' }),
      });

      expect(row.status).toBe('AWAITING_PATIENT');

      // And the database stores the kebab-case literal ADR-001 fixes,
      // not the Prisma member name.
      const [stored] = await prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status::text FROM appointments WHERE id = ${row.id}::uuid
      `;
      expect(stored?.status).toBe('awaiting-patient');
    });

    it('defaults a new appointment to pending', async () => {
      const row = await prisma.appointment.create({ data: appointment() });

      expect(row.status).toBe('PENDING');
      expect(row.priority).toBe('NORMAL');
      expect(row.durationMin).toBe(30);
    });
  });

  describe('duration and identity (DB §9, §C1)', () => {
    it('rejects a zero-length slot', async () => {
      // A zero-length slot occupies no time, so it overlaps nothing: the
      // conflict check would let it be booked on top of anything.
      await expect(prisma.appointment.create({ data: appointment({ durationMin: 0 }) })).rejects.toThrow(
        /appointments_duration_positive/,
      );
    });

    it('rejects a negative duration', async () => {
      await expect(
        prisma.appointment.create({ data: appointment({ durationMin: -30 }) }),
      ).rejects.toThrow(/appointments_duration_positive/);
    });

    it('accepts the shortest real slot', async () => {
      const row = await prisma.appointment.create({ data: appointment({ durationMin: 1 }) });

      expect(row.durationMin).toBe(1);
    });

    it('requires the APT- prefix', async () => {
      await expect(
        prisma.appointment.create({ data: appointment({ publicId: '3001' }) }),
      ).rejects.toThrow(/appointments_public_id_prefix/);
    });
  });

  describe('the P4 reason rule', () => {
    it('refuses a cancellation with no reason', async () => {
      // The reason is what the patient is told and what the audit review
      // reads; a constraint makes "cancelled without one" unrepresentable
      // rather than merely discouraged.
      await expect(
        prisma.appointment.create({ data: appointment({ status: 'CANCELLED' }) }),
      ).rejects.toThrow(/appointments_cancelled_reason_required/);
    });

    it('accepts a cancellation that carries one', async () => {
      const row = await prisma.appointment.create({
        data: appointment({
          status: 'CANCELLED',
          cancelledReason: 'Doctor called to an emergency.',
        }),
      });

      expect(row.status).toBe('CANCELLED');
    });
  });

  describe('transition history (DB §C2, ADR-003 §4)', () => {
    it('keeps the actor name when the account goes', async () => {
      const row = await prisma.appointment.create({ data: appointment() });
      const actor = await prisma.user.findUniqueOrThrow({ where: { id: clinic.userId } });

      await prisma.appointmentEvent.create({
        data: {
          appointmentId: row.id,
          action: 'APPROVE',
          fromStatus: 'PENDING',
          toStatus: 'CONFIRMED',
          actorId: actor.id,
          actorName: actor.displayName,
        },
      });

      // ADR-003 §4: history rows store both the FK and a name snapshot.
      // The FK may go null; the snapshot keeps the trail readable, and
      // serving it stops a later rename rewriting history.
      const events = await prisma.appointmentEvent.findMany({ where: { appointmentId: row.id } });
      expect(events[0]?.actorName).toBe('Dr. Amelia Chen');
      expect(events[0]?.detail).toBeNull();
    });

    it('carries a jsonb detail for actions that need one', async () => {
      const row = await prisma.appointment.create({ data: appointment() });

      const event = await prisma.appointmentEvent.create({
        data: {
          appointmentId: row.id,
          action: 'RESCHEDULE',
          fromStatus: 'CONFIRMED',
          toStatus: 'RESCHEDULED',
          reason: 'Patient requested a later slot.',
          detail: { newStart: '2026-09-02T15:00:00Z' },
        },
      });

      expect(event.detail).toEqual({ newStart: '2026-09-02T15:00:00Z' });
    });

    it('takes the history with the appointment — CASCADE', async () => {
      const row = await prisma.appointment.create({ data: appointment() });
      await prisma.appointmentEvent.create({
        data: { appointmentId: row.id, action: 'CREATED', toStatus: 'PENDING' },
      });

      await prisma.appointment.delete({ where: { id: row.id } });

      expect(await prisma.appointmentEvent.count({ where: { appointmentId: row.id } })).toBe(0);
    });
  });

  describe('reschedule proposals (DB §S3, ADR-001 §3)', () => {
    it('keeps the proposal lifecycle separate from the appointment status', async () => {
      // ADR-001 §3: "the appointment's status and the proposal's status
      // are distinct fields and must not be conflated."
      const row = await prisma.appointment.create({
        data: appointment({ status: 'AWAITING_PATIENT' }),
      });

      const proposal = await prisma.appointmentRescheduleProposal.create({
        data: {
          appointmentId: row.id,
          slot1: new Date('2026-09-02T15:00:00Z'),
          slot2: new Date('2026-09-03T15:00:00Z'),
        },
      });

      expect(row.status).toBe('AWAITING_PATIENT');
      expect(proposal.status).toBe('pending');
      expect(proposal.chosenSlot).toBeNull();
    });

    it('will not accept a slot that was never offered', async () => {
      // Choosing slot 3 of a two-slot proposal reschedules to NULL.
      const row = await prisma.appointment.create({ data: appointment() });

      await expect(
        prisma.appointmentRescheduleProposal.create({
          data: {
            appointmentId: row.id,
            slot1: new Date('2026-09-02T15:00:00Z'),
            status: 'accepted',
            chosenSlot: 3,
          },
        }),
      ).rejects.toThrow(/chosen_slot_offered/);
    });

    it('ties choosing a slot to accepting the proposal, both ways', async () => {
      const row = await prisma.appointment.create({ data: appointment() });

      await expect(
        prisma.appointmentRescheduleProposal.create({
          data: {
            appointmentId: row.id,
            slot1: new Date('2026-09-02T15:00:00Z'),
            status: 'declined',
            chosenSlot: 1,
          },
        }),
      ).rejects.toThrow(/chosen_iff_accepted/);

      await expect(
        prisma.appointmentRescheduleProposal.create({
          data: {
            appointmentId: row.id,
            slot1: new Date('2026-09-02T15:00:00Z'),
            status: 'accepted',
          },
        }),
      ).rejects.toThrow(/chosen_iff_accepted/);
    });

    it('refuses a gap in the offered slots', async () => {
      const row = await prisma.appointment.create({ data: appointment() });

      await expect(
        prisma.appointmentRescheduleProposal.create({
          data: {
            appointmentId: row.id,
            slot1: new Date('2026-09-02T15:00:00Z'),
            slot3: new Date('2026-09-04T15:00:00Z'),
          },
        }),
      ).rejects.toThrow(/slots_contiguous/);
    });
  });

  describe('the care relationship (DB §13.1, ADR-010 group 1)', () => {
    it('allows one live primary and any number of consulting doctors', async () => {
      await prisma.patientDoctorAssignment.create({
        data: { patientId: clinic.patientId, doctorId: clinic.doctorId, role: 'primary' },
      });
      await prisma.patientDoctorAssignment.create({
        data: { patientId: clinic.patientId, doctorId: consultingDoctorId, role: 'consulting' },
      });
      await prisma.patientDoctorAssignment.create({
        data: { patientId: clinic.patientId, doctorId: thirdDoctorId, role: 'consulting' },
      });

      // A second live primary is the one thing the partial unique stops.
      await expect(
        prisma.patientDoctorAssignment.create({
          data: { patientId: clinic.patientId, doctorId: consultingDoctorId, role: 'primary' },
        }),
      ).rejects.toThrow();

      expect(
        await prisma.patientDoctorAssignment.count({ where: { patientId: clinic.patientId } }),
      ).toBe(3);
    });

    it('refuses two live assignments for the same doctor and patient', async () => {
      await prisma.patientDoctorAssignment.create({
        data: { patientId: clinic.patientId, doctorId: consultingDoctorId, role: 'consulting' },
      });

      await expect(
        prisma.patientDoctorAssignment.create({
          data: { patientId: clinic.patientId, doctorId: consultingDoctorId, role: 'consulting' },
        }),
      ).rejects.toThrow();
    });

    it('lets a revoked assignment be replaced — the rule is about now', async () => {
      const first = await prisma.patientDoctorAssignment.create({
        data: { patientId: clinic.patientId, doctorId: clinic.doctorId, role: 'primary' },
      });

      await prisma.patientDoctorAssignment.update({
        where: { id: first.id },
        data: { revokedAt: new Date() },
      });

      // A patient may have had several primaries over time. The partial
      // unique constrains the live ones only.
      const replacement = await prisma.patientDoctorAssignment.create({
        data: { patientId: clinic.patientId, doctorId: clinic.doctorId, role: 'primary' },
      });

      expect(replacement.revokedAt).toBeNull();
      expect(await prisma.patientDoctorAssignment.count({ where: { patientId: clinic.patientId } })).toBe(2);
    });

    it('keeps a revoked assignment rather than deleting it', async () => {
      // "This doctor used to be on this patient's care team" is exactly
      // what an audit review of a past PHI access has to establish.
      const assignment = await prisma.patientDoctorAssignment.create({
        data: { patientId: clinic.patientId, doctorId: clinic.doctorId, role: 'consulting' },
      });
      const revokedAt = new Date();

      const revoked = await prisma.patientDoctorAssignment.update({
        where: { id: assignment.id },
        data: { revokedAt },
      });

      expect(revoked.revokedAt).toEqual(revokedAt);
      expect(revoked.assignedAt).not.toBeNull();
    });

    it('closes the role vocabulary', async () => {
      await expect(
        prisma.patientDoctorAssignment.create({
          data: { patientId: clinic.patientId, doctorId: clinic.doctorId, role: 'supervising' },
        }),
      ).rejects.toThrow(/patient_doctor_assignments_role_check/);
    });
  });

  describe('surveys and the queue (DB §S7, §K8)', () => {
    it('rejects a rating outside 1–5', async () => {
      const row = await prisma.appointment.create({ data: appointment({ status: 'COMPLETED' }) });

      // This feeds `doctors.rating_avg`, so an out-of-range value moves a
      // doctor's published rating rather than staying local.
      await expect(
        prisma.satisfactionSurvey.create({
          data: {
            appointmentId: row.id,
            patientId: clinic.patientId,
            doctorId: clinic.doctorId,
            rating: 6,
          },
        }),
      ).rejects.toThrow(/satisfaction_surveys_rating_range/);
    });

    it('allows only one survey per appointment', async () => {
      const row = await prisma.appointment.create({ data: appointment({ status: 'COMPLETED' }) });
      const survey = {
        appointmentId: row.id,
        patientId: clinic.patientId,
        doctorId: clinic.doctorId,
        rating: 5,
      };

      await prisma.satisfactionSurvey.create({ data: survey });

      await expect(prisma.satisfactionSurvey.create({ data: survey })).rejects.toThrow();
    });

    it('rejects a duplicate queue ticket on the same day', async () => {
      await prisma.queueEntry.create({
        data: {
          ticket: 'A-014',
          patientId: clinic.patientId,
          patientName: 'Khaled Nassar',
          reason: 'Chest tightness',
          estimatedMinutes: 15,
          enqueuedAt: new Date('2026-09-01T09:00:00Z'),
        },
      });

      await expect(
        prisma.queueEntry.create({
          data: {
            ticket: 'A-014',
            patientId: clinic.patientId,
            patientName: 'Someone Else',
            reason: 'Follow-up',
            estimatedMinutes: 10,
            enqueuedAt: new Date('2026-09-01T14:00:00Z'),
          },
        }),
      ).rejects.toThrow();

      // The same ticket the next day is a different ticket.
      const tomorrow = await prisma.queueEntry.create({
        data: {
          ticket: 'A-014',
          patientId: clinic.patientId,
          patientName: 'Khaled Nassar',
          reason: 'Follow-up',
          estimatedMinutes: 10,
          enqueuedAt: new Date('2026-09-02T09:00:00Z'),
        },
      });
      expect(tomorrow.ticket).toBe('A-014');
    });

    it('does not store waiting minutes — they are derived', async () => {
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('queue_entries', 'waiting_room_entries')
          AND column_name IN ('waiting_minutes', 'waitingminutes')
      `;

      expect(columns).toEqual([]);
    });
  });
});
