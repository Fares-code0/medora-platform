import type { AiService } from '../model/types';

/**
 * The mock-build adapter: an assistant that is not configured.
 *
 * It rejects every call with the same shape `normalizeHttpError` builds
 * for `503 service_unavailable`, so the screens take exactly the path
 * they take against a real server that has no provider. See `service.ts`
 * for why this is not a script.
 */
function unconfigured(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error('API error: server'), {
      kind: 'server' as const,
      status: 503,
      code: 'service_unavailable',
      ref: 'HTTP-503',
    }),
  );
}

export const fixtureAiService: AiService = {
  createConversation: unconfigured,
  listConversations: unconfigured,
  getConversation: unconfigured,
  deleteConversation: unconfigured,
  // eslint-disable-next-line require-yield -- refuses before the first frame, as the real route does.
  async *sendMessage() {
    await unconfigured();
  },
};
