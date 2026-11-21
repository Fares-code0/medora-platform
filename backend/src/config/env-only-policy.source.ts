import { Injectable } from '@nestjs/common';

import type { PlatformPolicySource, PolicyOverrides } from './policy.types';

/**
 * The M3 stub: no database, so no overrides (RM M3.3).
 *
 * Returning `{}` rather than throwing is the correct "not configured"
 * answer here — an empty override set means the environment defaults
 * stand, which is exactly the intended behaviour before M24. That makes
 * this stub the one place in the codebase whose behaviour does *not*
 * change when the real implementation lands: M24 swaps the provider and
 * every enforcement point keeps calling `PolicyService.current()`.
 */
@Injectable()
export class EnvOnlyPolicySource implements PlatformPolicySource {
  load(): Promise<PolicyOverrides> {
    return Promise.resolve({});
  }
}
