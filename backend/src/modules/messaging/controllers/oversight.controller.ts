import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, Roles } from '../../../shared/authz';
import {
  accessRequestSchema,
  flagQuerySchema,
  oversightQuerySchema,
  resolveFlagSchema,
  type AccessRequestBody,
  type FlagQuery,
  type OversightQuery,
  type ResolveFlagBody,
} from '../dto/oversight.schema';
import { OversightService } from '../services/oversight.service';

/**
 * Administrative oversight of messaging — API §9.11, RM M20.7.
 *
 * ## Three capabilities, not one
 *
 * `communications.viewMetadata`, `viewContent` and `resolveFlags` are
 * separate permissions in the seeded matrix, and they are applied
 * separately here. Metadata never exposes a message body; content needs
 * its own capability **and** an active grant (ADR-006 §1). Guarding the
 * whole controller with one capability would collapse a deliberate
 * separation into a convenience.
 *
 * ⚠️ **No frontend consumer.** ADM-06 (`/admin/communications`) is
 * unbuilt — `FRONTEND_CHECKLIST.md` §4 — and wiring it is **M39.6**. The
 * gate is verified by contract test until then, which is what ADR-006's
 * *Frontend integration* note already anticipated.
 */
@Controller('admin')
export class OversightController {
  constructor(private readonly oversight: OversightService) {}

  @Can('communications.viewMetadata')
  @Get('conversations')
  list(@Query(zodQuery(oversightQuerySchema)) query: OversightQuery) {
    return this.oversight.listConversations(query);
  }

  // Multi-hospital §2.1: an administrator holds no standing PHI capability,
  // so message content is reached only through this route's own controlled
  // access (ADR-006 / M20.7): a justified request, approval by a different
  // administrator, a limited lifetime and an audit row on every read. The
  // grant, checked by OversightService, is the authorization; the role rule
  // (with the guard's administrative tiering) only says who may ask.
  @Roles('admin')
  @Post('conversations/:conversationId/access-request')
  requestAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(zodBody(accessRequestSchema)) body: AccessRequestBody,
  ) {
    return this.oversight.requestAccess(user.id, conversationId, body);
  }

  // Multi-hospital §2.1: an administrator holds no standing PHI capability,
  // so message content is reached only through this route's own controlled
  // access (ADR-006 / M20.7): a justified request, approval by a different
  // administrator, a limited lifetime and an audit row on every read. The
  // grant, checked by OversightService, is the authorization; the role rule
  // (with the guard's administrative tiering) only says who may ask.
  @Roles('admin')
  @Post('conversations/access-requests/:requestId/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string) {
    return this.oversight.approve(user.id, requestId);
  }

  // Multi-hospital §2.1: an administrator holds no standing PHI capability,
  // so message content is reached only through this route's own controlled
  // access (ADR-006 / M20.7): a justified request, approval by a different
  // administrator, a limited lifetime and an audit row on every read. The
  // grant, checked by OversightService, is the authorization; the role rule
  // (with the guard's administrative tiering) only says who may ask.
  @Roles('admin')
  @Get('conversations/:conversationId/content')
  content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.oversight.viewContent(user.id, conversationId);
  }

  @Can('communications.resolveFlags')
  @Get('message-flags')
  flags(@Query(zodQuery(flagQuerySchema)) query: FlagQuery) {
    return this.oversight.listFlags(query);
  }

  @Can('communications.resolveFlags')
  @Post('message-flags/:flagId/resolve')
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('flagId') flagId: string,
    @Body(zodBody(resolveFlagSchema)) body: ResolveFlagBody,
  ) {
    return this.oversight.resolveFlag(user.id, flagId, body);
  }
}
