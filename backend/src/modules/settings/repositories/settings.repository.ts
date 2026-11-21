/**
 * The per-user settings document (DB §J1–J3, RM M22).
 *
 * ## Two tables, one document, one `updatedAt`
 *
 * `user_settings` holds privacy and workflow; `user_interface_preferences`
 * holds appearance and accessibility. The document the client reads spans
 * both, so the version it carries is the **later** of the two
 * `updated_at` values. A per-table version would let a client hold a
 * stale privacy slice while its appearance slice looked current, and the
 * 409 §13.2 asks for would never fire.
 *
 * ## Rows are created lazily, by `upsert`
 *
 * A user who has never opened Settings has no row, and a read returns
 * the column defaults rather than 404 — the same choice M16.5 and M19.4
 * made, for the same reason: a settings screen opening on a 404 has
 * nothing to render. Writes `upsert`, so two tabs saving at once cannot
 * race a primary-key violation between an existence check and an insert.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { IntegrationId } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

export const INTEGRATION_FROM_WIRE: Record<string, IntegrationId> = {
  'google-calendar': IntegrationId.GOOGLE_CALENDAR,
  outlook: IntegrationId.OUTLOOK,
  zoom: IntegrationId.ZOOM,
  teams: IntegrationId.TEAMS,
};

export const INTEGRATION_TO_WIRE: Record<IntegrationId, string> = {
  GOOGLE_CALENDAR: 'google-calendar',
  OUTLOOK: 'outlook',
  ZOOM: 'zoom',
  TEAMS: 'teams',
};

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  settings(userId: string) {
    return this.prisma.db.userSetting.findUnique({ where: { userId } });
  }

  interfacePreferences(userId: string) {
    return this.prisma.db.userInterfacePreference.findUnique({ where: { userId } });
  }

  integrations(userId: string) {
    return this.prisma.db.userIntegration.findMany({
      where: { userId },
      // `oauth_tokens_enc` is **not** selected, here or anywhere else in
      // this module. M22.3 requires tokens to be write-only, and the
      // cheapest way to guarantee that is for no read path to name the
      // column at all.
      select: {
        integration: true,
        connected: true,
        connectedAt: true,
        accountLabel: true,
        updatedAt: true,
      },
    });
  }

  upsertSettings(userId: string, data: Prisma.UserSettingUncheckedUpdateInput) {
    return this.prisma.db.userSetting.upsert({
      where: { userId },
      create: { ...(data as Prisma.UserSettingUncheckedCreateInput), userId },
      update: data,
    });
  }

  upsertInterface(userId: string, data: Prisma.UserInterfacePreferenceUncheckedUpdateInput) {
    return this.prisma.db.userInterfacePreference.upsert({
      where: { userId },
      create: { ...(data as Prisma.UserInterfacePreferenceUncheckedCreateInput), userId },
      update: data,
    });
  }

  /**
   * Connects or disconnects, and the token column is written only here.
   *
   * `oauthTokensEnc` is set to `null` on disconnect rather than left in
   * place: a disconnected integration holding live credentials is a
   * grant the user believes they revoked.
   */
  setIntegration(
    userId: string,
    integration: IntegrationId,
    data: {
      readonly connected: boolean;
      readonly connectedAt: Date | null;
      readonly accountLabel: string | null;
      readonly oauthTokensEnc: Uint8Array<ArrayBuffer> | null;
    },
  ) {
    return this.prisma.db.userIntegration.upsert({
      where: { userId_integration: { userId, integration } },
      create: { userId, integration, ...data },
      update: data,
      select: {
        integration: true,
        connected: true,
        connectedAt: true,
        accountLabel: true,
        updatedAt: true,
      },
    });
  }

  /** The caller's own activity feed, for the document's `activity`. */
  activity(userId: string, take: number) {
    return this.prisma.db.userActivityLog.findMany({
      where: { userId },
      select: { id: true, occurredAt: true, kind: true, summary: true, detail: true },
      orderBy: { occurredAt: 'desc' },
      take,
    });
  }
}
