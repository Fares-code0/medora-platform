/**
 * The platform configuration document — API §19.1–§19.2, RM M24.1/M24.2/M24.6.
 *
 * ## The document is composed, the slices are stored
 *
 * Eleven `platform_settings` rows hold the form slices as JSONB (DB §L1:
 * "slices are read/written whole"), and four collections come from their
 * own tables. `GET` composes them; `PATCH` writes exactly one row.
 *
 * ## Concurrency is a compare-and-set, not a read-then-check
 *
 * The staleness check in this service is what produces the *useful* 409 —
 * the one carrying both change sets so a client can merge. It is not what
 * makes the guarantee. Two administrators saving the same slice in the
 * same instant both read the same `updatedAt` and both pass that check;
 * what separates them is that the write names the revision in its `WHERE`
 * clause, so exactly one row is updated and the loser gets the same 409
 * from a second read. Dropping either half would be wrong: without the
 * check the conflict body is empty, without the compare-and-set the later
 * save silently wins.
 *
 * ## A missing slice is reported, never defaulted
 *
 * The eleven rows are seeded in every environment. If one is absent the
 * read answers 503 naming it rather than substituting the shipped
 * default: `PolicyService` enforces what is *stored*, so a panel showing
 * a default that nothing is enforcing would be a lie about the platform's
 * security policy.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { Prisma } from '../../../generated/prisma/client';
import {
  requiresConfirmation,
  SETTINGS_SLICES,
  SLICE_SCHEMAS,
  type SettingsSlice,
  type SlicePatchBody,
} from '../dto/platform-settings.schema';
import {
  PlatformSettingsRepository,
  USERS_IN_DOCUMENT,
  type ApiKeyRow,
  type BackupRow,
  type IntegrationRow,
  type PlatformUserRow,
} from '../repositories/platform-settings.repository';

/** How many recovery points the panel lists (§19.6 shows a table). */
const BACKUPS_IN_DOCUMENT = 50;

type SliceValues = Record<SettingsSlice, Record<string, unknown>>;

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly settings: PlatformSettingsRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /** API §19.1 — the whole `AdminSettingsDocument`. */
  async read() {
    const [rows, integrations, apiKeys, backups, users] = await Promise.all([
      this.settings.settings(),
      this.settings.integrations(),
      this.settings.apiKeys(),
      this.settings.backups(BACKUPS_IN_DOCUMENT),
      this.settings.platformUsers(USERS_IN_DOCUMENT),
    ]);

    const stored = new Map(rows.map((row) => [row.key, row] as const));
    const values: Partial<SliceValues> = {};
    const revisions: Partial<Record<SettingsSlice, string>> = {};

    for (const slice of SETTINGS_SLICES) {
      const row = stored.get(slice);

      if (row === undefined) {
        throw new AppException(503, {
          message: 'Platform settings are incomplete',
          code: 'service_unavailable',
          detail: `The "${slice}" slice has no row. Run the platform-settings seed.`,
        });
      }

      values[slice] = asObject(row.value, slice);
      revisions[slice] = row.updatedAt.toISOString();
    }

    return {
      ...(values as SliceValues),
      users: users.map(toPlatformUserView),
      integrations: integrations.map(toIntegrationView),
      apiKeys: apiKeys.map(toApiKeyView),
      backups: backups.map(toBackupView),
      /**
       * [DERIVED] — the optimistic-concurrency token §19.2 requires.
       *
       * `AdminSettingsDocument` has no version field because the mock
       * wrote to localStorage, where there is one writer by construction.
       * It sits beside the slices rather than inside them so each slice's
       * shape still matches the frontend interface exactly.
       */
      revisions: revisions as Record<SettingsSlice, string>,
    };
  }

  /** API §19.2 — one slice, validated, confirmed where required, audited. */
  async patchSlice(actor: AuthenticatedUser, slice: SettingsSlice, body: SlicePatchBody) {
    const parsed = SLICE_SCHEMAS[slice].safeParse(body.value);

    if (!parsed.success) {
      throw AppException.validation(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.length > 0 ? issue.path.join('.') : '_errors',
            [issue.message],
          ]),
        ),
        `The ${slice} settings are not valid`,
      );
    }

    // Checked before the revision, deliberately. A stale document and a
    // missing confirmation are both refusals, but only one of them is
    // the administrator's to fix by reloading — telling them the page is
    // out of date when the real problem is that they never confirmed
    // sends them round a loop that never ends.
    if (requiresConfirmation(slice) && !body.confirm) {
      throw AppException.validation(
        {
          confirm: [
            `Changing ${slice} settings affects every account on the platform and must be confirmed`,
          ],
        },
        'This change requires confirmation',
      );
    }

    const current = await this.settings.setting(slice);

    if (current === null) {
      throw new AppException(503, {
        message: 'Platform settings are incomplete',
        code: 'service_unavailable',
        detail: `The "${slice}" slice has no row. Run the platform-settings seed.`,
      });
    }

    // Compared as instants rather than strings: two ISO spellings of one
    // moment are the same revision, and a string comparison would 409 a
    // client that round-tripped the value through a date library.
    if (current.updatedAt.getTime() !== Date.parse(body.updatedAt)) {
      throw this.staleConflict(slice, current.value, parsed.data as Record<string, unknown>);
    }

    const won = await this.settings.writeSliceIfUnchanged(
      slice,
      current.updatedAt,
      parsed.data as Prisma.InputJsonObject,
      actor.id,
    );

    if (!won) {
      // Lost the race between the check above and the write. Re-read so
      // the conflict body describes what actually won, not what this
      // request saw a moment ago.
      const now = await this.settings.setting(slice);

      throw this.staleConflict(
        slice,
        now?.value ?? current.value,
        parsed.data as Record<string, unknown>,
      );
    }

    // §19: "Every write is audited." After the write, through the
    // dispatcher that swallows its own failures — an audit sink that can
    // fail an administrator's save turns observability into availability.
    await this.audit.record({
      action: `platform_settings.${slice}_updated`,
      actor: { userId: actor.id, role: actor.role },
      entityType: 'platform_setting',
      entityId: slice,
      metadata: {
        // Field names, never values: `AuditMetadata` is scalar-only by
        // contract, and an SMTP password reaching an audit row would be
        // the exact leak §19.5's write-only rule exists to prevent.
        fields: Object.keys(parsed.data as object).sort().join(', '),
        confirmed: body.confirm,
        // §19.2's "audited consequence text" — what the administrator
        // was shown before they agreed. An audit row saying the security
        // slice changed does not record what they were told it meant.
        consequence: body.consequence ?? null,
      },
    });

    return this.read();
  }

  /**
   * The 409 body — §19.2's "409 with both change sets".
   *
   * The base the caller started from is gone, so a three-way diff is not
   * available; what a merge dialog needs, and what this carries, is the
   * two documents side by side plus the field names on which they
   * disagree. `theirs` is the stored slice, `yours` is the proposal.
   *
   * Same envelope as §15.3's matrix conflict: JSON in `detail`, so one
   * client-side reader handles both.
   */
  private staleConflict(
    slice: SettingsSlice,
    stored: Prisma.JsonValue,
    proposed: Record<string, unknown>,
  ): AppException {
    const theirs = asObject(stored, slice);
    const fields = Object.keys({ ...theirs, ...proposed }).filter(
      (key) => JSON.stringify(theirs[key]) !== JSON.stringify(proposed[key]),
    );

    return new AppException(409, {
      message: `The ${slice} settings changed since this panel was opened`,
      code: 'conflict',
      detail: JSON.stringify({ slice, yours: proposed, theirs, fields: fields.sort() }),
    });
  }
}

/**
 * A stored slice, as an object.
 *
 * `platform_settings.value` is `Json`, so the column can hold a scalar or
 * an array — nothing in PostgreSQL stops it. Reading such a row as a
 * slice would spread a string into the document; answering 503 instead
 * says what is wrong and where.
 */
function asObject(value: Prisma.JsonValue, slice: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppException(503, {
      message: 'Platform settings are incomplete',
      code: 'service_unavailable',
      detail: `The "${slice}" slice does not hold an object.`,
    });
  }

  return value;
}

function toPlatformUserView(row: PlatformUserRow) {
  return {
    id: row.publicId,
    name: row.displayName,
    email: row.email,
    role: row.roleCode,
    // The frontend models this as a boolean; `users.status` has three
    // members, and only ACTIVE is active. Suspended reads as inactive
    // here because the panel has no third state to show it in — the
    // distinction lives at `/admin/users` (§2.10), which does.
    active: row.status === 'ACTIVE',
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
  };
}

function toIntegrationView(row: IntegrationRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    connected: row.connected,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
  };
}

function toApiKeyView(row: ApiKeyRow) {
  return {
    id: row.id,
    label: row.label,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    // The frontend models revocation as a boolean; the column is a
    // timestamp because *when* a key stopped working is what an incident
    // review needs. Both are true — the boolean is the projection.
    revoked: row.revokedAt !== null,
  };
}

function toBackupView(row: BackupRow) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    // `Decimal` through JSON is an object, not a number. The frontend
    // types this `number`, so the conversion happens here rather than
    // reaching a chart as `{ s: 1, e: 1, d: [42] }`.
    sizeMb: row.sizeMb.toNumber(),
    kind: row.kind.toLowerCase(),
  };
}
