import fs from 'node:fs';
import path from 'node:path';

import { QueryClient } from '@tanstack/react-query';

import { clearPhiCache } from '@/api/query-client';
import { PHI_QUERY_DOMAINS } from '@/api/query-keys';

import { PREFERENCE_KEYS } from './preference-store';

/**
 * Nothing clinical reaches a disk — checklist J-10, T-03.
 *
 * ── This file was promised and did not exist ────────────────────────
 *
 * `ports.ts` has said, since it was written, that *"`phi-guard.ts` is the
 * test that proves nothing PHI-shaped reaches it"*. There was no such
 * file. The claim was true of the design and unchecked in the tree,
 * which is the same shape of defect as `docs/A11Y_AUDIT.md`'s F-5: a
 * docblock describing behaviour is not the behaviour.
 *
 * J-10's acceptance was one phrase — "asserted by test (audit R-8)" —
 * and what was actually asserted elsewhere is the *mechanism*: the token
 * storage holds one token (`security.test.ts`), the preference store
 * starts empty, `clearPhiCache` empties the listed domains, and the
 * privacy shield covers the app for the task switcher. None of that
 * answers the question J-10 actually asks, which is about the FEATURES:
 * **can a health record, an appointment or a message reach a store at
 * all?**
 *
 * ── How that question is answered ───────────────────────────────────
 *
 * Structurally, not behaviourally. A test that writes a record and
 * checks the store is empty proves one path; a scan proving no PHI
 * feature can even *reach* a store proves all of them, including the
 * path someone adds next month. The audit's four-tier policy (§12.4)
 * says PHI is memory-only, and memory-only is a property of the import
 * graph before it is a property of a code path.
 */

const SRC = path.resolve(__dirname, '..');

/**
 * The trees whose data is, or will be, a patient's chart.
 *
 * `doctors` is deliberately absent: a public practitioner projection is
 * not PHI (`docs/PUBLIC_PROJECTIONS.md`), and `recent.ts` caching viewed
 * doctors in memory is a decision that file argues for on its own terms.
 */
const PHI_FEATURES = ['health', 'appointments', 'messages', 'notifications', 'profile'];

/** Anything that can outlive the process. */
const PERSISTENCE_IMPORTS = [
  '@/storage/preference-store',
  '@/storage/durable-preference-store',
  '@/storage/secure-store',
  '@react-native-async-storage/async-storage',
  'expo-secure-store',
  'expo-file-system',
];

/** Block and line comments, so prose about a rule is not a breach of it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

describe('no clinical feature can reach a store (J-10)', () => {
  it.each(PHI_FEATURES)('%s imports nothing that outlives the process', (feature) => {
    const offenders: string[] = [];
    const files = sourceFiles(path.join(SRC, 'features', feature));

    // A scan over nothing passes. This is the assertion that stops a
    // renamed directory from turning the guard into a no-op.
    expect({ feature, scanned: files.length > 0 }).toEqual({ feature, scanned: true });

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const module of PERSISTENCE_IMPORTS) {
        if (source.includes(`from '${module}'`)) {
          offenders.push(`${path.relative(SRC, file)} → ${module}`);
        }
      }
    }

    // Not "nothing was written" — nothing *can* be written, which also
    // covers the code path nobody has added yet.
    expect(offenders).toEqual([]);
  });

  it('names every PHI feature the app actually has', () => {
    // A tree that appears without joining the list above would be
    // scanned by nothing. The check is deliberately loose about what is
    // NOT PHI — it asks only that each listed feature is real, and that
    // the list has not been quietly emptied.
    for (const feature of PHI_FEATURES) {
      expect({ feature, exists: fs.existsSync(path.join(SRC, 'features', feature)) }).toEqual({
        feature,
        exists: true,
      });
    }
    expect(PHI_FEATURES.length).toBeGreaterThan(4);
  });
});

describe('the query cache is never persisted (J-10, T-03)', () => {
  it('installs no persister, and depends on nothing that could', () => {
    // Comments stripped first: `query-client.ts` says in prose that
    // "there is NO query persistence and there will not be one", which
    // is the claim being checked rather than a violation of it.
    const client = withoutComments(
      fs.readFileSync(path.join(SRC, 'api', 'query-client.ts'), 'utf8'),
    );
    expect(client).not.toMatch(/persist/i);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(SRC, '..', 'package.json'), 'utf8'),
    ) as Record<'dependencies' | 'devDependencies', Record<string, string>>;
    const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    // The libraries that would make cached PHI survive a cold start.
    // `@tanstack/query-async-storage-persister` is the one a well-meaning
    // "make the app feel faster offline" change reaches for first.
    for (const forbidden of [
      '@tanstack/query-async-storage-persister',
      '@tanstack/react-query-persist-client',
      'redux-persist',
      'react-native-mmkv',
    ]) {
      expect({ forbidden, installed: installed.includes(forbidden) }).toEqual({
        forbidden,
        installed: false,
      });
    }
  });

  it('loses the chart when the session ends', () => {
    // The behavioural half, for the one path the structure cannot cover:
    // data that IS in memory has to leave it. `security.test.ts` asserts
    // the same sweep by domain; this asserts it against the shape a
    // records screen actually caches.
    const cache = new QueryClient();
    cache.setQueryData(['health-records', 'list', {}], [{ allergen: 'Penicillin' }]);
    cache.setQueryData(['appointments', 'detail', 'APT-1'], { reason: 'chest pain' });

    clearPhiCache(cache);

    expect(cache.getQueryData(['health-records', 'list', {}])).toBeUndefined();
    expect(cache.getQueryData(['appointments', 'detail', 'APT-1'])).toBeUndefined();
    expect(cache.getQueryCache().getAll()).toEqual([]);
  });
});

describe('the preference store cannot hold a chart (T-03)', () => {
  it('defines a closed key vocabulary, and none of it is clinical', () => {
    // `durable-preference-store.test.ts` proves hydration reads exactly
    // these keys. This proves the keys themselves are the four
    // non-clinical settings the four-tier policy allows — a fifth key
    // named after a record would fail here before it could ship.
    const clinical =
      /(patient|record|allerg|medicat|prescription|lab|result|diagnos|appointment|message|note)/i;

    for (const [name, key] of Object.entries(PREFERENCE_KEYS)) {
      expect({ name, clinical: clinical.test(key) }).toEqual({ name, clinical: false });
    }
  });

  it('is small enough that a reviewer reads the whole of it', () => {
    // Not a style rule. The store's guarantee is "everything in here is
    // non-PHI, and you can check that by reading it"; a vocabulary that
    // grew to thirty keys would be one nobody reads.
    expect(Object.keys(PREFERENCE_KEYS).length).toBeLessThanOrEqual(8);
  });
});

describe('the PHI domain list is what the features actually query (J-10)', () => {
  it('covers every clinical feature that has a query key factory', () => {
    // `security.test.ts` asserts the list contains six names. This asks
    // the harder question: does each PHI feature's own key factory use a
    // domain the sweep knows about? A feature that invented
    // `createKeyFactory('records')` would cache a chart under a prefix
    // `clearPhiCache` never removes explicitly.
    const missing: string[] = [];

    for (const feature of PHI_FEATURES) {
      for (const file of sourceFiles(path.join(SRC, 'features', feature))) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/createKeyFactory\('([\w-]+)'\)/g)) {
          const domain = match[1] ?? '';
          if (!PHI_QUERY_DOMAINS.includes(domain)) {
            missing.push(`${path.relative(SRC, file)} → ${domain}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

/**
 * **One factory per domain** — J-10, T-03.
 *
 * `notifications/keys.ts` wrote the argument down and `features/profile`
 * was the counter-example: `profileKeys` was exported from a *screen*,
 * two other screens imported it from there, and `SecurityScreen` had
 * given up and called `createKeyFactory('profile')` a second time.
 *
 * Two factories over one domain produce keys that look identical and
 * invalidate correctly **by accident rather than by construction** — the
 * day one of them is given a different string the screens stop seeing
 * each other's writes and nothing fails. The reason it belongs in *this*
 * file rather than in a style test is the second consequence:
 * `PHI_QUERY_DOMAINS` is the list `clearPhiCache` sweeps explicitly, and
 * a domain string that exists in two places is one that can be mistyped
 * in one of them. `clearPhiCache` also calls `clear()`, which is the
 * belt to that brace; the explicit pass is what makes the guarantee
 * testable per domain, and it can only test what it knows about.
 */
describe('a query domain is declared exactly once (J-10)', () => {
  function factoryCalls(): { domain: string; file: string }[] {
    const calls: { domain: string; file: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const match of withoutComments(source).matchAll(/createKeyFactory\('([\w-]+)'\)/g)) {
          calls.push({ domain: match[1] ?? '', file: path.relative(SRC, full) });
        }
      }
    };
    walk(path.join(SRC, 'features'));
    return calls;
  }

  const calls = factoryCalls();

  it('finds the factories at all, so an empty scan cannot pass', () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it('never builds the same domain twice', () => {
    const byDomain = new Map<string, string[]>();
    for (const { domain, file } of calls) {
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), file]);
    }

    const duplicated = [...byDomain.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([domain, files]) => `${domain}: ${files.join(', ')}`);

    expect(duplicated).toEqual([]);
  });
});
