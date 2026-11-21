import { Module } from '@nestjs/common';

import { PUSH_PROVIDER } from './push.types';
import { UnconfiguredPushProvider } from './unconfigured-push-provider';

/**
 * The push provider (M41.2). Bound to `UnconfiguredPushProvider` until a
 * provider is chosen and credentialed — see `docs/EXTERNAL_INTEGRATIONS.md`.
 * Binding a real one is a change to this file only: the delivery worker
 * and the registration route depend on the port.
 */
@Module({
  providers: [{ provide: PUSH_PROVIDER, useClass: UnconfiguredPushProvider }],
  exports: [PUSH_PROVIDER],
})
export class PushKernelModule {}
