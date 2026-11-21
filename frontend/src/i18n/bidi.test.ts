import { describe, expect, it } from 'vitest';

import { isolateLtr, withoutIsolates } from './bidi';

describe('isolateLtr', () => {
  it('wraps the text in a left-to-right isolate (LRI … PDI)', () => {
    expect(isolateLtr('30 min')).toBe('⁦30 min⁩');
  });

  it('round-trips through withoutIsolates, so matching still sees the text', () => {
    expect(withoutIsolates(isolateLtr('65+'))).toBe('65+');
    expect(withoutIsolates('plain')).toBe('plain');
  });
});
