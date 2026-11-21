import { Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service';
import { EnvOnlyPolicySource } from './env-only-policy.source';
import { loadEnv } from './env';
import { PolicyService } from './policy.service';
import {
  PLATFORM_POLICY_DELEGATE,
  PLATFORM_POLICY_SOURCE,
  type PlatformPolicySource,
} from './policy.types';

/**
 * Configuration (RM M3).
 *
 * `@Global` for the same reason the shared kernel is (ADR-019 §3):
 * configuration is a dependency of essentially every module, and
 * nineteen identical `imports:` lines would carry no information.
 *
 * `loadEnv()` is memoised, so the factory does not re-parse — and by the
 * time Nest calls it, `main.ts` has already validated the environment
 * and reported any problem in readable form.
 */
@Global()
@Module({
  providers: [
    { provide: ConfigService, useFactory: (): ConfigService => new ConfigService(loadEnv()) },
    /**
     * The database layer when one is registered, the environment alone
     * when it is not (RM M24.6).
     *
     * `PLATFORM_POLICY_DELEGATE` is filled by
     * `shared/platform-policy/`, which can reach Prisma; `config/`
     * cannot, and lint zone 6 is what says so. Resolving it optionally
     * here keeps the fallback honest — `ConfigModule` on its own, in a
     * unit test with no database, still answers with the env defaults.
     */
    {
      provide: PLATFORM_POLICY_SOURCE,
      useFactory: (delegate?: PlatformPolicySource): PlatformPolicySource =>
        delegate ?? new EnvOnlyPolicySource(),
      inject: [{ token: PLATFORM_POLICY_DELEGATE, optional: true }],
    },
    PolicyService,
  ],
  exports: [ConfigService, PolicyService, PLATFORM_POLICY_SOURCE],
})
export class ConfigModule {}
