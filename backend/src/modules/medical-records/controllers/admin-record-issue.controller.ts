import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { HospitalScope, PhiRead, Roles } from '../../../shared/authz';
import {
  recordIssueListSchema,
  updateRecordIssueSchema,
  type RecordIssueListQuery,
  type UpdateRecordIssueInput,
} from '../dto/record-issue.schema';
import {
  RecordIssueService,
  type PaginatedRecordIssues,
  type RecordIssueView,
} from '../services/record-issue.service';

/**
 * The administrators' queue behind `POST /medical-records/{id}/report-issue`
 * (API §6.9, RM M12.7). In this module rather than in administration's,
 * because M2.2 zone 1 gives `record_issue_reports` to medical records —
 * the path is `/admin/…`, as `/admin/appointments` lives in appointments.
 */
// A hospital function (F-01, OD-07): its Hospital Admin, confined to it.
@HospitalScope()
@Roles('admin')
@Controller('admin/record-issues')
export class AdminRecordIssueController {
  constructor(private readonly issues: RecordIssueService) {}

  @PhiRead('record_issue')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(recordIssueListSchema)) query: RecordIssueListQuery,
  ): Promise<PaginatedRecordIssues> {
    return this.issues.list(user, query);
  }

  /** Triage (`investigating`) or close (`resolved`); 409 on an illegal or lost move. */
  @Patch(':issueId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('issueId') issueId: string,
    @Body(zodBody(updateRecordIssueSchema)) body: UpdateRecordIssueInput,
  ): Promise<RecordIssueView> {
    return this.issues.update(user, issueId, body);
  }
}
