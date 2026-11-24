import { Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import {
  AdminScoped,
  Can,
  CurrentAdminScope,
  hospitalFilterOf,
  type ResolvedAdminScope,
} from '../../../shared/authz';
import {
  auditExportSchema,
  auditQuerySchema,
  type AuditExportInput,
  type AuditQuery,
} from '../dto/audit.schema';
import { AuditExportService } from '../services/audit-export.service';
import { AuditQueryService } from '../services/audit-query.service';
import { AuditRetentionService } from '../services/audit-retention.service';

/**
 * The audit ledger — API §14.1–§14.3, RM M28.3–M28.4.
 *
 * ## Read-only, and there is no route that is not
 *
 * §14's own header: "Read-only for everyone — no mutation endpoints
 * exist." The export is a `POST` because its filters do not fit in a
 * query string, not because it changes anything; it creates no audit
 * *row* of its own except the one recording that somebody exported.
 *
 * ## `logs.view` and `logs.export`, which the catalogue already has
 *
 * Two capabilities rather than one, because §14.3 names them separately
 * and the difference is real: reading an incident is investigation, and
 * taking a hundred thousand records out of the platform in a file is a
 * different act with a different blast radius.
 */
@Can('logs.view')
// S5 (OD-07 #16 item 7): Platform Admin — the whole metadata-only ledger,
// unchanged; Hospital Admin — rows with its `hospital_id` only (another
// hospital's event is 404); no administrative scope — 403.
@AdminScoped('any')
@Controller('audit-events')
export class AuditController {
  constructor(
    private readonly query: AuditQueryService,
    private readonly exports: AuditExportService,
    private readonly retention: AuditRetentionService,
  ) {}

  /** §14.1 — filters, keyset pagination, pivot and the retention meta. */
  @Get()
  async list(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Query(zodQuery(auditQuerySchema)) query: AuditQuery,
  ) {
    return this.query.list(query, await this.retention.retentionDays(), hospitalFilterOf(scope));
  }

  /**
   * §14.3 — the export.
   *
   * Declared before `:eventId`, or `export` is read as an event id and
   * the route answers 404 — the ordering rule M13 and M14 both record.
   * Streamed through `@Res` because the body is a CSV file rather than
   * an envelope: a client saves it, and wrapping it in `{ data: … }`
   * would make every consumer unwrap a spreadsheet.
   */
  @Post('export')
  @Can('logs.export')
  @Header('Cache-Control', 'no-store')
  async export(
    @CurrentUser() actor: AuthenticatedUser,
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Query(zodQuery(auditExportSchema)) input: AuditExportInput,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.exports.export(actor, input, hospitalFilterOf(scope));

    response
      .status(200)
      .setHeader('Content-Type', file.contentType)
      .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.body);
  }

  /** §14.2 — the full payload and the correlated events. */
  @Get(':eventId')
  detail(@CurrentAdminScope() scope: ResolvedAdminScope, @Param('eventId') eventId: string) {
    return this.query.detail(eventId, hospitalFilterOf(scope));
  }
}
