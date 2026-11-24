/**
 * Fan-out: domain events become notifications (RM M19.2).
 *
 * ## Where this sits between M19.1 and M30.1
 *
 * M19.1 made the *write* transactional — an event row and the fact it
 * announces share one commit. This is the read side: claim pending
 * events, apply `NOTIFICATION_RULES`, write the notification and its
 * per-channel delivery rows. M30.1 adds the schedule, the retry policy
 * and the dead-letter queue around it; what it does not add is the
 * fan-out, which is M19's own goal line ("event fan-out + feed +
 * preferences").
 *
 * So `drain()` is invoked explicitly today — by a test, or by an
 * operator — and by M30's registry tomorrow. It is deliberately **not**
 * wired to a timer here: a `setInterval` in a request-serving process is
 * precisely the ad-hoc periodic behaviour M30's exit gate forbids
 * ("all periodic behavior runs from the registry, none ad hoc").
 *
 * ## One event never becomes two notifications
 *
 * The claim is atomic (`FOR UPDATE SKIP LOCKED`, and the same statement
 * marks the row), so two instances draining concurrently cannot both see
 * the same event. That is the whole duplicate-suppression story and it
 * lives in the database, not in process-local memory — there is no
 * in-flight set here that a second replica would not share.
 */

import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';


import { BADGE_COUNTS, CacheService } from '../../../shared/cache';
import { PrismaService } from '../../../shared/database';
import { DomainEventRepository, type ClaimedEvent } from '../repositories/domain-event.repository';
import { NotificationRecipientRepository } from '../repositories/notification-recipient.repository';
import {
  DEFAULT_PREFERENCES,
  selectChannels,
  type ChannelPreferences,
} from './channel-selection';
import { isPinned, NOTIFICATION_RULES, type NotificationRule } from './notification-rules';

/** What one event produced, for the operator log and for tests. */
export interface DrainResult {
  readonly claimed: number;
  readonly notificationsCreated: number;
  readonly skippedNoRule: number;
  readonly failed: number;
}

/** A resolved target: one account, plus the rows the feed deep-links to. */
interface Target {
  readonly userId: string;
  readonly patientId: string | null;
  readonly labOrderId: string | null;
  readonly appointmentId: string | null;
}

const BATCH = 100;

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger('NotificationDispatch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventRepository,
    private readonly recipients: NotificationRecipientRepository,
    private readonly cache: CacheService,
  ) {}

  async drain(limit: number = BATCH): Promise<DrainResult> {
    const claimed = await this.events.claim(limit);

    let created = 0;
    let noRule = 0;
    let failed = 0;

    for (const event of claimed) {
      const rule = NOTIFICATION_RULES[event.topic];

      // An event nobody asked to be notified about is not an error. The
      // publisher's decision to record it and the product's decision to
      // page someone are different decisions (see `UNSOURCED_TOPICS`).
      if (rule === undefined) {
        noRule += 1;
        continue;
      }

      try {
        created += await this.fanOut(event, rule);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await this.events.recordFailure(event.id, message);
        this.logger.error({ err: error, topic: event.topic, eventId: event.id }, 'Fan-out failed');
      }
    }

    return {
      claimed: claimed.length,
      notificationsCreated: created,
      skippedNoRule: noRule,
      failed,
    };
  }

  private async fanOut(event: ClaimedEvent, rule: NotificationRule): Promise<number> {
    const targets = await this.resolve(event, rule);
    const now = new Date();
    let created = 0;

    for (const target of targets) {
      await this.write(target, event, rule, now);
      created += 1;
    }

    return created;
  }

  /**
   * The notification and its five delivery rows land together.
   *
   * A notification with no delivery rows would read as "never
   * attempted" on every channel, which is the ambiguity the `skipped`
   * status exists to remove — so the two writes are one transaction
   * rather than two statements that can half-succeed.
   */
  private async write(
    target: Target,
    event: ClaimedEvent,
    rule: NotificationRule,
    now: Date,
  ): Promise<void> {
    const prefs = await this.preferences(target.userId);
    const channels = selectChannels({
      prefs,
      category: rule.category,
      priority: rule.priority,
      now,
    });

    await this.prisma.$transaction(async (tx) => {
      // A notification about a lab order or an appointment inherits that
      // row's hospital stamp (§2.7; a Phase 22 trigger requires the pointer
      // and its target to share a scope).
      const scope =
        target.labOrderId !== null
          ? await tx.labOrder.findUnique({
              where: { id: target.labOrderId },
              select: { hospitalId: true, hospitalMedicalRecordId: true },
            })
          : target.appointmentId !== null
            ? await tx.appointment.findUnique({
                where: { id: target.appointmentId },
                select: { hospitalId: true, hospitalMedicalRecordId: true },
              })
            : null;
      // Inserted without RETURNING, with the id chosen here: the request
      // writing a notification for someone else may not read it back under
      // Row-Level Security (the recipient alone reads it).
      const notification = { id: randomUUID() };
      await tx.notification.createMany({
        data: {
          id: notification.id,
          ...(scope?.hospitalId == null ? {} : { hospitalId: scope.hospitalId }),
          ...(scope?.hospitalMedicalRecordId == null
            ? {}
            : { hospitalMedicalRecordId: scope.hospitalMedicalRecordId }),
          recipientId: target.userId,
          title: rule.title,
          // The body names the entity by its public id and nothing else.
          // A notification is a pointer, not a record: the client follows
          // the id to a route that enforces its own authorization, and
          // ADR-031 (patient-readable clinical data) is not decided here.
          body: bodyFor(event),
          category: rule.category,
          priority: rule.priority,
          kind: rule.kind,
          sender: 'Medora',
          pinned: isPinned(rule),
          ...(target.patientId === null ? {} : { patientId: target.patientId }),
          ...(target.labOrderId === null ? {} : { labOrderId: target.labOrderId }),
          ...(target.appointmentId === null ? {} : { appointmentId: target.appointmentId }),
        },
      });

      await tx.notificationDelivery.createMany({
        data: channels.map((decision) => ({
          notificationId: notification.id,
          channel: decision.channel,
          status: decision.status,
          ...(decision.reason === null ? {} : { error: decision.reason }),
        })),
      });
    });

    // After the commit (RM M31.1): the recipient's next badge read
    // counts the notification just written.
    await this.cache.invalidate(BADGE_COUNTS, [target.userId]);
  }

  /** The row, or the column defaults for a user who never saved any. */
  private async preferences(userId: string): Promise<ChannelPreferences> {
    const row = await this.prisma.db.notificationPreference.findUnique({ where: { userId } });

    return row ?? DEFAULT_PREFERENCES;
  }

  /**
   * Audience roles become accounts.
   *
   * Duplicates are collapsed by `userId`: a doctor who is somehow also
   * the patient on an appointment gets one notification, not two.
   */
  private async resolve(
    event: ClaimedEvent,
    rule: NotificationRule,
  ): Promise<readonly Target[]> {
    const byUser = new Map<string, Target>();
    const payload = event.payload;

    for (const audience of rule.audiences) {
      for (const target of await this.forAudience(audience, payload)) {
        if (!byUser.has(target.userId)) byUser.set(target.userId, target);
      }
    }

    return [...byUser.values()];
  }

  private async forAudience(
    audience: NotificationRule['audiences'][number],
    payload: Record<string, unknown>,
  ): Promise<readonly Target[]> {
    const labOrderPublicId = str(payload['labOrderId']);
    const appointmentPublicId = str(payload['appointmentId']);
    const patientPublicId = str(payload['patientId']);
    const doctorId = str(payload['doctorId']);

    // A lab event names its order, and the order is the authority on who
    // ordered it — the payload does not carry the orderer, and trusting
    // a doctor id from the message would let a republished event address
    // someone who never saw the patient.
    if (labOrderPublicId !== null) {
      const order = await this.recipients.labOrderTarget(labOrderPublicId);

      if (order === null) return [];
      if (audience !== 'doctor') return [];

      return [
        {
          userId: order.doctorUserId,
          patientId: order.patientId,
          labOrderId: order.labOrderId,
          appointmentId: null,
        },
      ];
    }

    const patientRowId =
      patientPublicId === null ? null : await this.recipients.patientRowId(patientPublicId);
    const appointmentRowId =
      appointmentPublicId === null
        ? null
        : await this.recipients.appointmentRowId(appointmentPublicId);

    const base = {
      patientId: patientRowId,
      labOrderId: null,
      appointmentId: appointmentRowId,
    };

    if (audience === 'patient') {
      if (patientPublicId === null) return [];
      const userId = await this.recipients.patientUser(patientPublicId);

      // ADR-030 links a patient record to an account where one exists;
      // a record without one is ordinary, and silence is correct.
      return userId === null ? [] : [{ userId, ...base }];
    }

    if (audience === 'doctor') {
      if (doctorId === null) return [];
      const userId = await this.recipients.doctorUser(doctorId);

      return userId === null ? [] : [{ userId, ...base }];
    }

    const admins = await this.recipients.administrators();

    return admins.map((userId) => ({ userId, ...base }));
  }
}

/**
 * The body is built from identifiers the payload already carries.
 *
 * `OutboxPayload` is scalar-only and carries no clinical content, so
 * there is nothing here that could leak a value — which is why the body
 * can be assembled without re-reading the record.
 */
function bodyFor(event: ClaimedEvent): string {
  const parts: string[] = [];
  const order = str(event.payload['labOrderId']);
  const appointment = str(event.payload['appointmentId']);
  const analytes = str(event.payload['analytes']);
  const startsAt = str(event.payload['startsAt']);
  // M30.2's licence warning. A date, which is neither clinical nor
  // identifying — and without it the body would be the generic fallback
  // on the one notification whose whole content is *when*.
  const expiresOn = str(event.payload['expiresOn']);

  // `medical_record.issue_reported` — the record's `MR-…` reference, so
  // the administrator can find the queue item without the body carrying
  // what the clinician wrote.
  const record = str(event.payload['recordId']);

  if (order !== null) parts.push(`Order ${order}`);
  if (record !== null) parts.push(`Record ${record}`);
  if (appointment !== null) parts.push(`Appointment ${appointment}`);
  if (analytes !== null) parts.push(`Analytes: ${analytes}`);
  if (startsAt !== null) parts.push(`Scheduled for ${startsAt}`);
  if (expiresOn !== null) parts.push(`Expires on ${expiresOn}`);

  return parts.length === 0 ? 'Open Medora for details.' : parts.join(' · ');
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
