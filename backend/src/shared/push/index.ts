/**
 * Public API — the push provider port (M41.2).
 *
 * Modules import from `shared/push`, never from a file inside it.
 */
export { PushKernelModule } from './push.module';
export {
  PUSH_PROVIDER,
  type PushMessage,
  type PushOutcome,
  type PushProvider,
  type PushTarget,
} from './push.types';
export { UnconfiguredPushProvider } from './unconfigured-push-provider';
