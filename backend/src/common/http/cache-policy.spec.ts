import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { NO_STORE, REVALIDATE_PRIVATELY, RevalidatePrivatelyInterceptor } from './cache-policy';

function contextFor(headers: Map<string, string>): ExecutionContext {
  const response = { setHeader: (name: string, value: string) => headers.set(name, value) };

  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ExecutionContext;
}

describe('RevalidatePrivatelyInterceptor', () => {
  it('marks a successful response revalidate-only', async () => {
    const headers = new Map([['Cache-Control', NO_STORE]]);
    const next: CallHandler = { handle: () => of({ data: 1 }) };

    await lastValueFrom(new RevalidatePrivatelyInterceptor().intercept(contextFor(headers), next));

    expect(headers.get('Cache-Control')).toBe(REVALIDATE_PRIVATELY);
  });

  it('leaves no-store on a response whose handler threw', async () => {
    const headers = new Map([['Cache-Control', NO_STORE]]);
    const next: CallHandler = { handle: () => throwError(() => new Error('not found')) };

    await expect(
      lastValueFrom(new RevalidatePrivatelyInterceptor().intercept(contextFor(headers), next)),
    ).rejects.toThrow('not found');
    expect(headers.get('Cache-Control')).toBe(NO_STORE);
  });
});
