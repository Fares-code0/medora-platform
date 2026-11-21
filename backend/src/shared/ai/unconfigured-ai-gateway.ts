import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';

import type {
  AiDelta,
  AiGatewayPort,
  AiGenerationRequest,
  AiModelDescription,
} from './ai-gateway.types';

/**
 * The binding until a provider is wired: every generation answers 503.
 *
 * The same choice `UnconfiguredFileStorage` makes, for a sharper reason.
 * A stub that returned canned prose would be worse than a failure: the
 * answer would arrive in a clinical assistant's own voice, rendered in
 * the chat exactly as a real one, with nothing on screen to say a model
 * was never consulted. A clinician reading "no interaction found" has no
 * way to know whether anything looked. Failing loudly is the only honest
 * behaviour.
 *
 * `/health` already reports `ai: unconfigured` when `AI_PROVIDER` and
 * `AI_API_KEY` are unset (ADR-016, API §20.1), and `ConfigService`
 * already computes it — so the endpoint and this binding agree by
 * construction rather than by coincidence.
 *
 * **Everything else about the assistant still works.** Conversations,
 * context binding, settings, prompts and feedback are this module's own
 * data and do not need a model; only `POST …/messages` reaches a
 * provider. So the surface a deployment gets without a key is the whole
 * assistant minus generation, which is exactly what M16.4 persists as a
 * message with status `error`.
 */
@Injectable()
export class UnconfiguredAiGateway implements AiGatewayPort {
  /**
   * Rejects on the first pull, before any delta.
   *
   * Written as a plain method returning an async iterable rather than as
   * an `async *` generator, because a generator whose body only throws
   * never yields — which lint correctly objects to, and suppressing that
   * would hide the same objection on a generator that *should* have
   * yielded. The shape returned is the one the port promises, and
   * `next()` rejecting is what "throws before the first delta" means to
   * a `for await`.
   */
  generate(_request: AiGenerationRequest, _signal?: AbortSignal): AsyncIterable<AiDelta> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<AiDelta> => ({
        next: () => Promise.reject(unconfigured()),
      }),
    };
  }

  describe(): AiModelDescription {
    return {
      name: 'Medora Clinical Assistant',
      version: 'unconfigured',
      configured: false,
    };
  }
}

function unconfigured(): AppException {
  return new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
    message: 'The AI assistant is not configured',
    code: 'service_unavailable',
    detail: 'Set AI_PROVIDER and AI_API_KEY to enable generation',
  });
}
