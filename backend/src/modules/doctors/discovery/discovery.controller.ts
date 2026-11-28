import { Controller, Get, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi } from '../../../shared/authz';

import type { DiscoveryRow } from './discovery.dto';
import { discoverySearchSchema, type DiscoverySearchQuery } from './discovery.schema';
import { DiscoveryService, type Page } from './discovery.service';

/**
 * Authenticated patient discovery search (DR-09, OD-10, OD-14; contract §5).
 *
 * The hospital directory itself (`GET /patient/hospitals[/:id]`) is
 * `PatientHospitalController` (ADR-050); this controller adds only the
 * cross-hospital comparison search.
 *
 * `@Authenticated()` and not `@Public()`: signed-out callers get 401. The
 * service additionally refuses any non-patient role with 403 — doctors and
 * administrators have their own rosters and must not be handed the
 * patient-facing comparison surface. There is no ownership dimension (every
 * patient sees the same hospitals), so there is nothing to answer 404 about
 * except an unknown hospital id.
 *
 * The patient's `near=lat,lng` is used for the request only; it is not
 * stored or logged.
 */
@Authenticated()
@Controller('patient')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @NotPhi('public hospital and doctor comparison; no patient data')
  @Get('discovery/search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(discoverySearchSchema)) query: DiscoverySearchQuery,
  ): Promise<Page<DiscoveryRow>> {
    return this.discovery.search(user, query);
  }
}
