import { Controller, Get, Param, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi } from '../../../shared/authz';
import { bookableSlotQuerySchema, type BookableSlotQuery } from '../dto/published-slot.schema';
import { PublishedSlotService, type BookableSlots } from '../services/published-slot.service';

/**
 * `GET /patient/doctors/:doctorId/slots?from&to` — the bookable inventory
 * of one doctor (`API_CONTRACT_CHANGES.md` §6, §10 `get_available_slots`;
 * DR-10; audit SLT-02).
 *
 * Only published, unwithdrawn, future, unoccupied slots; never working
 * hours (AST-C6). `@Authenticated()` because a patient holds no
 * capability (ADR-030 §6), with the patients-only check in the service —
 * `@Roles()` cannot name `patient` by design. Discovery requires sign-in
 * (DR-09), not a linked record.
 */
@Authenticated()
@Controller('patient/doctors')
export class PatientSlotController {
  constructor(private readonly slots: PublishedSlotService) {}

  @NotPhi('published slot inventory; no patient data')
  @Get(':doctorId/slots')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Query(zodQuery(bookableSlotQuerySchema)) query: BookableSlotQuery,
  ): Promise<BookableSlots> {
    return this.slots.bookable(user, doctorId, query);
  }
}
