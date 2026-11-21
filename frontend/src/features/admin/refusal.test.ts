import { describe, expect, it } from 'vitest';

import { NETWORK_WRITE_OUTCOME_UNKNOWN } from '@/api/errors';
import { notConnected } from '@/api/http';
import type { ApiError } from '@/types/api';

import { adminRefusal, loadFailureDescription } from './refusal';

/** The words an administrator reads when the platform says no (FE-10.10). */

function apiError(error: ApiError): ApiError & Error {
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

describe('adminRefusal', () => {
  it('prints the server’s own explanation of a conflict, as a sentence', () => {
    expect(
      adminRefusal(apiError({ kind: 'conflict', detail: 'This is the last active admin' })),
    ).toBe('This is the last active admin.');
    expect(adminRefusal(apiError({ kind: 'conflict', detail: 'Already decided.' }))).toBe(
      'Already decided.',
    );
  });

  it('names the first field a validation refusal complains about', () => {
    expect(
      adminRefusal(apiError({ kind: 'validation', fieldErrors: { reason: ['Say why'] } })),
    ).toBe('Say why.');
    expect(adminRefusal(apiError({ kind: 'validation', fieldErrors: {} }))).toMatch(/not accept/);
  });

  it('words every other kind plainly, never as "API error"', () => {
    const cases: ApiError[] = [
      { kind: 'forbidden' },
      { kind: 'not_found' },
      { kind: 'auth' },
      { kind: 'rate_limited', retryAfterSeconds: 30 },
      { kind: 'network' },
      { kind: 'server', ref: 'ERR-9' },
    ];
    for (const error of cases) {
      const text = adminRefusal(apiError(error));
      expect(text).not.toMatch(/API error/);
      expect(text.length).toBeGreaterThan(10);
    }
    expect(adminRefusal(apiError({ kind: 'server', ref: 'ERR-9' }))).toContain('ERR-9');
    expect(adminRefusal(notConnected('Doctor invitations'))).toMatch(/not connected/);
  });

  it('does not claim nothing changed when the connection was lost', () => {
    // A write can apply before the connection drops or the client times out.
    const message = adminRefusal(apiError({ kind: 'network' }));
    expect(message).toBe(NETWORK_WRITE_OUTCOME_UNKNOWN);
    expect(message).not.toMatch(/nothing was changed/i);
  });

  it('passes a demo store’s own refusal through', () => {
    expect(adminRefusal(new Error('That doctor is no longer on the platform.'))).toBe(
      'That doctor is no longer on the platform.',
    );
    expect(adminRefusal('???')).toMatch(/did not accept/);
  });
});

describe('loadFailureDescription', () => {
  it('explains the failures Retry cannot fix', () => {
    expect(loadFailureDescription(apiError({ kind: 'forbidden' }))).toMatch(/permission/);
    expect(loadFailureDescription(apiError({ kind: 'auth' }))).toMatch(/Sign in/);
    expect(loadFailureDescription(apiError({ kind: 'network' }))).toBeUndefined();
    expect(loadFailureDescription(new Error('x'))).toBeUndefined();
  });
});
