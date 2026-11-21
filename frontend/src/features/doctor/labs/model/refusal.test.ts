import { describe, expect, it } from 'vitest';

import { NETWORK_WRITE_OUTCOME_UNKNOWN } from '@/api/errors';
import type { ApiError } from '@/types/api';

import { refusalOf } from './refusal';

function apiError(error: ApiError): ApiError & Error {
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

describe('refusalOf', () => {
  it('states what is known after a lost connection, not that nothing changed', () => {
    // The order may have been placed before the connection dropped or the
    // client timed out: "nothing was changed" would invite a duplicate order.
    const message = refusalOf(apiError({ kind: 'network' }));
    expect(message).toBe(NETWORK_WRITE_OUTCOME_UNKNOWN);
    expect(message).not.toMatch(/nothing was changed/i);
  });

  it('keeps the server’s own explanation of a conflict', () => {
    expect(
      refusalOf(apiError({ kind: 'conflict', detail: 'Acknowledge the critical value first' })),
    ).toBe('Acknowledge the critical value first');
  });

  it('says nothing changed when the server answered and refused', () => {
    expect(refusalOf(apiError({ kind: 'forbidden' }))).toBe(
      'You are not allowed to make this change.',
    );
    expect(refusalOf(apiError({ kind: 'server', ref: 'req-1' }))).toMatch(/Nothing was changed\./);
  });
});
