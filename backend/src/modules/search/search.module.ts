import { Module } from '@nestjs/common';

import { SearchController } from './controllers/search.controller';
import { SearchRepository } from './repositories/search.repository';
import { SearchService } from './services/search.service';

/**
 * Search — API §16.1, RM M26.
 *
 * Reads six other modules' tables through its own repository, which is
 * what M2.2's zone 1 requires of a module that needs another's *data*:
 * a cross-section index cannot be assembled by asking each owner without
 * importing all of them, and the alternative — every module publishing
 * its rows to a search index — is M31/M32 infrastructure this milestone
 * does not own.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchRepository, SearchService],
})
export class SearchModule {}
