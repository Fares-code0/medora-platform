/**
 * The caller's own sessions, trusted devices and sign-in history
 * (RM M8.3–M8.5, DB §A7–A9).
 *
 * Separate from `IdentityRepository` deliberately. That file is the
 * *authentication* aggregate — the queries the login, refresh and
 * recovery flows make, where a wrong `where` clause is an authentication
 * bug. This one serves the Settings → Security **read** surface, and
 * mixing the two would put a paginated list query next to the credential
 * lookup that decides whether a password is right.
 *
 * ## Ownership is a WHERE clause on every query in this file
 *
 * `userId` comes from the access token and is never a parameter a caller
 * supplies. Every read filters on it, and every write uses `updateMany`
 * with it in the predicate rather than `update` by id — the reason
 * `NotificationRepository` gives: `update` throws a distinguishable
 * error for a row that exists but is not yours, which turns a revoke
 * route into an enumeration oracle. `updateMany` answers zero for "not
 * yours" and "no such row" alike.
 */

import { Injectable } from '@nestjs/common';

import type { DevicePlatform } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActiveSessionRow {
  readonly id: string;
  readonly device: string | null;
  readonly browser: string | null;
  readonly location: string | null;
  readonly ipAddress: string | null;
  readonly startedAt: Date;
  readonly lastActiveAt: Date;
}

export interface TrustedDeviceRow {
  readonly id: string;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly addedAt: Date;
  readonly lastSeenAt: Date | null;
  readonly isCurrent: boolean;
}

export interface LoginEventRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly device: string | null;
  readonly location: string | null;
  readonly ipAddress: string | null;
  readonly result: string;
}

@Injectable()
export class AccountSecurityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Live sessions only — not revoked and not expired.
   *
   * A revoked row stays in the table (it is the record that a session
   * was ended), and an expired one is no longer a way in. Neither is
   * something the user can act on, and listing them would make the
   * "revoke" button on a dead session look like it did nothing.
   */
  async activeSessions(userId: string): Promise<readonly ActiveSessionRow[]> {
    if (!UUID.test(userId)) return [];

    return this.prisma.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        device: true,
        browser: true,
        location: true,
        ipAddress: true,
        startedAt: true,
        lastActiveAt: true,
      },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  /** Revokes one session the caller owns. Returns rows moved — 0 or 1. */
  async revokeSession(userId: string, sessionId: string): Promise<number> {
    if (!UUID.test(userId) || !UUID.test(sessionId)) return 0;

    const result = await this.prisma.db.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count;
  }

  /**
   * Revokes every live session except the one named (API §2.5).
   *
   * `id: { not: keepSessionId }` rather than revoking all and re-issuing:
   * the caller's own request must survive its own "sign out everywhere
   * else", or the button logs you out of the device you pressed it on.
   */
  async revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
    if (!UUID.test(userId)) return 0;

    const result = await this.prisma.db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(UUID.test(keepSessionId) ? { id: { not: keepSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });

    return result.count;
  }

  /**
   * Trusted devices still trusted — `removed_at IS NULL`.
   *
   * The removed rows stay (the schema calls the record of when a device
   * stopped being trusted worth more than the row it saves), and they
   * are not listed: a device the user removed reappearing in their own
   * security panel reads as the removal having failed.
   */
  async trustedDevices(userId: string): Promise<readonly TrustedDeviceRow[]> {
    if (!UUID.test(userId)) return [];

    return this.prisma.db.trustedDevice.findMany({
      where: { userId, removedAt: null },
      select: {
        id: true,
        name: true,
        platform: true,
        addedAt: true,
        lastSeenAt: true,
        isCurrent: true,
      },
      orderBy: { addedAt: 'desc' },
    });
  }

  /**
   * Adds a trusted device.
   *
   * When the new row claims to be the current device, the claim is taken
   * off every other row of this user's **in the same transaction**. Two
   * rows both flagged `is_current` is a state the UI cannot render
   * honestly — "this device" would point at two machines — and it is
   * reachable the moment a user registers a second device without it.
   */
  async addTrustedDevice(input: {
    readonly userId: string;
    readonly name: string;
    readonly platform: DevicePlatform;
    readonly isCurrent: boolean;
    readonly pushToken?: string;
  }): Promise<TrustedDeviceRow> {
    return this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.trustedDevice.updateMany({
          where: { userId: input.userId, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      // One device holds a given push token. A handset re-registered —
      // by another account after it changed hands, or by this one after
      // a reinstall — must stop receiving for whoever held the token
      // before, in the same transaction that gives it to the new row.
      if (input.pushToken !== undefined) {
        await tx.trustedDevice.updateMany({
          where: { pushToken: input.pushToken },
          data: { pushToken: null },
        });
      }

      return tx.trustedDevice.create({
        data: {
          userId: input.userId,
          name: input.name,
          platform: input.platform,
          isCurrent: input.isCurrent,
          pushToken: input.pushToken ?? null,
          // A device is seen at the moment it is registered. Leaving it
          // null would render "never seen" beside a device the user is
          // holding.
          lastSeenAt: new Date(),
        },
        select: {
          id: true,
          name: true,
          platform: true,
          addedAt: true,
          lastSeenAt: true,
          isCurrent: true,
        },
      });
    });
  }

  /** Soft-removes a trusted device. Returns rows moved — 0 or 1. */
  async removeTrustedDevice(userId: string, deviceId: string): Promise<number> {
    if (!UUID.test(userId) || !UUID.test(deviceId)) return 0;

    const result = await this.prisma.db.trustedDevice.updateMany({
      where: { id: deviceId, userId, removedAt: null },
      // A device no longer trusted no longer receives push either.
      data: { removedAt: new Date(), isCurrent: false, pushToken: null },
    });

    return result.count;
  }

  /**
   * A page of the caller's sign-in attempts, newest first.
   *
   * `@@index([userId, occurredAt(sort: Desc)])` is exactly this query.
   * Offset paging rather than keyset: the history page is small and
   * numbered, and M32.3 moves the *audit* surface — the one that grows
   * without bound — to keyset. Applying it here first would complicate a
   * page nobody scrolls past ten of.
   */
  async loginHistory(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: readonly LoginEventRow[]; totalItems: number }> {
    if (!UUID.test(userId)) return { rows: [], totalItems: 0 };

    const where = { userId };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.loginEvent.findMany({
        where,
        select: {
          id: true,
          occurredAt: true,
          device: true,
          location: true,
          ipAddress: true,
          result: true,
        },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.loginEvent.count({ where }),
    ]);

    return { rows, totalItems };
  }
}
