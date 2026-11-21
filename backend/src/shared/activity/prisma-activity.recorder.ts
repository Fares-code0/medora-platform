import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database';
import { ActivityKind } from '../../generated/prisma/enums';

import type { ActivityEntryInput, ActivityKindWire, ActivityRecorder } from './activity.types';

/**
 * The durable writer behind `ACTIVITY_RECORDER` (RM M8.6, DB §A12).
 *
 * Unlike the audit dispatcher this is **not** a stub: `user_activity_log`
 * exists as of M5.2 and the feed endpoint reads it, so there is nothing
 * to defer. The token indirection is kept for the same reason the audit
 * one has it — the six calling modules depend on the interface, so a
 * later change of storage touches this file only.
 *
 * ## Writing the feed never fails the request
 *
 * The `catch` is deliberate and matches `LoginEventService`. Every call
 * site here is a *successful* mutation reporting itself after the fact:
 * the password is already changed, the account already saved. Throwing
 * from this point would turn a completed write into a 500 the client
 * retries, and the retry would attempt a change that already happened.
 *
 * The failure is logged at `error` so it is not silent — a feed that
 * stops recording is a real defect, just not one worth failing a
 * clinician's request over.
 */
@Injectable()
export class PrismaActivityRecorder implements ActivityRecorder {
  private readonly logger = new Logger('Activity');

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: ActivityEntryInput): Promise<void> {
    try {
      await this.prisma.db.userActivityLog.create({
        data: {
          userId: entry.userId,
          kind: KIND_FROM_WIRE[entry.kind],
          // The column is varchar(200); a summary long enough to be
          // rejected by Postgres would drop the whole entry, and a
          // truncated line is worth more than a missing one.
          summary: entry.summary.slice(0, 200),
          ...(entry.detail === undefined ? {} : { detail: entry.detail }),
          ...(entry.occurredAt === undefined ? {} : { occurredAt: entry.occurredAt }),
        },
      });
    } catch (error) {
      this.logger.error({ err: error, kind: entry.kind }, 'Could not record an activity entry');
    }
  }
}

/**
 * Wire value → Prisma enum member (ADR-023 §2).
 *
 * `Record<ActivityKindWire, ActivityKind>` rather than a cast, so adding
 * a kind to either side without the other stops the build.
 */
export const KIND_FROM_WIRE: Record<ActivityKindWire, ActivityKind> = {
  profile: ActivityKind.PROFILE,
  password: ActivityKind.PASSWORD,
  login: ActivityKind.LOGIN,
  settings: ActivityKind.SETTINGS,
  security: ActivityKind.SECURITY,
  integration: ActivityKind.INTEGRATION,
  privacy: ActivityKind.PRIVACY,
};

/** Prisma enum member → wire value, for the feed's serialization boundary. */
export const KIND_TO_WIRE: Record<ActivityKind, ActivityKindWire> = {
  PROFILE: 'profile',
  PASSWORD: 'password',
  LOGIN: 'login',
  SETTINGS: 'settings',
  SECURITY: 'security',
  INTEGRATION: 'integration',
  PRIVACY: 'privacy',
};
