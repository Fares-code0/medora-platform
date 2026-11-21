/**
 * The caller's own account settings and activity feed
 * (RM M8.1, M8.6 — API §2.1, §2.2, §2.8).
 *
 * ## Every write here reports itself to the user's own feed
 *
 * That is M8.6's "writer hooks" in practice, and the kind matters: an
 * account edit is `profile`, not `settings`. The Activity panel groups
 * by kind, and a user scanning for "did someone change my contact
 * details" should not have to read through preference saves to find it.
 *
 * ## What the summary says, and what it must never say
 *
 * "Phone number updated" — never the number. The feed is stored
 * unencrypted and rendered in a panel someone may be screen-sharing, and
 * `ActivityEntryInput` fixes the rule: a summary names *what changed*,
 * never the value it changed to. A username is the exception the rule
 * allows, because it is a public handle by construction.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, KIND_FROM_WIRE, KIND_TO_WIRE, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { isUniqueViolation } from '../../../shared/database';
import type { AccountView, ActivityEntryView } from '../dto/account.dto';
import type { ActivityQuery, UpdateAccountInput } from '../dto/account.schema';
import {
  AccountRepository,
  type AccountRow,
  type ActivityRow,
} from '../repositories/account.repository';

export interface PaginatedActivity {
  readonly items: readonly ActivityEntryView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly accounts: AccountRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /** API §2.1. */
  async account(userId: string): Promise<AccountView> {
    const row = await this.accounts.findAccount(userId);

    // The token was valid, so the account existed when it was minted.
    // Reaching here means the row has since gone — the same reasoning
    // `PatientProfileService` gives for its 404.
    if (row === null) throw AppException.notFound('Account not found');

    return toAccountView(row);
  }

  /**
   * API §2.2.
   *
   * A body that changes nothing is accepted rather than refused: the
   * client sends the whole `AccountSettings` slice it read, so "no
   * change" is a normal outcome of pressing Save twice, and a 422 there
   * would be an error message for a user who did nothing wrong. The
   * activity entry is what stays conditional — a feed line for a save
   * that changed nothing is noise in the one place noise is expensive.
   */
  async updateAccount(user: AuthenticatedUser, input: UpdateAccountInput): Promise<AccountView> {
    const current = await this.accounts.findAccount(user.id);
    if (current === null) throw AppException.notFound('Account not found');

    const usernameChanged = input.username !== undefined && input.username !== current.username;
    const phoneChanged = input.phone !== undefined && input.phone !== current.phone;

    if (usernameChanged && (await this.accounts.usernameTaken(input.username ?? '', user.id))) {
      throw AppException.conflict('That username is already taken', 'conflict');
    }

    let updated: AccountRow;
    try {
      updated = await this.accounts.updateAccount(user.id, input);
    } catch (error) {
      // The unique index is the real guarantee; the pre-check above only
      // turns the common case into a readable message. Two claims for one
      // name arriving together land here.
      if (isUniqueViolation(error)) {
        throw AppException.conflict('That username is already taken', 'conflict');
      }
      throw error;
    }

    if (!usernameChanged && !phoneChanged) return toAccountView(updated);

    const changed = [
      ...(usernameChanged ? ['username'] : []),
      ...(phoneChanged ? ['phone'] : []),
    ];

    await this.audit.record({
      action: 'account.update',
      actor: { userId: user.id, role: user.role },
      entityType: 'user',
      entityId: user.publicId,
      // Field *names*, never their values — the rule `AuditMetadata`
      // states. A phone number in the ledger is PHI-adjacent contact
      // data that an audit row has no reason to carry.
      metadata: { fields: changed.join(',') },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'profile',
      summary: usernameChanged && phoneChanged
        ? 'Username and phone number updated'
        : usernameChanged
          ? 'Username updated'
          : 'Phone number updated',
      // The new username is safe to show — it is a public handle. The
      // phone number is not, and is deliberately not echoed.
      ...(usernameChanged ? { detail: input.username } : {}),
    });

    return toAccountView(updated);
  }

  /** API §2.8 — the caller's own feed, paginated and optionally filtered. */
  async activityFeed(userId: string, query: ActivityQuery): Promise<PaginatedActivity> {
    const { rows, totalItems } = await this.accounts.activity(userId, {
      kind: query.kind === undefined ? undefined : KIND_FROM_WIRE[query.kind],
      page: query.page,
      pageSize: query.pageSize,
    });

    return {
      items: rows.map(toActivityView),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}

function toAccountView(row: AccountRow): AccountView {
  return {
    email: row.email,
    username: row.username,
    phone: row.phone,
    // A credential row always exists (`IdentityRepository.createAccount`
    // writes both in one transaction), but the relation is typed
    // nullable. Falling back to the epoch would render "1970" in the
    // Security panel; the account's own creation time is not available
    // on this projection, so the honest fallback is the current instant,
    // which reads as "just now" rather than as a fabricated history.
    passwordUpdatedAt: (row.credentials?.passwordUpdatedAt ?? new Date()).toISOString(),
    twoFactorEnabled: row.twoFactorEnabled,
    emailVerified: row.emailVerifiedAt !== null,
  };
}

function toActivityView(row: ActivityRow): ActivityEntryView {
  return {
    id: row.id,
    at: row.occurredAt.toISOString(),
    kind: KIND_TO_WIRE[row.kind],
    summary: row.summary,
    detail: row.detail,
  };
}
