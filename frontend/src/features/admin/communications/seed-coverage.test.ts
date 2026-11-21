import { describe, expect, it } from 'vitest';

import { SEED_CONVERSATIONS } from '@/features/shared-domain/conversations';

import { detectCategories } from './flag-rules';

/**
 * The seam between the shared corpus and this feature's rules.
 *
 * It lives here rather than beside the seed because shared-domain may not
 * import a role feature (FRONTEND_ARCHITECTURE §3.3, enforced by ESLint).
 * The direction that is legal is also the honest one: the rules depend on
 * the seed, not the seed on the rules.
 */

describe('the shared seed, seen through the flag rules', () => {
  it('trips exactly three of the four categories', () => {
    const found = new Set<string>();
    for (const conversation of SEED_CONVERSATIONS) {
      for (const message of conversation.messages) {
        for (const category of detectCategories(message.body)) found.add(category);
      }
    }

    // An exact set, not a subset. It fails when a seeded flag stops matching
    // AND when an unintended message starts matching — including harassment,
    // which must stay unseeded because there is no inoffensive seed for it
    // and this corpus is also the doctor's inbox.
    expect(found).toEqual(
      new Set(['emergency-language', 'phi-wrong-channel', 'prescription-solicitation']),
    );
  });
});
