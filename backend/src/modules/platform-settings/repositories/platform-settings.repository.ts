/**
 * Platform Settings persistence — DB §L1–L4, RM M24.
 *
 * ## Why the users collection is read here and not borrowed
 *
 * `AdminSettingsDocument` carries a `users` array, and the users module
 * already projects that exact shape. M2.2's zone 1 forbids importing it,
 * and the rule's own wording says what to do instead: "a module that
 * needs another module's *data* queries it through its own repository".
 * So this repository reads the same three columns, and the *management*
 * endpoints stay where §19.3 puts them — module 2.10, `/admin/users`.
 */

import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

export interface SettingRow {
  readonly key: string;
  readonly value: Prisma.JsonValue;
  readonly updatedAt: Date;
}

export interface IntegrationRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly connected: boolean;
  readonly lastSyncAt: Date | null;
  readonly updatedAt: Date;
}

export interface ApiKeyRow {
  readonly id: string;
  readonly label: string;
  readonly prefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface BackupRow {
  readonly id: string;
  readonly label: string;
  readonly sizeMb: Prisma.Decimal;
  readonly kind: 'AUTOMATIC' | 'MANUAL';
  readonly createdAt: Date;
}

export interface PlatformUserRow {
  readonly publicId: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleCode: string;
  readonly status: string;
  readonly lastActiveAt: Date | null;
}

/**
 * How many accounts the settings document carries.
 *
 * The panel is a summary, not the account browser — `/admin/users`
 * (§2.10) is paginated and filterable and is where an administrator
 * manages accounts. An unbounded array here would make one panel's read
 * grow without limit as the platform does.
 */
export const USERS_IN_DOCUMENT = 100;

/**
 * The shape of every id this repository is addressed by. An id that is
 * not one names no row: "not found" here, never a uuid cast PostgreSQL
 * answers with a 500 (API contract audit, 2026-11-14).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PlatformSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Slices (DB §L1) ───────────────────────────────────────── */

  settings(): Promise<SettingRow[]> {
    return this.prisma.db.platformSetting.findMany({
      select: { key: true, value: true, updatedAt: true },
    });
  }

  setting(key: string): Promise<SettingRow | null> {
    return this.prisma.db.platformSetting.findUnique({
      where: { key },
      select: { key: true, value: true, updatedAt: true },
    });
  }

  /**
   * Writes a slice **only if** it is still at the revision the caller
   * read, and reports whether it won.
   *
   * A read-then-write would lose the later of two concurrent saves
   * silently: both would see the same `updatedAt`, both would pass the
   * check in the service, and the second would overwrite the first. The
   * revision is therefore part of the `WHERE` clause — a compare-and-set,
   * the same shape M23.4's queue transitions use — so the loser updates
   * zero rows and the service answers 409.
   *
   * `upsert` is not usable here: the eleven rows are seeded in every
   * environment, and a create branch would paper over a missing row
   * rather than surfacing it.
   */
  async writeSliceIfUnchanged(
    key: string,
    expectedUpdatedAt: Date,
    value: Prisma.InputJsonValue,
    actorId: string,
  ): Promise<boolean> {
    const written = await this.prisma.db.platformSetting.updateMany({
      where: { key, updatedAt: expectedUpdatedAt },
      data: { value, updatedBy: actorId },
    });

    return written.count === 1;
  }

  /* ── Integrations (DB §L2) ─────────────────────────────────── */

  /**
   * `configEnc` is absent from this projection, and that absence is the
   * guarantee §19.5 asks for. There is no read path that selects the
   * column, so there is no response shape to forget to strip — the same
   * structural argument M22 records for `oauth_tokens_enc`.
   */
  integrations(): Promise<IntegrationRow[]> {
    return this.prisma.db.platformIntegration.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        connected: true,
        lastSyncAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  integration(id: string): Promise<IntegrationRow | null> {
    if (!UUID.test(id)) return Promise.resolve(null);
    return this.prisma.db.platformIntegration.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        connected: true,
        lastSyncAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * The one method that reads the ciphertext, and it is called by the
   * connection probe alone. Nothing it returns reaches a response.
   */
  async integrationConfig(id: string): Promise<Uint8Array | null> {
    if (!UUID.test(id)) return null;
    const row = await this.prisma.db.platformIntegration.findUnique({
      where: { id },
      select: { configEnc: true },
    });

    return row?.configEnc ?? null;
  }

  async updateIntegration(
    id: string,
    data: {
      readonly description?: string;
      readonly connected?: boolean;
      readonly configEnc?: Uint8Array<ArrayBuffer>;
      readonly lastSyncAt?: Date;
    },
    actorId: string,
  ): Promise<IntegrationRow | null> {
    if (!UUID.test(id)) return null;
    const written = await this.prisma.db.platformIntegration.updateMany({
      where: { id },
      data: { ...data, updatedBy: actorId },
    });

    if (written.count === 0) return null;

    return this.integration(id);
  }

  /* ── API keys (DB §L3) ─────────────────────────────────────── */

  /**
   * Never selects `keyHash`. Listing keys is a display operation and the
   * hash is not displayable; the one place it is needed reads it by
   * prefix through `credentialFor` below.
   */
  apiKeys(): Promise<ApiKeyRow[]> {
    return this.prisma.db.apiKey.findMany({
      select: {
        id: true,
        label: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  apiKey(id: string): Promise<ApiKeyRow | null> {
    if (!UUID.test(id)) return Promise.resolve(null);
    return this.prisma.db.apiKey.findUnique({
      where: { id },
      select: {
        id: true,
        label: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
  }

  createApiKey(input: {
    readonly label: string;
    readonly prefix: string;
    readonly keyHash: string;
    readonly createdBy: string;
  }): Promise<ApiKeyRow> {
    return this.prisma.db.apiKey.create({
      data: input,
      select: {
        id: true,
        label: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
  }

  /**
   * Revocation is a compare-and-set on `revoked_at IS NULL`.
   *
   * Two administrators revoking the same key at once must not produce
   * two audit events claiming two revocations, and the second must not
   * move the timestamp — when a key stopped working is a fact an
   * incident review depends on.
   */
  async revokeApiKey(id: string, at: Date): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const written = await this.prisma.db.apiKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });

    return written.count === 1;
  }

  /** By prefix, which is unique — the lookup the verifier needs. */
  credentialFor(
    prefix: string,
  ): Promise<{ id: string; keyHash: string; revokedAt: Date | null } | null> {
    return this.prisma.db.apiKey.findUnique({
      where: { prefix },
      select: { id: true, keyHash: true, revokedAt: true },
    });
  }

  /* ── Backups (DB §L4) ──────────────────────────────────────── */

  backups(limit: number): Promise<BackupRow[]> {
    return this.prisma.db.backup.findMany({
      select: { id: true, label: true, sizeMb: true, kind: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /* ── Accounts (the document's `users` collection) ───────────── */

  async platformUsers(limit: number): Promise<PlatformUserRow[]> {
    const rows = await this.prisma.db.user.findMany({
      select: {
        publicId: true,
        displayName: true,
        email: true,
        status: true,
        lastActiveAt: true,
        role: { select: { code: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      publicId: row.publicId,
      displayName: row.displayName,
      email: row.email,
      roleCode: row.role.code,
      status: row.status,
      lastActiveAt: row.lastActiveAt,
    }));
  }
}
