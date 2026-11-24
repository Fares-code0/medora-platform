import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi } from '../../../shared/authz';
import type { InsightView } from '../dto/analytics.dto';
import { insightsQuerySchema, type AnalyticsQuery } from '../dto/analytics.schema';
import {
  createSavedReportSchema,
  createScheduledReportSchema,
  exportSchema,
  patchScheduledReportSchema,
  type CreateSavedReportBody,
  type CreateScheduledReportBody,
  type ExportBody,
  type PatchScheduledReportBody,
} from '../dto/reports.schema';
import { AnalyticsService } from '../services/analytics.service';
import { ReportDocumentService } from '../services/report-document.service';
import { ReportExportService } from '../services/report-export.service';

/**
 * Insights, saved reports, scheduled reports and exports — API §12.2–§12.5.
 *
 * Separate from `AnalyticsController` because that controller's own
 * header records a decision worth keeping visible: §12 names no
 * capability, so it is guarded by `appointments.manageOwn` — the
 * narrowest capability every clinician holds — rather than by a
 * permission invented for reports that no seeded role carries. The same
 * guard applies here, for the same reason and with the same reservation.
 *
 * Scope is enforced in the services regardless: every figure is keyed on
 * the caller's own `doctors` row, and every document on their own
 * `owner_id`.
 */
@Can('appointments.manageOwn')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly documents: ReportDocumentService,
    private readonly exports: ReportExportService,
  ) {}

  /** API §12.2 — the seven insight kinds. */
  @NotPhi('aggregate reporting; no patient-level data')
  @Get('insights')
  insights(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(insightsQuerySchema))
    query: Partial<AnalyticsQuery>,
  ): Promise<readonly InsightView[]> {
    return this.analytics.insights(user, query);
  }

  /* ── Saved reports — API §12.3 ───────────────────────────────── */

  @NotPhi('report definitions')

  @Get('saved')
  listSaved(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.listSaved(user.id);
  }

  @Post('saved')
  @HttpCode(HttpStatus.CREATED)
  createSaved(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createSavedReportSchema)) body: CreateSavedReportBody,
  ) {
    return this.documents.createSaved(user.id, body);
  }

  @Delete('saved/:reportId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSaved(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
  ): Promise<void> {
    return this.documents.deleteSaved(user.id, reportId);
  }

  /* ── Scheduled reports — API §12.4 ───────────────────────────── */

  @NotPhi('report schedules')

  @Get('scheduled')
  listScheduled(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.listScheduled(user.id);
  }

  @Post('scheduled')
  @HttpCode(HttpStatus.CREATED)
  createScheduled(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createScheduledReportSchema)) body: CreateScheduledReportBody,
  ) {
    return this.documents.createScheduled(user.id, body);
  }

  /** Declared before `:reportId` so `runs` is not read as an id. */
  @NotPhi('report run history; no patient-level data')
  @Get('scheduled/:reportId/runs')
  runs(@CurrentUser() user: AuthenticatedUser, @Param('reportId') reportId: string) {
    return this.documents.runs(user.id, reportId);
  }

  @Patch('scheduled/:reportId')
  @HttpCode(HttpStatus.NO_CONTENT)
  patchScheduled(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Body(zodBody(patchScheduledReportSchema)) body: PatchScheduledReportBody,
  ): Promise<void> {
    return this.documents.patchScheduled(user.id, reportId, body);
  }

  @Delete('scheduled/:reportId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteScheduled(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
  ): Promise<void> {
    return this.documents.deleteScheduled(user.id, reportId);
  }

  /* ── Export — API §12.5 ──────────────────────────────────────── */

  /**
   * CSV is returned as a file rather than inside the `{ data }`
   * envelope: it is bytes for a download, not a resource a client reads
   * fields off. `excel` and `pdf` answer 501 — see the service.
   */
  @Post('export')
  @Header('Cache-Control', 'no-store')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(exportSchema)) body: ExportBody,
    @Res() response: Response,
  ): Promise<void> {
    this.exports.assertSynchronous(body.format);

    const file = await this.analytics.exportCsv(user, body);

    response
      .status(HttpStatus.OK)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
      .send(file.content);
  }
}
