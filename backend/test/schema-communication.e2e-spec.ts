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
 * The M5.9 verification — communication, AI, reports and settings.
 *
 * Verify: `notification_preferences.cat_security = true` CHECK proven;
 * `ai_conversations` context CHECK proven.
 *
 * Both are constraints DB §9 asks for by name, and both exist because a
 * rule enforced only in the UI is one API client away from being no rule
 * at all.
 */
describe('communication, AI and settings (RM M5.9)', () => {
  let prisma: PrismaService;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    clinic = await createClinicFixture(prisma, 'comms');
  });

  afterAll(async () => {
    await prisma.aiConversation.deleteMany({ where: { ownerId: clinic.userId } });
    await prisma.conversation.deleteMany({ where: { patientId: clinic.patientId } });
    await destroyClinicFixture(prisma, clinic);
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.scheduledReport.deleteMany({ where: { ownerId: clinic.userId } });
    await prisma.notificationPreference.deleteMany({ where: { userId: clinic.userId } });
    await prisma.aiConversation.deleteMany({ where: { ownerId: clinic.userId } });
    await prisma.aiUserSetting.deleteMany({ where: { userId: clinic.userId } });
    await prisma.userInterfacePreference.deleteMany({ where: { userId: clinic.userId } });
    await prisma.userSetting.deleteMany({ where: { userId: clinic.userId } });
    await prisma.conversation.deleteMany({ where: { patientId: clinic.patientId } });
  });

  describe('security notifications cannot be switched off (DB §9, §G7)', () => {
    it('rejects a preference row with security disabled', async () => {
      // DB §G7 says the rule is "enforced in UI" and then that it "must
      // also be a DB CHECK". The second half is the one that matters: a
      // UI-only guarantee is one API client away from a user who never
      // learns their password was changed.
      await expect(
        prisma.notificationPreference.create({
          data: { userId: clinic.userId, catSecurity: false },
        }),
      ).rejects.toThrow(/notification_preferences_security_always_on/);
    });

    it('rejects an update that switches it off later', async () => {
      await prisma.notificationPreference.create({ data: { userId: clinic.userId } });

      await expect(
        prisma.notificationPreference.update({
          where: { userId: clinic.userId },
          data: { catSecurity: false },
        }),
      ).rejects.toThrow(/notification_preferences_security_always_on/);
    });

    it('lets every other category be switched off', async () => {
      // The constraint has to bind security without freezing the rest.
      const prefs = await prisma.notificationPreference.create({
        data: {
          userId: clinic.userId,
          catAppointments: false,
          catMedicalRecords: false,
          catLaboratory: false,
          catPharmacy: false,
          catPatients: false,
          catAi: false,
          catSystem: false,
        },
      });

      expect(prefs.catAppointments).toBe(false);
      expect(prefs.catSecurity).toBe(true);
    });

    it('defaults quiet hours to the seeded window', async () => {
      const prefs = await prisma.notificationPreference.create({ data: { userId: clinic.userId } });

      expect(prefs.quietHoursEnabled).toBe(false);
      expect(prefs.quietFrom.toISOString()).toContain('22:00:00');
      expect(prefs.quietTo.toISOString()).toContain('07:00:00');
    });
  });

  describe('AI threads never span two patients (DB §9, §H1)', () => {
    it('rejects a patient-mode thread with no patient bound', async () => {
      // UX 2.5: "AI never has cross-patient context in a single thread."
      // This row is exactly the one that would let context accumulate
      // from two patients.
      await expect(
        prisma.aiConversation.create({
          data: { ownerId: clinic.userId, title: 'Untethered', contextMode: 'PATIENT' },
        }),
      ).rejects.toThrow(/ai_conversations_context_requires_patient/);
    });

    it.each(['RECORD', 'LABS', 'PHARMACY'] as const)(
      'rejects %s mode with no patient bound',
      async (mode) => {
        await expect(
          prisma.aiConversation.create({
            data: { ownerId: clinic.userId, title: 'Untethered', contextMode: mode },
          }),
        ).rejects.toThrow(/ai_conversations_context_requires_patient/);
      },
    );

    it('allows a general thread with no patient', async () => {
      const thread = await prisma.aiConversation.create({
        data: { ownerId: clinic.userId, title: 'How do I document a telemedicine visit?' },
      });

      expect(thread.contextMode).toBe('GENERAL');
      expect(thread.patientId).toBeNull();
    });

    it('allows a bound patient thread', async () => {
      const thread = await prisma.aiConversation.create({
        data: {
          ownerId: clinic.userId,
          title: 'HbA1c trend question',
          contextMode: 'LABS',
          patientId: clinic.patientId,
          refPublicId: 'LAB-100429',
        },
      });

      expect(thread.patientId).toBe(clinic.patientId);
    });

    it('constrains temperature and thumbs feedback', async () => {
      await expect(
        prisma.aiUserSetting.create({ data: { userId: clinic.userId, temperature: 1.5 } }),
      ).rejects.toThrow(/ai_user_settings_temperature_range/);

      const thread = await prisma.aiConversation.create({
        data: { ownerId: clinic.userId, title: 'General' },
      });

      // A zero would be indistinguishable from "rated neutral", which
      // the thumbs UI cannot express.
      await expect(
        prisma.aiMessage.create({
          data: { conversationId: thread.id, role: 'ASSISTANT', content: 'Hello.', feedback: 0 },
        }),
      ).rejects.toThrow(/ai_messages_feedback_values/);
    });

    it('ties an AI error message to the error status', async () => {
      const thread = await prisma.aiConversation.create({
        data: { ownerId: clinic.userId, title: 'General' },
      });

      await expect(
        prisma.aiMessage.create({
          data: { conversationId: thread.id, role: 'ASSISTANT', content: '', status: 'ERROR' },
        }),
      ).rejects.toThrow(/ai_messages_error_iff_error_status/);
    });
  });

  describe('the content-access gate (DB §S4, ADR-006)', () => {
    it('refuses to record a requester as their own approver', async () => {
      // ADR-006 §5 / ADR-017 §5: the second-administrator approval is
      // about distinct actors. The database refuses it rather than
      // trusting every future caller to check.
      const conversation = await prisma.conversation.create({
        data: { patientId: clinic.patientId, topic: 'ICU handover', kind: 'GROUP' },
      });

      await expect(
        prisma.communicationAccessRequest.create({
          data: {
            conversationId: conversation.id,
            requestedBy: clinic.userId,
            justificationCategory: 'quality_audit',
            reason: 'Routine review.',
            accessRef: 'ACC-0001',
            approvedBy: clinic.userId,
          },
        }),
      ).rejects.toThrow(/no_self_approval/);
    });

    it('refuses a grant with no expiry', async () => {
      // A grant with no expiry is a standing capability wearing a
      // justification.
      const conversation = await prisma.conversation.create({
        data: { patientId: clinic.patientId, topic: 'ICU handover', kind: 'GROUP' },
      });

      await expect(
        prisma.communicationAccessRequest.create({
          data: {
            conversationId: conversation.id,
            requestedBy: clinic.userId,
            justificationCategory: 'safety_flag',
            reason: 'Flagged message review.',
            accessRef: 'ACC-0002',
            status: 'approved',
            grantedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/grant_is_time_boxed/);
    });

    it('accepts a time-boxed grant with a traceable reference', async () => {
      const conversation = await prisma.conversation.create({
        data: { patientId: clinic.patientId, topic: 'ICU handover', kind: 'GROUP' },
      });
      const grantedAt = new Date();

      const request = await prisma.communicationAccessRequest.create({
        data: {
          conversationId: conversation.id,
          requestedBy: clinic.userId,
          justificationCategory: 'legal_request',
          reason: 'Subpoena 2026-114.',
          accessRef: 'ACC-2026-014',
          status: 'approved',
          grantedAt,
          expiresAt: new Date(grantedAt.getTime() + 3_600_000),
        },
      });

      // The reference is what the watermark banner shows, so a
      // screenshot traces back to the request that allowed it.
      expect(request.accessRef).toBe('ACC-2026-014');
    });
  });

  describe('threads and flags (DB §G1, §S5)', () => {
    it('requires a topic on a group thread', async () => {
      await expect(prisma.conversation.create({ data: { kind: 'GROUP' } })).rejects.toThrow(
        /conversations_group_needs_topic/,
      );
    });

    it('keeps per-viewer state per viewer, not on the thread', async () => {
      // DB §14.5 flags this: a draft on the thread row would be visible
      // to everyone in it.
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'conversations'
          AND column_name IN ('draft', 'unread_count', 'pinned', 'starred', 'archived', 'muted')
      `;

      expect(columns).toEqual([]);
    });

    it('requires a resolved flag to be fully resolved', async () => {
      const conversation = await prisma.conversation.create({
        data: { patientId: clinic.patientId },
      });
      const message = await prisma.message.create({
        data: { conversationId: conversation.id, body: 'Please call me urgently.' },
      });

      // A half-resolved row would sit in both the open and resolved views.
      await expect(
        prisma.messageFlag.create({
          data: {
            messageId: message.id,
            category: 'emergency_language',
            source: 'auto',
            excerpt: 'call me urgently',
            status: 'resolved',
          },
        }),
      ).rejects.toThrow(/message_flags_resolution_complete/);

      const open = await prisma.messageFlag.create({
        data: {
          messageId: message.id,
          category: 'emergency_language',
          source: 'auto',
          excerpt: 'call me urgently',
        },
      });
      expect(open.status).toBe('open');
    });
  });

  describe('user settings (DB §J)', () => {
    it('constrains the text scale and the appearance vocabularies', async () => {
      await expect(
        prisma.userInterfacePreference.create({ data: { userId: clinic.userId, textScale: 200 } }),
      ).rejects.toThrow(/text_scale_range/);

      await expect(
        prisma.userInterfacePreference.create({ data: { userId: clinic.userId, theme: 'solarized' } }),
      ).rejects.toThrow(/theme_check/);
    });

    it('constrains the date and time formats', async () => {
      await expect(
        prisma.userSetting.create({ data: { userId: clinic.userId, dateFormat: 'DD.MM.YY' } }),
      ).rejects.toThrow(/date_format_check/);

      await expect(
        prisma.userSetting.create({ data: { userId: clinic.userId, timeFormat: '24' } }),
      ).rejects.toThrow(/time_format_check/);
    });

    it('applies the documented defaults', async () => {
      const settings = await prisma.userSetting.create({ data: { userId: clinic.userId } });

      expect(settings.landingPage).toBe('OVERVIEW');
      expect(settings.dateFormat).toBe('MM/DD/YYYY');
      expect(settings.timezone).toBe('UTC');
    });
  });

  describe('reports and announcements (DB §I, §K10)', () => {
    it('refuses a schedule that emails nobody', async () => {
      await expect(
        prisma.scheduledReport.create({
          data: {
            ownerId: clinic.userId,
            name: 'Weekly digest',
            category: 'OVERVIEW',
            frequency: 'WEEKLY',
            recipients: [],
            nextRunAt: new Date('2026-09-01T06:00:00Z'),
          },
        }),
      ).rejects.toThrow(/scheduled_reports_has_recipients/);
    });

    it('stores a schedule and reads its recipients back', async () => {
      // The test this file was missing, and the reason a broken column
      // shipped green.
      //
      // The negative case above is the only one that touched this table,
      // and it rejects at the CHECK — so the row never comes back and
      // the *read* path is never exercised. `recipients` was
      // `citext[]`, which Prisma 7.9.1 cannot read at all: the driver
      // registers no array parser for the citext OID, hands back the
      // unparsed literal, and the data mapper throws
      // `TypeError: e.map is not a function`. Every create and every
      // list would have failed the first time M21 stored a real
      // schedule.
      //
      // Asserting the round trip rather than just the insert is what
      // makes that visible: the column is `text[]` now (ADR-028), and a
      // regression to `citext[]` turns this red immediately.
      const created = await prisma.scheduledReport.create({
        data: {
          ownerId: clinic.userId,
          name: 'Weekly digest',
          category: 'OVERVIEW',
          frequency: 'WEEKLY',
          recipients: ['doctor@medora.health', 'ops@medora.health'],
          nextRunAt: new Date('2026-09-01T06:00:00Z'),
        },
      });

      expect(created.recipients).toEqual(['doctor@medora.health', 'ops@medora.health']);

      const listed = await prisma.scheduledReport.findMany({
        where: { ownerId: clinic.userId },
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.recipients).toEqual(['doctor@medora.health', 'ops@medora.health']);
    });

    it('matches a recipient exactly, so M21.5 must lower-case on write', async () => {
      // The consequence of ADR-028, pinned so it is not discovered as a
      // duplicate delivery. `citext[]` would have matched this
      // regardless of case; `text[]` does not, which is why storing the
      // address lower-cased becomes the writing endpoint's job
      // (RA-028.1).
      await prisma.scheduledReport.create({
        data: {
          ownerId: clinic.userId,
          name: 'Monthly revenue',
          category: 'REVENUE',
          frequency: 'MONTHLY',
          recipients: ['Doctor@Medora.Health'],
          nextRunAt: new Date('2026-10-01T06:00:00Z'),
        },
      });

      expect(
        await prisma.scheduledReport.count({
          where: { ownerId: clinic.userId, recipients: { has: 'doctor@medora.health' } },
        }),
      ).toBe(0);
      expect(
        await prisma.scheduledReport.count({
          where: { ownerId: clinic.userId, recipients: { has: 'Doctor@Medora.Health' } },
        }),
      ).toBe(1);
    });

    it('refuses an announcement that expires before it is posted', async () => {
      await expect(
        prisma.announcement.create({
          data: {
            title: 'Closed Friday',
            body: 'The clinic is closed.',
            expiresAt: new Date('2020-01-01T00:00:00Z'),
          },
        }),
      ).rejects.toThrow(/announcements_expires_after_creation/);
    });

    it('does not create a broadcast_channels table', async () => {
      // DB §G8 keeps it a logical entity: announcement and system
      // channels are `conversations` rows. A second table would make
      // every message query a union of two.
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'broadcast_channels'
      `;

      expect(rows).toEqual([]);
    });
  });
});
