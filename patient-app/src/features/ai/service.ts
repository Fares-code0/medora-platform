import { selectService } from '@/api/seam';

import { fixtureAiService } from './fixtures/ai-fixtures';
import { httpAiService } from './http-ai-service';
import type { AiService } from './model/types';

/**
 * The patient assistant.
 *
 * `http` is live: the five `/me/ai/conversations` routes. The server
 * answers `503 service_unavailable` while no model provider is
 * configured, which is today's truth, and the screens render it as an
 * honest "not available yet".
 *
 * ── The fixture is the 503, not a script ─────────────────────────────
 *
 * Mock builds get an adapter that **refuses exactly as an unconfigured
 * server does**. There is no scripted reply, no greeting and no canned
 * answer anywhere in this tree: a machine answering a medical question
 * with words no clinician has read is the harm this feature is gated
 * against, and a development build that did it would train everyone to
 * expect it. `ai-honesty.test.ts` enforces that.
 */
export const aiService: AiService = selectService({
  fixture: fixtureAiService,
  http: httpAiService,
});
