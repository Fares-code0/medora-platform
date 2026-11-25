import { Body, Controller, Get, Put } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi } from '../../../shared/authz';
import {
  notificationPreferencesSchema,
  type NotificationPreferencesBody,
} from '../dto/notification.schema';
import {
  NotificationPreferenceService,
  type NotificationPreferencesView,
} from '../services/notification-preference.service';

/**
 * `GET/PUT /me/notification-preferences` — API §10.5, RM M19.4.
 *
 * Under `/me` and owned by this module, which is where M16.5 put
 * `/me/ai-settings` for the same reason: the route is self-scoped and
 * the document belongs to the feature that reads it. ADR-036 put
 * `/me/profile` in the users module on the same principle — one owner
 * per document, not one owner per prefix.
 *
 * `@Authenticated()` is the whole authorization decision. The subject of
 * the token *is* the row; there is no `userId` parameter here to
 * substitute, so there is no object to authorize beyond the caller. A
 * patient holds no capabilities (ADR-030 §6) and must still be able to
 * choose how they are contacted.
 */
@Authenticated()
@Controller('me/notification-preferences')
export class NotificationPreferenceController {
  constructor(private readonly preferences: NotificationPreferenceService) {}

  @NotPhi('the caller’s own preferences')

  @Get()
  read(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPreferencesView> {
    return this.preferences.read(user.id);
  }

  @Put()
  write(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(notificationPreferencesSchema)) body: NotificationPreferencesBody,
  ): Promise<NotificationPreferencesView> {
    return this.preferences.write(user.id, body);
  }
}
