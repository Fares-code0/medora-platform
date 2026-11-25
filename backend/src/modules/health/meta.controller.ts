import { Controller, Get } from '@nestjs/common';

import { RevalidatePrivately } from '../../common/http/cache-policy';
import { Authenticated, NotPhi, OutsideClinicalStanding } from '../../shared/authz';

import { MetaService, type MetaEnumsResponse } from './meta.service';

/**
 * `GET /api/v1/meta/enums` — API §20.3, RM M27.5.
 *
 * A **separate controller from `HealthController`**, and not for tidiness:
 * that class carries `@Public()` because a probe that needs a token
 * cannot report that authentication is down. §20.3 marks this route `✓`,
 * and a route inheriting `@Public()` by sharing a class would publish the
 * platform's whole status vocabulary to anyone who asked.
 *
 * `@Authenticated()` rather than a capability: the vocabulary is not
 * anybody's data, every signed-in client of either shell needs it to
 * validate its own unions, and there is no `meta.*` capability to name.
 */
@Authenticated()
// F-09: on the allowlist for an account outside clinical standing.
@OutsideClinicalStanding()
@Controller('meta')
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  @NotPhi('status vocabularies')
  @Get('enums')
  @RevalidatePrivately()
  enums(): Promise<MetaEnumsResponse> {
    return this.meta.enums();
  }
}
