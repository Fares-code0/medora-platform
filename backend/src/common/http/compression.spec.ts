import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { shouldCompress } from './compression';

function exchange(url: string, contentType: string): [Request, Response] {
  const request = { originalUrl: url, headers: {} } as unknown as Request;
  const response = {
    getHeader: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : undefined),
  } as unknown as Response;
  return [request, response];
}

describe('shouldCompress', () => {
  it('compresses ordinary JSON and CSV', () => {
    expect(shouldCompress(...exchange('/api/v1/patients', 'application/json; charset=utf-8'))).toBe(
      true,
    );
    expect(shouldCompress(...exchange('/api/v1/patients/export', 'text/csv; charset=utf-8'))).toBe(
      true,
    );
  });

  it('never compresses a Server-Sent Events stream', () => {
    expect(
      shouldCompress(
        ...exchange('/api/v1/ai/conversations/c1/messages', 'text/event-stream; charset=utf-8'),
      ),
    ).toBe(false);
  });

  it('never compresses an auth body, which carries tokens', () => {
    expect(shouldCompress(...exchange('/api/v1/auth/login', 'application/json'))).toBe(false);
    expect(shouldCompress(...exchange('/api/v1/auth/refresh', 'application/json'))).toBe(false);
  });

  it('leaves incompressible types to the library, which refuses them', () => {
    expect(shouldCompress(...exchange('/api/v1/files/f1/download', 'image/png'))).toBe(false);
  });
});
