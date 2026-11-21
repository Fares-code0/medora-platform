/**
 * The background-jobs screen — RM M30.1, admin-only.
 *
 * Mounted under `/administration` because the Administration Center is
 * where the platform is monitored (MG §5: "monitors platform status —
 * system health, license, registrations, audit events"), and guarded the
 * way every other route in that centre is: `@Roles('admin')`, the same
 * coarse guard M23 chose because the permission catalogue has no
 * `administration.*` capability and inventing one would put a permission
 * on the wire that no seeded role holds.
 *
 * `jobs.dto.ts` records why this exists instead of a mounted Bull Board.
 */

import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Roles } from '../../../shared/authz';
import type { DeadLetterView, JobTriggerView, JobsView } from '../dto/jobs.dto';
import { JobsService } from '../services/jobs.service';

@Roles('admin')
@Controller('administration/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  overview(): JobsView {
    return this.jobs.overview();
  }

  /**
   * Declared before `:name/run` in the file, and on a path that cannot
   * collide with it anyway — a job name is dotted (`audit.retention-
   * sweep`) and this segment is not, so no schedule can shadow it.
   */
  @Get('dead-letters')
  deadLetters(@Query('job') job?: string): readonly DeadLetterView[] {
    return this.jobs.deadLetterList(job);
  }

  @Post('dead-letters/:id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  replay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<JobTriggerView> {
    return this.jobs.replay(user, id);
  }

  /**
   * 202, not 200: the run has been accepted, not completed. A caller
   * that needed the result polls the overview, whose `lastRunAt` and
   * `lastOutcome` are what the run produces.
   */
  @Post(':name/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Param('name') name: string,
  ): Promise<JobTriggerView> {
    return this.jobs.trigger(user, name);
  }
}
