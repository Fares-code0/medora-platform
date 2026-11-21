import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import { incidentBookmarkSchema, type IncidentBookmarkInput } from '../dto/audit.schema';
import { AuditExportService } from '../services/audit-export.service';

/**
 * Incident bookmarks — API §14.4, RM M28.4.
 *
 * Mounted under `/me` because a bookmark is the investigator's own named
 * selection, not the platform's: `incident_bookmarks.owner_id` is the
 * key, `(owner_id, name)` is unique per person, and every route here is
 * scoped to the caller. A bookmark belonging to somebody else answers
 * **404** rather than 403 — a refusal that confirms it exists tells one
 * investigator what another is looking at.
 *
 * `logs.view` because a bookmark is a list of audit events: someone who
 * may not read the ledger has no use for a saved selection of it.
 */
@Can('logs.view')
@Controller('me/incident-bookmarks')
export class IncidentBookmarkController {
  constructor(private readonly bookmarks: AuditExportService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bookmarks.bookmarks(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(incidentBookmarkSchema)) body: IncidentBookmarkInput,
  ) {
    return this.bookmarks.createBookmark(user.id, body);
  }

  @Delete(':bookmarkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookmarkId') bookmarkId: string,
  ): Promise<void> {
    return this.bookmarks.deleteBookmark(user.id, bookmarkId);
  }
}
