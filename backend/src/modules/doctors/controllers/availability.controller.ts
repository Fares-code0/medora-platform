import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Authenticated } from '../../../shared/authz';
import type {
  AvailabilitySaveResult,
  AvailabilityView,
  TimeOffResult,
  TimeOffView,
} from '../dto/availability.dto';
import {
  availabilityUpdateSchema,
  timeOffSchema,
  type AvailabilityUpdateInput,
  type TimeOffInput,
} from '../dto/availability.schema';
import { AvailabilityService } from '../services/availability.service';

/**
 * The doctor's own schedule (RM M9.4 — API §3.8, §3.9).
 *
 * ## `@Authenticated()`, not `@Roles('doctor')`, and the reason matters
 *
 * The contract marks §3.8 and §3.9 "doctor". `@Roles('doctor')` would
 * express that and would be subtly wrong: the authorization decision
 * here is **"is this account a practitioner"**, and the answer is
 * `doctors.user_id`, not `users.role_id`. Those can disagree — a
 * practitioner promoted to `reception` keeps their `doctors` row and
 * their patients — and when they disagree the row is the truth about
 * whose schedule this is.
 *
 * So the guard establishes a caller, the repository establishes which
 * practitioner they are, and an account with no `doctors` row gets 404:
 * the resource genuinely does not exist for them. A 403 would say "you
 * may not see your own availability", which is a different and untrue
 * statement.
 *
 * ## Why time off lives beside the grid
 *
 * They are two kinds of time (DB §S2 keeps them in two tables) and one
 * screen. §3.9's response is what the emergency time-off flow renders,
 * and it reads the grid to draw the calendar it overlays.
 */
@Authenticated()
@Controller('me')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  /** API §3.8 — the weekly grid, always seven days. */
  @Get('availability')
  grid(@CurrentUser() user: AuthenticatedUser): Promise<AvailabilityView> {
    return this.availability.grid(user.id);
  }

  /**
   * API §3.8 — replace it. 422 naming the row when the week is
   * inconsistent. The response adds `stranded`: live appointments the new
   * grid no longer covers, read in the clinic's timezone (BR-DEC-005).
   */
  @Put('availability')
  replaceGrid(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(availabilityUpdateSchema)) body: AvailabilityUpdateInput,
  ): Promise<AvailabilitySaveResult> {
    return this.availability.replaceGrid(user, body);
  }

  /** API §3.9 — blocks that have not finished yet. */
  @Get('time-off')
  timeOff(@CurrentUser() user: AuthenticatedUser): Promise<readonly TimeOffView[]> {
    return this.availability.timeOff(user.id);
  }

  /**
   * API §3.9 — book a block, and report what it would disturb.
   *
   * 201 with `{ timeOff, impacted }`. The impact list is a **preview**:
   * no appointment is moved here, whatever `mode` says (ADR-005
   * RA-005.2), and M11.5 owns the resolution.
   */
  @Post('time-off')
  @HttpCode(HttpStatus.CREATED)
  createTimeOff(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(timeOffSchema)) body: TimeOffInput,
  ): Promise<TimeOffResult> {
    return this.availability.createTimeOff(user, body);
  }

  /** Cancels one of the caller's own blocks. 404 for anyone else's. */
  @Delete('time-off/:timeOffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTimeOff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('timeOffId') timeOffId: string,
  ): Promise<void> {
    return this.availability.removeTimeOff(user, timeOffId);
  }
}
