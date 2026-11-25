import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi } from '../../../shared/authz';
import {
  apiKeySchema,
  integrationPatchSchema,
  isSettingsSlice,
  slicePatchSchema,
  type ApiKeyBody,
  type IntegrationPatchBody,
  type SlicePatchBody,
} from '../dto/platform-settings.schema';
import { ApiKeyService } from '../services/api-key.service';
import { BackupService } from '../services/backup.service';
import { IntegrationService } from '../services/integration.service';
import { PlatformSettingsService } from '../services/platform-settings.service';

/**
 * Platform Settings — API §19, RM M24.
 *
 * ## Two guards, because §19 names two
 *
 * The header of §19 is "**All routes:** can:`settings.manageSystem`
 * (integrations panel: can:`integrations.manage`)". Both capabilities
 * exist in the catalogue and both are seeded to the admin role, so the
 * split costs nothing today and is the difference between a platform
 * that *can* delegate integration management and one that would need a
 * code change to.
 *
 * `@Can` rather than `@Roles('admin')` — the opposite of M23's choice,
 * and for the stated reason: M23's header says "admin role" and the
 * catalogue has no `administration.*` capability; §19's header names two
 * capabilities outright.
 *
 * ## Integrations are a second controller, not a second decorator
 *
 * Nest resolves `@Can` per handler, so mixing them in one class would
 * work — but the class-level decorator is the thing a reviewer reads to
 * answer "who can reach this", and a class where that answer is "it
 * depends, scroll down" is the shape that lets a route quietly end up
 * under the wrong one.
 */
@Can('settings.manageSystem')
@Controller('platform-settings')
export class PlatformSettingsController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly apiKeys: ApiKeyService,
    private readonly backups: BackupService,
  ) {}

  /** §19.1 — the full document. */
  @NotPhi('platform configuration')
  @Get()
  read() {
    return this.settings.read();
  }

  /* ── API keys (§19.4, M24.3) ─────────────────────────────────── */

  /**
   * Declared before the slice `PATCH` and the `:slice` parameter cannot
   * capture them anyway — these are `/api-keys` under a different verb
   * and a different depth. The ordering is for a reader, not for Nest.
   */
  @NotPhi('platform configuration')
  @Get('api-keys')
  listApiKeys() {
    return this.apiKeys.list();
  }

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  createApiKey(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(apiKeySchema)) body: ApiKeyBody,
  ) {
    return this.apiKeys.create(actor, body);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(HttpStatus.OK)
  revokeApiKey(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.apiKeys.revoke(actor, id);
  }

  /* ── Backups (§19.6, M24.5) ──────────────────────────────────── */

  @NotPhi('platform configuration')
  @Get('backups')
  listBackups() {
    return this.backups.list();
  }

  @Post('backups')
  @HttpCode(HttpStatus.CREATED)
  createBackup() {
    return this.backups.create();
  }

  @Post('backups/:id/restore')
  @HttpCode(HttpStatus.OK)
  restoreBackup() {
    return this.backups.restore();
  }

  /* ── Slices (§19.2, M24.2) ───────────────────────────────────── */

  /**
   * Last, because `:slice` is a wildcard at this depth: declared above
   * `api-keys` or `backups` it would swallow `GET /platform-settings/…`
   * siblings that arrive by `PATCH` later. An unknown slice is a **404**
   * — `/platform-settings/payroll` is a resource that does not exist,
   * not a malformed request — which is the rule M22's settings
   * controller set.
   */
  @Patch(':slice')
  patchSlice(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('slice') slice: string,
    @Body(zodBody(slicePatchSchema)) body: SlicePatchBody,
  ) {
    if (!isSettingsSlice(slice)) throw AppException.notFound('Unknown settings slice');

    return this.settings.patchSlice(actor, slice, body);
  }
}

/**
 * The integrations panel — API §19.5, guarded by its own capability.
 *
 * Mounted under the same path prefix so the client sees one resource
 * tree; separated in code so the authorization decision is one line at
 * the top of the class rather than a per-handler detail.
 */
@Can('integrations.manage')
@Controller('platform-settings/integrations')
export class PlatformIntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @NotPhi('platform configuration')
  @Get()
  list() {
    return this.integrations.list();
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(zodBody(integrationPatchSchema)) body: IntegrationPatchBody,
  ) {
    return this.integrations.update(actor, id, body);
  }

  @Post(':id/test-connection')
  @HttpCode(HttpStatus.OK)
  test(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.integrations.testConnection(actor, id);
  }
}
