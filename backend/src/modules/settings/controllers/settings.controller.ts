import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { AppException } from '../../../common/errors/app.exception';
import { Authenticated, NotPhi } from '../../../shared/authz';
import {
  INTEGRATION_IDS,
  slicePatchSchema,
  SETTINGS_SECTIONS,
  type IntegrationWireId,
  type SettingsSection,
  type SlicePatchBody,
} from '../dto/settings.schema';
import { SettingsService } from '../services/settings.service';

/**
 * The Settings Center — API §13, RM M22.
 *
 * `@Authenticated()` is the whole authorization decision, for the same
 * reason `/me/ai-settings` and `/me/notification-preferences` carry it:
 * the subject of the token **is** the document, there is no `userId`
 * parameter to substitute, and §13's own header says the surface is
 * "reused by admins as *My Settings*" — a capability check would deny
 * the second audience it names.
 *
 * The section is validated against a closed list rather than passed to
 * a lookup: an unknown section answers **404**, because
 * `/me/settings/payroll` is a resource that does not exist, not a
 * malformed request.
 */
@Authenticated()
@Controller('me')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @NotPhi('the caller’s own settings')

  @Get('settings')
  read(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.read(user.id);
  }

  @Patch('settings/:section')
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('section') section: string,
    @Body(zodBody(slicePatchSchema)) body: SlicePatchBody,
  ) {
    if (!isSection(section)) throw AppException.notFound('Unknown settings section');

    return this.settings.patch(user.id, section, body.updatedAt, body.value);
  }

  @Post('integrations/:integrationId/connect')
  @HttpCode(HttpStatus.OK)
  connect(@CurrentUser() user: AuthenticatedUser, @Param('integrationId') id: string) {
    if (!isIntegration(id)) throw AppException.notFound('Unknown integration');

    return this.settings.connect(user.id, id);
  }

  @Post('integrations/:integrationId/disconnect')
  @HttpCode(HttpStatus.OK)
  disconnect(@CurrentUser() user: AuthenticatedUser, @Param('integrationId') id: string) {
    if (!isIntegration(id)) throw AppException.notFound('Unknown integration');

    return this.settings.disconnect(user.id, id);
  }

  /**
   * API §13.4 — own-activity export.
   *
   * **Not implemented, and it cannot be honestly stubbed.** The contract
   * describes an "async job → file → notification": the job runner is
   * **M30.1**'s queue registry and the file needs `FILE_STORAGE.put`,
   * which rejects with 503 until **M25** — deliberately, so that a file
   * id is never handed back for bytes that do not exist. Returning a job
   * id here would promise a user their data on a queue nothing drains.
   */
  @Post('data-export')
  dataExport(): never {
    throw new AppException(501, {
      message:
        'Data export is not implemented yet. It needs the M30 job runner and M25 file storage.',
      code: 'not_implemented',
    });
  }
}

function isSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

function isIntegration(value: string): value is IntegrationWireId {
  return (INTEGRATION_IDS as readonly string[]).includes(value);
}
