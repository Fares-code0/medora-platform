import fs from 'node:fs';
import path from 'node:path';

import { selectImplementation } from '@/api/seam';

/**
 * Messaging stays blocked (owner decision, 2026-11-26): a build that is not a
 * mock build must refuse every method by name and serve no thread.
 */
describe('messages in a production build', () => {
  it('selects the http side, never the fixture threads, when mocks are off', () => {
    expect(selectImplementation(false, { fixture: 'fixture', http: 'http' })).toBe('http');
  });

  it('passes unavailableService as that http side', () => {
    const source = fs.readFileSync(path.join(__dirname, 'service.ts'), 'utf8');
    expect(source).toMatch(/http:\s*unavailableService<MessagingService>/);
  });
});
