import fs from 'node:fs';
import path from 'node:path';

import { TOKEN_ERROR_CODES } from '@/types/api';

/**
 * Auth error-code parity with the backend — checklist A1.
 *
 * `useAuthErrorMessage.ts` once mapped `account_locked`, `otp_expired`
 * and `token_expired`, none of which the backend sends, while it had no
 * entry for `account_inactive`, which it does. Every test passed,
 * because every test fed the mapper the same invented codes. This suite
 * reads the backend's own code list and fails when the auth client
 * branches on a code that is not in it.
 *
 * Read from source rather than imported, for `parity.test.ts`'s reason:
 * this package must not depend on the backend's. Skipped, loudly, when
 * the backend tree is absent.
 *
 * Note: CI's path filter runs this suite for `backend/prisma/schema/
 * 01-enums.prisma` and `backend/src/modules/auth/dto/`, not yet for
 * `backend/src/common/errors/error-codes.ts`; a backend-only change to
 * that file is caught on the next patient-app run, not on its own PR.
 */

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BACKEND_CODES = path.join(ROOT, '..', 'backend', 'src', 'common', 'errors', 'error-codes.ts');
const AUTH_DIR = __dirname;

const backendPresent = fs.existsSync(BACKEND_CODES);
const describeIfBackend = backendPresent ? describe : describe.skip;

/** The string members of `export const NAME = [ … ] as const`. */
function constArray(source: string, name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(source);
  if (match === null) throw new Error(`${name} was not found in error-codes.ts.`);
  const body = (match[1] ?? '').replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1] ?? '');
}

/** Production source files of the auth feature, comments stripped. */
function authSources(): { file: string; source: string }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Fixtures and dev adapters may simulate anything; they are not
        // what a patient's build branches on.
        if (entry.name !== 'fixtures' && entry.name !== 'dev') walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(full);
      }
    }
  };
  walk(AUTH_DIR);
  return files.map((file) => ({
    file: path.relative(AUTH_DIR, file),
    source: fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));
}

/** Every code the auth client branches on, with where it does so. */
function mappedCodes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const { file, source } of authSources()) {
    // `.code === 'x'` anywhere.
    for (const match of source.matchAll(/\.code\s*===\s*'([a-z_]+)'/g)) {
      found.set(match[1] ?? '', file);
    }
    // `case 'x':` inside a `switch (….code)`, up to the next `switch`.
    for (const block of source.matchAll(
      /switch\s*\([\w.]*\.code\)\s*\{([\s\S]*?)(?=switch\s*\(|$)/g,
    )) {
      for (const match of (block[1] ?? '').matchAll(/case\s+'([a-z_]+)'\s*:/g)) {
        found.set(match[1] ?? '', file);
      }
    }
  }
  return found;
}

describeIfBackend('the auth client maps only codes the backend sends (A1)', () => {
  // Read in `beforeAll`, not in the describe body: Jest still runs the
  // body of a `describe.skip`, and parsing an absent file there failed
  // the suite instead of skipping it.
  let backendCodes = new Set<string>();
  beforeAll(() => {
    const source = fs.readFileSync(BACKEND_CODES, 'utf8');
    backendCodes = new Set([
      ...constArray(source, 'AUTH_ERROR_CODES'),
      ...constArray(source, 'COMMON_ERROR_CODES'),
    ]);
  });

  it('reads a plausible list from the backend', () => {
    // A regex that silently matched nothing would make every check below
    // vacuous.
    expect(backendCodes.has('invalid_credentials')).toBe(true);
    expect(backendCodes.has('unauthorized')).toBe(true);
    expect(backendCodes.size).toBeGreaterThan(10);
  });

  it('finds the mapper’s branches, so the scan is not vacuous', () => {
    const mapped = mappedCodes();
    expect(mapped.get('invalid_credentials')).toBe('useAuthErrorMessage.ts');
    expect(mapped.size).toBeGreaterThan(4);
  });

  it('branches on no code the backend does not define', () => {
    const unknown = [...mappedCodes()].filter(([code]) => !backendCodes.has(code));
    expect(unknown).toEqual([]);
  });

  it('refreshes only on a code the backend defines', () => {
    expect(TOKEN_ERROR_CODES.filter((code) => !backendCodes.has(code))).toEqual([]);
  });

  it('gives account_inactive its own message', () => {
    expect(backendCodes.has('account_inactive')).toBe(true);
    expect(mappedCodes().has('account_inactive')).toBe(true);
  });
});
