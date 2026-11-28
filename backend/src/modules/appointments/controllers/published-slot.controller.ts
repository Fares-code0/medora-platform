import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi } from '../../../shared/authz';
import { Idempotent } from '../../../shared/idempotency';
import {
  publishedSlotListSchema,
  publishSlotsSchema,
  type PublishedSlotListQuery,
  type PublishSlotsInput,
} from '../dto/published-slot.schema';
import {
  PublishedSlotService,
  type PublishedSlotPage,
  type PublishedSlotView,
} from '../services/published-slot.service';

/**
 * `/me/published-slots` — the doctor publishes and withdraws online slots
 * at the active hospital (`API_CONTRACT_CHANGES.md` §6; DR-10, OD-08;
 * audit SLT-01).
 *
 * `appointments.manageOwn` is the existing capability for the doctor's
 * own book, and a published slot is the doctor offering a place in it —
 * no new permission. The hospital and employment are the caller's active
 * clinical employment, resolved server-side; an account without one gets
 * 404 on writes and an empty list on the read.
 */
@Can('appointments.manageOwn')
@Controller('me/published-slots')
export class PublishedSlotController {
  constructor(private readonly slots: PublishedSlotService) {}

  /** The caller's own slots, with their status. No patient data. */
  @NotPhi('the doctor’s own published slots; no patient fields')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(publishedSlotListSchema)) query: PublishedSlotListQuery,
  ): Promise<PublishedSlotPage> {
    return this.slots.listOwn(user, query);
  }

  /** Publish one slot or a batch; all or nothing. */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(publishSlotsSchema)) body: PublishSlotsInput,
  ): Promise<PublishedSlotView[]> {
    return this.slots.publish(user, body);
  }

  /** Withdraw an unbooked slot of one's own; a booked one is 409. */
  @Delete(':slotId')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slotId') slotId: string,
  ): Promise<PublishedSlotView> {
    return this.slots.withdraw(user, slotId);
  }
}
