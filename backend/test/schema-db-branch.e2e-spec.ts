import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

import {
  type ClinicFixture,
  createClinicFixture,
  destroyClinicFixture,
} from './support/clinic-fixture';

/**
 * The Database branch's design (`database/medora.dbml`), integrated.
 *
 * Its 97 tables were compared with this schema column by column
 * (`docs/DATABASE_BRANCH_RECONCILIATION.md`). Every table already existed;
 * migration `20261030130000_db_branch_additive_columns` added what the
 * design has and this schema lacked. These tests pin both halves: that the
 * tables stay, and that the added columns do what the design says.
 *
 * The six appointment columns are derived and trigger-maintained, so they
 * are tested through the writes that should move them, not by reading the
 * DDL.
 */
const DBML_TABLES: readonly string[] = [
  'admin_profiles',
  'ai_conversations',
  'ai_messages',
  'ai_prompt_templates',
  'ai_user_settings',
  'announcements',
  'api_keys',
  'appointment_events',
  'appointment_reschedule_proposals',
  'appointments',
  'audit_events',
  'backups',
  'chronic_conditions',
  'clinic_working_days',
  'communication_access_requests',
  'conversation_participants',
  'conversation_shared_links',
  'conversations',
  'departments',
  'doctor_availability',
  'doctor_time_off',
  'doctor_verification_documents',
  'doctors',
  'document_templates',
  'files',
  'holidays',
  'icd_codes',
  'insurance_providers',
  'lab_analyte_specs',
  'lab_attachments',
  'lab_orders',
  'lab_results',
  'lab_specimens',
  'lab_test_catalogue',
  'lab_timeline_events',
  'login_events',
  'medical_records',
  'medication_strengths',
  'medications',
  'message_attachments',
  'message_flags',
  'messages',
  'notification_preferences',
  'notifications',
  'otp_codes',
  'patient_allergies',
  'patient_chronic_conditions',
  'patient_clinical_alerts',
  'patient_documents',
  'patient_emergency_contacts',
  'patient_insurance',
  'patient_medical_history',
  'patient_medications',
  'patient_notes',
  'patient_studies',
  'patient_vital_signs',
  'patients',
  'permissions',
  'platform_integrations',
  'platform_settings',
  'policies',
  'prescription_history_entries',
  'prescription_notes',
  'prescription_safety_warnings',
  'prescription_timeline_events',
  'prescriptions',
  'queue_entries',
  'record_allergies',
  'record_attachments',
  'record_diagnoses',
  'record_issue_reports',
  'record_medications',
  'record_notes',
  'record_timeline_events',
  'record_treatment_plan_items',
  'resources',
  'role_permissions',
  'roles',
  'rooms',
  'satisfaction_surveys',
  'saved_reports',
  'scheduled_report_runs',
  'scheduled_reports',
  'sessions',
  'staff_members',
  'staff_shift_assignments',
  'trusted_devices',
  'user_activity_log',
  'user_credentials',
  'user_integrations',
  'user_interface_preferences',
  'user_permissions',
  'user_settings',
  'users',
  'verification_tokens',
  'visit_types',
  'waiting_room_entries',
];

/**
 * Each column the migration added, with the type `medora.dbml` gives it.
 * Timestamps are `timestamptz(3)`, the M4.2 convention every timestamp in
 * this schema follows (a JavaScript `Date` holds milliseconds), where the
 * design leaves the precision at PostgreSQL's default.
 */
const ADDED_COLUMNS: readonly (readonly [string, string, string])[] = [
  ['appointments', 'ends_at', 'timestamp(3) with time zone'],
  ['appointments', 'completed_at', 'timestamp(3) with time zone'],
  ['appointments', 'cancelled_at', 'timestamp(3) with time zone'],
  ['appointments', 'cancelled_by', 'uuid'],
  ['appointments', 'no_show_at', 'timestamp(3) with time zone'],
  ['appointments', 'checked_in_at', 'timestamp(3) with time zone'],
  ['visit_types', 'code', 'character varying(30)'],
  ['visit_types', 'description', 'text'],
  ['visit_types', 'default_duration_min', 'smallint'],
  ['chronic_conditions', 'code', 'character varying(30)'],
  ['chronic_conditions', 'description', 'text'],
  ['insurance_providers', 'code', 'character varying(30)'],
  ['insurance_providers', 'phone', 'character varying(30)'],
  ['insurance_providers', 'website', 'text'],
  ['icd_codes', 'description', 'text'],
  ['resources', 'department_id', 'uuid'],
  ['policies', 'body', 'text'],
  ['policies', 'author_id', 'uuid'],
  ['policies', 'effective_date', 'date'],
  ['policies', 'active', 'boolean'],
  ['document_templates', 'title', 'character varying(200)'],
  ['document_templates', 'body', 'text'],
  ['document_templates', 'author_id', 'uuid'],
];

describe('the Database branch design (database/medora.dbml)', () => {
  let prisma: PrismaService;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    clinic = await createClinicFixture(prisma, 'dbbranch');
  });

  afterEach(async () => {
    await prisma.waitingRoomEntry.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.appointment.deleteMany({ where: { patientId: clinic.patientId } });
  });

  afterAll(async () => {
    await destroyClinicFixture(prisma, clinic);
    await prisma.$disconnect();
  });

  let counter = 0;
  function appointment(overrides: Record<string, unknown> = {}) {
    counter += 1;
    return {
      publicId: `APT-DB${String(counter)}`,
      patientId: clinic.patientId,
      doctorId: clinic.doctorId,
      visitTypeId: clinic.visitTypeId,
      startsAt: new Date('2026-09-01T15:00:00Z'),
      durationMin: 45,
      reason: 'Integration probe',
      ...overrides,
    };
  }

  describe('structure', () => {
    it('has every table the design has', async () => {
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY(${[...DBML_TABLES]})
      `;

      expect(rows.map((row) => row.table_name).sort()).toEqual([...DBML_TABLES].sort());
    });

    it('has every column the migration added, with the design type', async () => {
      const rows = await prisma.$queryRaw<Array<{ name: string; type: string }>>`
        SELECT c.table_name || '.' || c.column_name AS name,
               format_type(a.atttypid, a.atttypmod) AS type
        FROM information_schema.columns c
        JOIN pg_attribute a
          ON a.attrelid = ('public.' || c.table_name)::regclass AND a.attname = c.column_name
        WHERE c.table_schema = 'public'
      `;
      const types = new Map(rows.map((row) => [row.name, row.type]));
      const mismatched = ADDED_COLUMNS.filter(
        ([table, column, type]) => types.get(`${table}.${column}`) !== type,
      );

      expect(mismatched).toEqual([]);
    });

    it('widens the four lookup columns to the design width', async () => {
      const rows = await prisma.$queryRaw<Array<{ name: string; length: number }>>`
        SELECT table_name || '.' || column_name AS name, character_maximum_length AS length
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('visit_types', 'name'), ('chronic_conditions', 'name'),
            ('insurance_providers', 'name'), ('icd_codes', 'code'), ('icd_codes', 'label')
          )
        ORDER BY 1
      `;

      expect(rows).toEqual([
        { name: 'chronic_conditions.name', length: 200 },
        { name: 'icd_codes.code', length: 20 },
        { name: 'icd_codes.label', length: 255 },
        { name: 'insurance_providers.name', length: 200 },
        { name: 'visit_types.name', length: 120 },
      ]);
    });

    it('seeds the codes the design gives the shared lookup rows', async () => {
      const consultation = await prisma.visitType.findUniqueOrThrow({ where: { code: 'CONSULT' } });
      const hypertension = await prisma.chronicCondition.findUniqueOrThrow({
        where: { code: 'HTN' },
      });

      expect(consultation.name).toBe('Consultation');
      expect(consultation.defaultDurationMin).toBe(30);
      expect(hypertension.name).toBe('Hypertension');
    });

    it('rejects a default visit duration that could never be booked', async () => {
      await expect(
        prisma.visitType.create({
          data: { name: 'Zero-length probe', position: 99, defaultDurationMin: 0 },
        }),
      ).rejects.toThrow(/visit_types_default_duration_positive/);
    });
  });

  describe('the derived appointment columns', () => {
    it('computes ends_at from the slot, and ignores a value that disagrees', async () => {
      const row = await prisma.appointment.create({
        data: appointment({ endsAt: new Date('2030-01-01T00:00:00Z') }),
      });

      expect(row.endsAt?.toISOString()).toBe('2026-09-01T15:45:00.000Z');
    });

    it('moves ends_at when the slot is rescheduled', async () => {
      const row = await prisma.appointment.create({ data: appointment() });
      const moved = await prisma.appointment.update({
        where: { id: row.id },
        data: { startsAt: new Date('2026-09-02T09:00:00Z'), durationMin: 20 },
      });

      expect(moved.endsAt?.toISOString()).toBe('2026-09-02T09:20:00.000Z');
    });

    it('stamps completed_at on the transition, not before', async () => {
      const row = await prisma.appointment.create({ data: appointment({ status: 'SCHEDULED' }) });
      expect(row.completedAt).toBeNull();

      const done = await prisma.appointment.update({
        where: { id: row.id },
        data: { status: 'COMPLETED' },
      });

      expect(done.completedAt).toBeInstanceOf(Date);
      expect(done.cancelledAt).toBeNull();
      expect(done.noShowAt).toBeNull();
    });

    it('stamps no_show_at on a no-show', async () => {
      const row = await prisma.appointment.create({ data: appointment({ status: 'CONFIRMED' }) });
      const missed = await prisma.appointment.update({
        where: { id: row.id },
        data: { status: 'NO_SHOW' },
      });

      expect(missed.noShowAt).toBeInstanceOf(Date);
    });

    it('invents no time for a row inserted already completed', async () => {
      // An import knows the outcome but not necessarily when it happened.
      const row = await prisma.appointment.create({ data: appointment({ status: 'COMPLETED' }) });

      expect(row.completedAt).toBeNull();
    });

    it('records who cancelled from the event, the way the service writes it', async () => {
      const row = await prisma.appointment.create({ data: appointment() });

      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: row.id },
          data: { status: 'CANCELLED', cancelledReason: 'Patient request' },
        });
        await tx.appointmentEvent.create({
          data: {
            appointmentId: row.id,
            action: 'CANCEL',
            fromStatus: 'PENDING',
            toStatus: 'CANCELLED',
            actorId: clinic.userId,
            actorName: 'Dr. Amelia Chen',
            reason: 'Patient request',
          },
        });
      });

      const cancelled = await prisma.appointment.findUniqueOrThrow({ where: { id: row.id } });
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
      expect(cancelled.cancelledBy).toBe(clinic.userId);
    });

    it('mirrors the live waiting-room check-in, and forgets a removed one', async () => {
      const row = await prisma.appointment.create({ data: appointment({ status: 'CONFIRMED' }) });
      const checkedInAt = new Date('2026-09-01T14:52:00Z');

      const entry = await prisma.waitingRoomEntry.create({
        data: {
          patientId: clinic.patientId,
          appointmentId: row.id,
          patientName: 'Khaled Nassar',
          area: 'Main lobby',
          checkedInAt,
        },
      });

      const arrived = await prisma.appointment.findUniqueOrThrow({ where: { id: row.id } });
      expect(arrived.checkedInAt?.toISOString()).toBe(checkedInAt.toISOString());

      await prisma.waitingRoomEntry.update({
        where: { id: entry.id },
        data: { deletedAt: new Date() },
      });

      const undone = await prisma.appointment.findUniqueOrThrow({ where: { id: row.id } });
      expect(undone.checkedInAt).toBeNull();
    });
  });

  describe('the added links', () => {
    it('unassigns a resource when its department is deleted (SET NULL)', async () => {
      const department = await prisma.department.create({ data: { name: 'Integration probe' } });
      const resource = await prisma.resource.create({
        data: {
          name: 'Probe stock',
          category: 'Consumables',
          location: 'Store B',
          quantity: 10,
          reorderLevel: 2,
          departmentId: department.id,
        },
      });

      await prisma.department.delete({ where: { id: department.id } });

      const orphan = await prisma.resource.findUniqueOrThrow({ where: { id: resource.id } });
      expect(orphan.departmentId).toBeNull();

      await prisma.resource.delete({ where: { id: resource.id } });
    });

    it('defaults a new policy to active', async () => {
      const policy = await prisma.policy.create({
        data: {
          title: 'Integration probe policy',
          category: 'Operations',
          summary: 'Probe.',
          version: 'v0.1',
          authorId: clinic.userId,
          body: 'Body text.',
          effectiveDate: new Date('2026-11-01'),
        },
      });

      expect(policy.active).toBe(true);
      expect(policy.authorId).toBe(clinic.userId);

      await prisma.policy.delete({ where: { id: policy.id } });
    });
  });
});
