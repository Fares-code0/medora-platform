import { Module } from '@nestjs/common';

import { PLATFORM_POLICY_DELEGATE } from '../../config';

import { PrismaPlatformPolicySource } from './prisma-platform-policy.source';

/**
 * Binds the database layer of the policy resolution (RM M24.6).
 *
 * `ConfigModule` resolves `PLATFORM_POLICY_DELEGATE` optionally and
 * falls back to `EnvOnlyPolicySource`, so registering this module is
 * exactly the act of turning M3.3's second layer on. Removing it puts
 * the platform back on environment defaults with no other change.
 */
@Module({
  providers: [{ provide: PLATFORM_POLICY_DELEGATE, useClass: PrismaPlatformPolicySource }],
  exports: [PLATFORM_POLICY_DELEGATE],
})
export class PlatformPolicyKernelModule {}
