/**
 * Public API — configuration (RM M3).
 *
 * `env.ts` is deliberately **not** exported. It is the only code that
 * touches `process.env`, and a module that could reach it could read a
 * raw secret straight out of the environment; everything a module needs
 * is on `ConfigService` and `PolicyService` in typed form. The
 * `import/no-restricted-paths` zone enforces this — importing
 * `config/env` from a module is a lint error.
 */
export { ConfigModule } from './config.module';
export { ConfigService } from './config.service';
export { PolicyService } from './policy.service';
export {
  PLATFORM_POLICY_DELEGATE,
  PLATFORM_POLICY_SOURCE,
  type PlatformPolicySource,
  type PolicyOverrides,
  type PolicySettings,
} from './policy.types';
export type { AppEnv, Env } from './env.schema';
export type { TrustProxySetting } from './trust-proxy';
