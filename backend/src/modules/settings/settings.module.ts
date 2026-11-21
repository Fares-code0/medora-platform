import { Module } from '@nestjs/common';

import { ActivityKernelModule } from '../../shared/activity';
import { AuditKernelModule } from '../../shared/audit';
import { DatabaseModule } from '../../shared/database';

import { SettingsController } from './controllers/settings.controller';
import { SettingsRepository } from './repositories/settings.repository';
import { SettingsService } from './services/settings.service';

/**
 * Doctor Settings Center — API §13. M22.
 *
 * The per-user settings document: privacy, workflow preferences,
 * appearance, accessibility, integrations and the activity feed. Revision
 * 1 built account/security (M8) and profile (M9) but never the document
 * itself, which is the frontend's most-used non-clinical surface.
 *
 * **One document, two tables, one version.** `user_settings` holds
 * privacy and workflow; `user_interface_preferences` holds appearance and
 * accessibility. The `updatedAt` the client carries is the later of the
 * two, so a stale slice cannot look current because the *other* table
 * was written recently.
 *
 * **Tokens are write-only structurally.** `oauth_tokens_enc` is named by
 * exactly one method — the one that writes it — so no read path can leak
 * it by forgetting to strip a projection.
 *
 * Not built here, each for a stated reason:
 *
 * · **M22.3 connect** — "OAuth server-side" needs a client id, secret and
 *   redirect URI per provider and none is configured; see RA-M22.1.
 *   Disconnect *is* built, because revoking needs no provider.
 * · **M22.4 data export** — an async job into a file, which is M30.1's
 *   runner and M25's storage. See RA-M22.2.
 */
@Module({
  imports: [DatabaseModule, ActivityKernelModule, AuditKernelModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository],
})
export class SettingsModule {}
