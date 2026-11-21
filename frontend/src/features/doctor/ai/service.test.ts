import { describe, expect, it } from 'vitest';

import { adapterImportOffenders } from '@/test/seam-rules';

import { AI_GENERATION_FAILED } from './model/ai-service';
import { DEFAULT_AI_SETTINGS, GENERAL_CONTEXT } from './model/types';
import { aiService } from './service';

/**
 * D-09. §9 row 4 records the frontend half as built — chat surface,
 * streaming render, retry states — and it is. What was missing was the
 * seam: `api/useAiQueries.ts` and `hooks/useChatSession.ts` imported
 * `mock/mock-ai-service` directly, the one thing `docs/handoff/auth-seam.md`
 * §1 rule 3 forbids, and the exact defect that document was written about.
 *
 * A type alone does not keep that closed — the old code typechecked
 * perfectly while reaching past the seam — so the rule is asserted over the
 * source tree instead, through the helper this test's own walk was promoted
 * to once four more seams needed it (`test/seam-rules.ts`).
 */

describe('the assistant seam', () => {
  it('is the only route to the adapter — nothing downstream imports the mock', () => {
    expect(adapterImportOffenders(__dirname, 'mock/mock-ai-service')).toStrictEqual([]);
  });

  it('exposes the whole port, so a real adapter has a complete contract to meet', () => {
    expect(Object.keys(aiService).sort()).toStrictEqual([
      'createConversation',
      'deleteConversation',
      'generateReply',
      'listConversations',
      'updateConversation',
    ]);
  });

  it('creates a conversation synchronously, because navigation depends on the id', () => {
    // Not a style preference: creating gates the ?c=<id> route change, so an
    // async callback React may drop across a remount would strand the user.
    const created = aiService.createConversation({ context: GENERAL_CONTEXT });

    expect(created.id).toMatch(/^conv/);
    expect(created).not.toBeInstanceOf(Promise);
  });

  it('answers with prose that names itself as demo output, never as a model', async () => {
    // The canned replies are realistic clinical Markdown — drug doses, ICD
    // codes, a critical sodium. That is only safe while every one of them
    // says what it is, so the disclaimer is asserted rather than trusted.
    const reply = await aiService.generateReply({
      prompt: 'Summarise this patient',
      promptId: null,
      context: GENERAL_CONTEXT,
      settings: DEFAULT_AI_SETTINGS,
      attempt: 2,
    });

    expect(reply).toMatch(/mock response/i);
    expect(reply).toMatch(/never replaces, clinical judgment/i);
  });

  it('rejects a failed generation with the code the retry path branches on', async () => {
    await expect(
      aiService.generateReply({
        prompt: 'this one [fail]s',
        promptId: null,
        context: GENERAL_CONTEXT,
        settings: DEFAULT_AI_SETTINGS,
        attempt: 1,
      }),
    ).rejects.toThrow(AI_GENERATION_FAILED);
  });
});
