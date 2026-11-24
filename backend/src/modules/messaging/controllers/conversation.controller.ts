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
import { Idempotent } from '../../../shared/idempotency';
import type { MessageView } from '../dto/messaging.dto';
import {
  conversationQuerySchema,
  createConversationSchema,
  editMessageSchema,
  markReadSchema,
  patchConversationSchema,
  sendMessageSchema,
  threadQuerySchema,
  type ConversationQuery,
  type CreateConversationBody,
  type EditMessageBody,
  type MarkReadBody,
  type PatchConversationBody,
  type SendMessageBody,
  type ThreadQuery,
} from '../dto/messaging.schema';
import {
  ConversationService,
  type PaginatedConversations,
} from '../services/conversation.service';
import { MessageService } from '../services/message.service';

/**
 * Conversations — API §9.1–§9.7.
 *
 * ## `can:messages.send` guards the surface; membership guards each row
 *
 * The contract marks §9.1, §9.2 and §9.8 `can:messages.send` and the
 * thread routes "participant". Those are two different questions and
 * both are asked: the capability decides whether messaging exists for
 * this role at all, and the participant join decides which threads.
 * Neither substitutes for the other — a doctor with the capability still
 * gets 404 on a colleague's thread.
 *
 * A thread the caller is not in answers **404**, never 403: messaging
 * threads are between named people about named patients, so their
 * existence is the fact worth protecting (ADR-022's rule).
 */
@Can('messages.send')
@Controller('conversations')
export class ConversationController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
  ) {}

  @PhiRead('conversation_list')

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(conversationQuerySchema)) query: ConversationQuery,
  ): Promise<PaginatedConversations> {
    return this.conversations.list(user.id, query);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createConversationSchema)) body: CreateConversationBody,
  ): Promise<{ id: string }> {
    return this.conversations.create(user, body);
  }

  @PhiRead('messages')

  @Get(':conversationId/messages')
  thread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query(zodQuery(threadQuerySchema)) query: ThreadQuery,
  ): Promise<{ items: readonly MessageView[]; nextCursor: string | null }> {
    return this.messages.thread(user.id, conversationId, query);
  }

  @Post(':conversationId/messages')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(zodBody(sendMessageSchema)) body: SendMessageBody,
  ): Promise<MessageView> {
    return this.messages.send(user.id, conversationId, body);
  }

  @Patch(':conversationId/messages/:messageId')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body(zodBody(editMessageSchema)) body: EditMessageBody,
  ): Promise<MessageView> {
    return this.messages.edit(user.id, conversationId, messageId, body);
  }

  /**
   * API §9.5 — "delete not supported in patient threads (405)".
   *
   * The route exists so the refusal is the documented 405 rather than a
   * framework 404, which would say the resource is absent when what is
   * absent is the *method*.
   */
  @Delete(':conversationId/messages/:messageId')
  refuseDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<never> {
    return this.messages.refuseDelete(user.id, conversationId);
  }

  @Post(':conversationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(zodBody(markReadSchema)) body: MarkReadBody,
  ): Promise<{ receipted: number }> {
    return this.messages.markRead(user.id, conversationId, body.messageId);
  }

  @Patch(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(zodBody(patchConversationSchema)) body: PatchConversationBody,
  ): Promise<void> {
    return this.conversations.patch(user.id, conversationId, body);
  }
}
