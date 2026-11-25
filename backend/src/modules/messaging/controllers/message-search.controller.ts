import { Controller, Get, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, PhiRead } from '../../../shared/authz';
import { messageSearchSchema, type MessageSearchQuery } from '../dto/messaging.schema';
import { MessageService, type PaginatedSearch } from '../services/message.service';

/**
 * `GET /messages/search` — API §9.8, RM M20.5.
 *
 * Its own controller because the path is not under `/conversations`, and
 * Nest routes by controller prefix. Keeping it here rather than adding a
 * second prefix to the conversations controller keeps the route tree
 * readable from the file names.
 *
 * **The scope is in the query, not applied after it.** The repository
 * filters by `conversation.participants.some({ userId })`, so a message
 * in a thread the caller is not in is never loaded. A search that read
 * every message and dropped the ones it should not have seen is one
 * refactor away from leaking them.
 */
@Can('messages.send')
@Controller('messages')
export class MessageSearchController {
  constructor(private readonly messages: MessageService) {}

  @PhiRead('message_search')

  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(messageSearchSchema)) query: MessageSearchQuery,
  ): Promise<PaginatedSearch> {
    return this.messages.search(user.id, query);
  }
}
