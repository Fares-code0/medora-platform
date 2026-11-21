import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { CORRELATION_ID_HEADER, getCorrelationId, resolveCorrelationId } from './correlation';
import { REDACTED_KEYS, REDACTION_PATHS } from './redaction';

function fakeRequest(headerValue?: string | string[]): Request {
  return {
    headers: headerValue === undefined ? {} : { [CORRELATION_ID_HEADER]: headerValue },
  } as unknown as Request;
}

describe('resolveCorrelationId', () => {
  it('uses the client-supplied id — the client sends one per request', () => {
    expect(resolveCorrelationId(fakeRequest('corr-123'))).toBe('corr-123');
  });

  it('generates a uuid when the header is absent', () => {
    expect(resolveCorrelationId(fakeRequest())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('takes the first value when a header arrives repeated', () => {
    expect(resolveCorrelationId(fakeRequest(['first', 'second']))).toBe('first');
  });

  /**
   * The id is written into log lines, so an unsanitised value is a log
   * forgery vector: a newline lets a caller inject a fabricated entry
   * into an audit-adjacent stream.
   */
  it('strips characters that would let a caller forge log lines', () => {
    expect(resolveCorrelationId(fakeRequest('abc\ndef ghi'))).toBe('abcdefghi');
  });

  it('caps length so an oversized header cannot bloat every log line', () => {
    const id = resolveCorrelationId(fakeRequest('a'.repeat(500)));
    expect(id).toHaveLength(128);
  });

  it('falls back to a uuid when sanitising leaves nothing', () => {
    expect(resolveCorrelationId(fakeRequest('!!!!'))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is stable across calls for one request', () => {
    const request = fakeRequest();
    expect(getCorrelationId(request)).toBe(getCorrelationId(request));
  });
});

describe('PHI redaction list (MG §11.6, DB §10)', () => {
  it('covers credentials, direct identifiers, and clinical content', () => {
    for (const key of ['password', 'accessToken', 'mrn', 'dateOfBirth', 'diagnoses', 'notes']) {
      expect(REDACTED_KEYS).toContain(key);
    }
  });

  it('redacts the auth and cookie headers', () => {
    expect(REDACTION_PATHS).toContain('req.headers.authorization');
    expect(REDACTION_PATHS).toContain('req.headers.cookie');
  });

  it('covers each sensitive key at the root and under req.body', () => {
    expect(REDACTION_PATHS).toContain('mrn');
    expect(REDACTION_PATHS).toContain('req.body.password');
    expect(REDACTION_PATHS).toContain('*.dateOfBirth');
  });
});
