import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, PhiRead } from '../../../shared/authz';
import type { AiConversationDetailView, AiConversationView } from '../dto/ai.dto';
import {
  createConversationSchema,
  listConversationsSchema,
  updateConversationSchema,
  type CreateConversationInput,
  type ListConversationsQuery,
  type UpdateConversationInput,
} from '../dto/ai.schema';
import { AiConversationService } from '../services/ai-conversation.service';

/**
 * Assistant conversations — API §11.1–§11.2 (RM M16.2).
 *
 * ## `ai.use`, and administrators have no entry point
 *
 * The roadmap's header for M16 is explicit: "All routes require
 * can:`ai.use`; **admins have no entry point**." That is not enforced
 * here by checking for an admin — reconciliation §5 rule 5 forbids
 * authorization that asks "is this the admin" — but by the capability
 * itself: `ai.use` is held by the clinical roles in the seeded matrix
 * and not by `admin`, so an administrator is refused by the same
 * mechanism that refuses anyone else without it. If a deployment grants
 * it to an administrator, that is a deliberate act with an audit trail,
 * and this module does not second-guess it.
 *
 * `@Can` on the class applies to every route below, and none of them
 * narrows it further: there is no read/write split in the assistant —
 * a thread is the caller's own, and someone who may not use the
 * assistant has no threads to read.
 */
@Can('ai.use')
@Controller('ai/conversations')
export class AiConversationController {
  constructor(private readonly conversations: AiConversationService) {}

  /** API §11.1 — `GET /ai/conversations?q=&favorite=`. */
  @PhiRead('ai_conversation_list')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(listConversationsSchema)) query: ListConversationsQuery,
  ): Promise<readonly AiConversationView[]> {
    return this.conversations.list(user, query);
  }

  /** API §11.2 — one thread with its turns. */
  @PhiRead('ai_conversation')
  @Get(':conversationId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<AiConversationDetailView> {
    return this.conversations.detail(user, conversationId);
  }

  /** API §11.1 — `POST /ai/conversations`; the context is bound here. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createConversationSchema)) body: CreateConversationInput,
  ): Promise<AiConversationDetailView> {
    return this.conversations.create(user, body);
  }

  /** API §11.1 — `PATCH …/{id}`: title and favourite only. */
  @Patch(':conversationId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(zodBody(updateConversationSchema)) body: UpdateConversationInput,
  ): Promise<AiConversationDetailView> {
    return this.conversations.update(user, conversationId, body);
  }

  /**
   * API §11.1 — `DELETE …/{id}`, soft.
   *
   * 204 with no body: there is nothing useful to return, and echoing the
   * deleted thread back would be handing a client the PHI it just asked
   * to have hidden.
   */
  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<void> {
    return this.conversations.remove(user, conversationId);
  }
}
