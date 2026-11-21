/**
 * Settings → Security, server side (RM M8.3–M8.5, API §2.4–2.7).
 *
 * Three surfaces the doctor and admin Settings centre reads, and the
 * patient app will read too: which sessions are live, which devices are
 * trusted, and what the sign-in history looks like.
 *
 * ## Every mutation here is a security event, so every one is audited
 *
 * Revoking a session and removing a trusted device are the two actions a
 * user takes *because something is wrong* — a laptop left in a clinic, a
 * login they do not recognise. An incident review needs to see them, so
 * they write an audit event (the platform ledger, M28) **and** an
 * activity entry of kind `security` (the user's own feed, M8.6). The two
 * are different audiences, not a duplication: §A12's own comment draws
 * the line.
 *
 * ## Revocation takes effect on the next request (PRE-01)
 *
 * Revoking marks `sessions.revoked_at`. Since PRE-01 the access-token
 * guard reads the session row on every protected request, so the access
 * token already issued for a revoked session is refused from the next
 * request on, not when it expires (owner decisions I4, O-13). A request
 * already executing when the revocation commits is not cancelled — O-13
 * defines "immediate" as refusing *new* requests.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import type { DevicePlatform } from '../../../generated/prisma/enums';
import type {
  ActiveSessionView,
  LoginEventView,
  Paginated,
  TrustedDeviceView,
} from '../dto/account-security.dto';
import type {
  DevicePlatformWire,
  HistoryQuery,
  RegisterDeviceInput,
} from '../dto/account-security.schema';
import {
  AccountSecurityRepository,
  type ActiveSessionRow,
  type LoginEventRow,
  type TrustedDeviceRow,
} from '../repositories/account-security.repository';

@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly security: AccountSecurityRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /** API §2.4. `current` is resolved against the token's own session id. */
  async sessions(user: AuthenticatedUser): Promise<readonly ActiveSessionView[]> {
    const rows = await this.security.activeSessions(user.id);
    return rows.map((row) => toSessionView(row, user.sessionId));
  }

  /**
   * API §2.5 — revoke one.
   *
   * Revoking the **current** session is allowed and is not the same as
   * logging out: it ends the refresh family, so the browser's cookie
   * stops working, but it does not clear that cookie. The client is
   * expected to call `POST /auth/logout` to sign itself out; a user who
   * revokes their own row from the list gets the security outcome they
   * asked for either way.
   */
  async revokeSession(user: AuthenticatedUser, sessionId: string): Promise<void> {
    const revoked = await this.security.revokeSession(user.id, sessionId);

    // Someone else's session and a session that does not exist answer
    // the same 404. A 403 here would confirm that a session id is real.
    if (revoked === 0) throw AppException.notFound('Session not found');

    await this.audit.record({
      action: 'session.revoke',
      actor: { userId: user.id, role: user.role },
      entityType: 'session',
      entityId: sessionId,
      metadata: { self: sessionId === user.sessionId },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'security',
      summary: 'Signed out of a session',
    });
  }

  /** API §2.5 — revoke every other session. Returns how many ended. */
  async revokeOtherSessions(user: AuthenticatedUser): Promise<{ revoked: number }> {
    const revoked = await this.security.revokeOtherSessions(user.id, user.sessionId);

    // Recorded even when the count is zero. "I pressed sign-out-everywhere
    // and there was nothing to end" is a fact an incident review wants,
    // and a conditional write would hide it.
    await this.audit.record({
      action: 'session.revokeOthers',
      actor: { userId: user.id, role: user.role },
      entityType: 'user',
      entityId: user.publicId,
      metadata: { revoked },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'security',
      summary: 'Signed out of all other sessions',
      detail: `${String(revoked)} session(s) ended`,
    });

    return { revoked };
  }

  /** API §2.6 — the devices still trusted. */
  async devices(userId: string): Promise<readonly TrustedDeviceView[]> {
    const rows = await this.security.trustedDevices(userId);
    return rows.map(toDeviceView);
  }

  /** API §2.6 — trust a device. */
  async addDevice(user: AuthenticatedUser, input: RegisterDeviceInput): Promise<TrustedDeviceView> {
    const row = await this.security.addTrustedDevice({
      userId: user.id,
      name: input.name,
      platform: PLATFORM_FROM_WIRE[input.platform],
      isCurrent: input.current,
      ...(input.pushToken === undefined ? {} : { pushToken: input.pushToken }),
    });

    await this.audit.record({
      action: 'device.trust',
      actor: { userId: user.id, role: user.role },
      entityType: 'trusted_device',
      entityId: row.id,
      // The platform is a category, not content. The device *name* is
      // the user's own free text and stays out of the ledger.
      metadata: { platform: input.platform, pushToken: input.pushToken !== undefined },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'security',
      summary: 'Added a trusted device',
      detail: input.name,
    });

    return toDeviceView(row);
  }

  /** API §2.6 — stop trusting a device. Soft, never a delete. */
  async removeDevice(user: AuthenticatedUser, deviceId: string): Promise<void> {
    const removed = await this.security.removeTrustedDevice(user.id, deviceId);

    if (removed === 0) throw AppException.notFound('Device not found');

    await this.audit.record({
      action: 'device.untrust',
      actor: { userId: user.id, role: user.role },
      entityType: 'trusted_device',
      entityId: deviceId,
    });

    await this.activity.record({
      userId: user.id,
      kind: 'security',
      summary: 'Removed a trusted device',
    });
  }

  /** API §2.7 — paginated sign-in history, successes and failures alike. */
  async loginHistory(userId: string, query: HistoryQuery): Promise<Paginated<LoginEventView>> {
    const { rows, totalItems } = await this.security.loginHistory(
      userId,
      query.page,
      query.pageSize,
    );

    return {
      items: rows.map(toLoginEventView),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}

function toSessionView(row: ActiveSessionRow, currentSessionId: string): ActiveSessionView {
  return {
    id: row.id,
    device: row.device,
    browser: row.browser,
    location: row.location,
    ipAddress: row.ipAddress,
    startedAt: row.startedAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    current: row.id === currentSessionId,
  };
}

function toDeviceView(row: TrustedDeviceRow): TrustedDeviceView {
  return {
    id: row.id,
    name: row.name,
    platform: PLATFORM_TO_WIRE[row.platform],
    addedAt: row.addedAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    current: row.isCurrent,
    // `push_token` is deliberately absent: a token is enough to send the
    // device a notification, and the M8.4 shape is the frontend's
    // `TrustedDevice` exactly (`account-security.e2e-spec.ts`).
  };
}

function toLoginEventView(row: LoginEventRow): LoginEventView {
  return {
    id: row.id,
    at: row.occurredAt.toISOString(),
    device: row.device,
    location: row.location,
    ipAddress: row.ipAddress,
    // The column is the `LoginResult` enum, whose two members map to
    // exactly the two values `LoginEvent.status` accepts.
    status: row.result === 'SUCCESS' ? 'success' : 'failed',
  };
}

/**
 * Wire value ↔ Prisma enum member (ADR-023 §2).
 *
 * `Record<…, …>` in both directions so a member added to the schema
 * without the wire list, or the reverse, stops the build rather than
 * putting an unknown string on the wire.
 */
const PLATFORM_FROM_WIRE: Record<DevicePlatformWire, DevicePlatform> = {
  windows: 'WINDOWS',
  mac: 'MAC',
  ios: 'IOS',
  android: 'ANDROID',
  desktop: 'DESKTOP',
  mobile: 'MOBILE',
  tablet: 'TABLET',
};

const PLATFORM_TO_WIRE: Record<DevicePlatform, DevicePlatformWire> = {
  WINDOWS: 'windows',
  MAC: 'mac',
  IOS: 'ios',
  ANDROID: 'android',
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  TABLET: 'tablet',
};
