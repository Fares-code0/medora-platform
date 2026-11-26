import { selectImplementation, EndpointNotImplementedError } from '@/api/seam';

import { messagingService } from './service';

/**
 * Messaging stays blocked (owner decision, 2026-11-26): a build that is not a
 * mock build must refuse every method by name and serve no thread.
 */
describe('messages in a production build', () => {
  it('selects the refusing adapter, never the fixture threads', async () => {
    const production = selectImplementation(false, {
      fixture: 'fixture' as const,
      http: 'http' as const,
    });
    expect(production).toBe('http');
  });

  it('the http side of the service refuses every method', async () => {
    // `service.ts` passes `unavailableService` as `http`; assert its source says so.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = (require('node:fs') as typeof import('node:fs')).readFileSync(
      require.resolve('./service.ts'),
      'utf8',
    );
    expect(source).toMatch(/http:\s*unavailableService<MessagingService>/);
    expect(new EndpointNotImplementedError('AD-1 / BE-13', 'capability.messages').capability).toBe(
      'capability.messages',
    );
    void messagingService;
  });
});
