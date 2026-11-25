import { Controller, Get, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, PhiRead } from '../../../shared/authz';
import { searchQuerySchema, type SearchQuery } from '../dto/search.schema';
import { SearchService } from '../services/search.service';

/**
 * Global search — API §16.1, RM M26.
 *
 * `@Authenticated()`, which is what §16.1's `✓` means, and the whole of
 * the authorization is *what* the caller can see rather than whether
 * they may ask. A capability would be the wrong instrument: there is no
 * `search.*` in the 22-capability catalogue, and the answer differs per
 * caller even among doctors — each one's own panel.
 */
@Authenticated()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @PhiRead('search')

  @Get()
  run(@CurrentUser() user: AuthenticatedUser, @Query(zodQuery(searchQuerySchema)) query: SearchQuery) {
    return this.search.run(user, query);
  }
}
