import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Authenticated } from '../../../shared/authz';
import { resolveTimeOffSchema, type ResolveTimeOffInput } from '../dto/appointment.schema';
import {
  TimeOffResolutionService,
  type TimeOffResolutionResult,
} from '../services/time-off-resolution.service';

/**
 * The second phase of the emergency time-off flow (RM M11.5 — API §5.9).
 *
 * ## Why this route lives in the appointments module
 *
 * Its path begins `/me/time-off`, which is the doctors module's
 * territory — M9.4 owns creating and listing blocks. But what this
 * endpoint *does* is move appointments, and M2.2's zone 1 forbids the
 * doctors module reaching into the appointment book. The path is a URL;
 * the module boundary is about which tables a module writes. Nest routes
 * by path, not by folder, so a second controller under the same prefix
 * costs nothing and keeps each write with the module that owns its data.
 *
 * ## `@Authenticated()`, not a capability
 *
 * The subject is the caller's own time-off block, resolved through
 * `doctors.user_id`, exactly as `AvailabilityController` documents for
 * the routes that create it. There is no capability to name because
 * there is no one else's block to reach — an account with no `doctors`
 * row gets 404.
 */
@Authenticated()
@Controller('me/time-off')
export class TimeOffResolutionController {
  constructor(private readonly resolution: TimeOffResolutionService) {}

  /**
   * API §5.9 — act on a block's impact.
   *
   * 409 `blast_radius_changed` when `confirmedCount` does not match the
   * server's current impact count, and **nothing is sent** in that case.
   *
   * 200, not 201: nothing is created — existing appointments move.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':timeOffId/resolve')
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('timeOffId') timeOffId: string,
    @Body(zodBody(resolveTimeOffSchema)) body: ResolveTimeOffInput,
  ): Promise<TimeOffResolutionResult> {
    return this.resolution.resolve(user, timeOffId, body);
  }
}
