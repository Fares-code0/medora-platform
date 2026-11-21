import { Global, Module } from '@nestjs/common';

import { ActivityKernelModule } from './activity';
import { AiKernelModule } from './ai';
import { AuditKernelModule } from './audit';
import { AuthzKernelModule } from './authz';
import { CryptoKernelModule } from './crypto';
import { DatabaseModule } from './database';
import { FileStorageKernelModule } from './files';
import { JobsKernelModule } from './jobs';
import { MailKernelModule } from './mail';
import { MetricsKernelModule } from './metrics';
import { OutboxKernelModule } from './outbox';
import { PlatformPolicyKernelModule } from './platform-policy';
import { PushKernelModule } from './push';
import { CacheKernelModule } from './cache';
import { IdempotencyKernelModule } from './idempotency';
import { RateLimitKernelModule } from './rate-limit';

/**
 * The shared kernel (RM M2.3).
 *
 * `@Global` because these tokens are the substitute for cross-module
 * imports, which M2.2's boundary rule forbids. Requiring all nineteen
 * domain modules to list `SharedKernelModule` in their `imports` would
 * add nineteen lines that can only ever say the same thing, and
 * forgetting one produces a DI error at boot rather than a useful signal.
 *
 * Global is used sparingly and only here: a global provider is invisible
 * in a module's dependency list, which is a real cost. It is paid once,
 * for the kernel every module depends on by construction.
 *
 * Two kernels have no providers and so are absent below: status machines
 * and PHI masking are pure functions, imported directly from
 * `shared/status` and `shared/phi`.
 *
 * `MailKernelModule` joined at M6 (ADR-025): three modules send mail and
 * none of them may import another, so the sender has to sit below all of
 * them. `AuthzKernelModule` joined at M7 (ADR-027) for the same reason —
 * every module needs the guard, so it cannot live in any one of them.
 * `ActivityKernelModule` joined at M8.6 on the same argument: the six
 * activity kinds are written from six different modules, so the recorder
 * has to sit below all of them.
 *
 * `CryptoKernelModule` joined at M24 on the M6 argument exactly:
 * `platform_integrations.config_enc` (§19.5) and `user_credentials`'
 * TOTP secret are the same write-only-ciphertext problem in two
 * modules, and neither may import the other, so the cipher moved below
 * both rather than being written twice.
 *
 * `JobsKernelModule` joined at M30.1 on the strongest form of the
 * argument yet. Eight domain modules own periodic work and none may
 * import another, so a scheduler inside any one of them could reach the
 * other seven only by breaking M2.2 — and the exit gate for M30 is
 * precisely that no module runs a timer of its own. The registry has to
 * sit below all of them, and every module registers *into* it.
 *
 * `AiKernelModule` joined at M16.1, and for a reason the others only
 * partly share. The assistant has one caller today, so centralising the
 * *call* would not yet be worth a kernel — what has to be centralised is
 * the **credential**. `AI_API_KEY` is reachable from exactly one folder,
 * and the only way that stays true as M21's summaries and other
 * generation surfaces arrive is for there to be no second place a
 * provider client could plausibly live.
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    ActivityKernelModule,
    CryptoKernelModule,
    AiKernelModule,
    AuditKernelModule,
    OutboxKernelModule,
    PlatformPolicyKernelModule,
    FileStorageKernelModule,
    MailKernelModule,
    AuthzKernelModule,
    JobsKernelModule,
    MetricsKernelModule,
    PushKernelModule,
    RateLimitKernelModule,
    IdempotencyKernelModule,
    CacheKernelModule,
  ],
  exports: [
    DatabaseModule,
    ActivityKernelModule,
    CryptoKernelModule,
    AiKernelModule,
    AuditKernelModule,
    OutboxKernelModule,
    PlatformPolicyKernelModule,
    FileStorageKernelModule,
    MailKernelModule,
    AuthzKernelModule,
    JobsKernelModule,
    MetricsKernelModule,
    PushKernelModule,
    CacheKernelModule,
  ],
})
export class SharedKernelModule {}
