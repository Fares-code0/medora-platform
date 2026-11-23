import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The employment end revokes sessions with `SessionService.revokeAllFor`'s
 * write, copied rather than called because RM M2.2's zone 1 forbids the
 * doctors module importing auth (see the repository's header).
 *
 * A copy can drift. This spec reads both sources and holds the two
 * `session.updateMany` writes equal, so a change to what "revoke every
 * session" means in auth — another column cleared, a different filter —
 * fails here until the employment end follows it.
 */

const SESSION_SERVICE = resolve(__dirname, '../../auth/services/session.service.ts');
const EMPLOYMENT_REPOSITORY = resolve(__dirname, './doctor-employment.repository.ts');

/** The `where` and `data` of the first `session.updateMany` after `anchor`. */
function revocationWrite(file: string, anchor: string): string {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(anchor);
  expect(start, `anchor "${anchor}" not found in ${file}`).toBeGreaterThanOrEqual(0);

  const match = /session\.updateMany\(\{\s*(where:[^\n]*)\s*(data:[^\n]*)\s*\}\)/.exec(
    source.slice(start),
  );
  expect(match, `no session.updateMany after "${anchor}"`).not.toBeNull();

  return `${match?.[1] ?? ''} ${match?.[2] ?? ''}`.replace(/\s+/g, ' ').trim();
}

describe('employment end revokes sessions exactly as SessionService.revokeAllFor does', () => {
  it('writes the same filter and the same columns', () => {
    const auth = revocationWrite(SESSION_SERVICE, 'async revokeAllFor(');
    const doctors = revocationWrite(EMPLOYMENT_REPOSITORY, '3. Every live session');

    expect(auth).toContain('revokedAt: null');
    expect(doctors).toBe(auth);
  });
});
