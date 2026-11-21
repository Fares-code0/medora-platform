import { describe, expect, it } from 'vitest';

import { routes } from '@/routes';

/**
 * WEB-2 — no hospital switcher of any kind (DR-08).
 *
 * A doctor works in one active hospital, and the server resolves it from
 * their employment; nothing in this client chooses it. The 2026-10-06 plan
 * (ORG-01: an organization switcher over multiple memberships) is
 * superseded, and this file is what stops it from being built anyway — a
 * switcher is the most natural thing to add the day the session first
 * carries a hospital (WEB-1).
 *
 * Two checks. No route exists to pick a hospital, organization, clinic or
 * workspace; and no source file outside tests and stories offers a
 * control worded as one. Comments are stripped first, so this rule — and
 * the code comments that cite it — can name the thing they forbid.
 */

const sources: Record<string, string> = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const SCOPE = String.raw`(?:hospital|organi[sz]ation|clinic|tenant|workspace)s?`;

const SWITCHER_WORDING = new RegExp(
  String.raw`\b(?:switch|change|select|choose|pick)\s+(?:the\s+|your\s+|an?\s+)?(?:active\s+|current\s+)?${SCOPE}\b` +
    String.raw`|\b${SCOPE}[\s-]*(?:switcher|picker|selector|chooser)\b` +
    String.raw`|\b(?:switch|select|set)(?:Active)?(?:Hospital|Organi[sz]ation|Clinic|Tenant)\b`,
  'i',
);

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function allPaths(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node === 'function') return [String((node as (id: string) => string)('id'))];
  if (node !== null && typeof node === 'object') return Object.values(node).flatMap(allPaths);
  return [];
}

describe('no hospital switcher (WEB-2, DR-08)', () => {
  it('has no route for choosing a hospital, organization or clinic', () => {
    const offending = allPaths(routes).filter((path) =>
      /(?:select|switch|choose)[-/]?(?:hospital|organi[sz]ation|clinic|tenant|workspace)/i.test(
        path,
      ),
    );
    expect(offending).toEqual([]);
  });

  it('offers no control worded as a hospital, organization or clinic switcher', () => {
    const files = Object.entries(sources).filter(
      ([file]) => !/\.(?:test|stories)\.tsx?$/.test(file),
    );
    // A glob that matched nothing would pass vacuously.
    expect(files.length).toBeGreaterThan(100);

    const offending = files
      .filter(([, code]) => SWITCHER_WORDING.test(withoutComments(code)))
      .map(([file]) => file);
    expect(offending).toEqual([]);
  });

  it('would catch one — the pattern is not vacuous', () => {
    for (const sample of [
      '<Button>Switch hospital</Button>',
      'aria-label="Choose your organization"',
      '<HospitalSwitcher />',
      'const { setActiveHospital } = useSession();',
      'label="Clinic picker"',
    ]) {
      expect(SWITCHER_WORDING.test(withoutComments(sample)), sample).toBe(true);
    }
    expect(SWITCHER_WORDING.test(withoutComments('// never a hospital switcher'))).toBe(false);
  });
});
