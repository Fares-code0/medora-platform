import { describe, expect, it } from 'vitest';

import type { ShellSearchResult } from '@/layouts';

import { searchIndex, type IndexEntry } from './useDoctorSearchIndex';

/**
 * `searchIndex` runs on every keystroke in the navbar. Its band interleave
 * used to rescan every match once per band, building a string key per item
 * each time — bands × matches — which froze the field on a large caseload.
 *
 * `legacySearch` below is that algorithm verbatim. The rewrite must order
 * results exactly as it did; only the cost may change.
 */

const DOMAINS = ['patient', 'appointment', 'lab', 'prescription', 'record', 'destination'] as const;
type Domain = (typeof DOMAINS)[number];

function legacyRankTerm(term: string, query: string): number {
  const at = term.indexOf(query);
  if (at === -1) return 3;
  if (at === 0) return 0;
  return term[at - 1] === ' ' || term[at - 1] === '-' ? 1 : 2;
}

function legacyRankEntry(entry: IndexEntry, query: string) {
  let best = 3;
  let matchedLength = Number.MAX_SAFE_INTEGER;
  for (const term of entry.terms) {
    const rank = legacyRankTerm(term, query);
    if (rank < best || (rank === best && term.length < matchedLength)) {
      if (rank < best) matchedLength = term.length;
      else matchedLength = Math.min(matchedLength, term.length);
      best = rank;
    }
  }
  return { rank: best, matchedLength };
}

function legacySearch(index: readonly IndexEntry[], term: string): readonly ShellSearchResult[] {
  const query = term.trim().toLowerCase();
  if (query.length === 0) return [];
  const ranked: {
    entry: IndexEntry;
    rank: { rank: number; matchedLength: number };
    order: number;
  }[] = [];
  index.forEach((entry, order) => {
    const rank = legacyRankEntry(entry, query);
    if (rank.rank !== 3) ranked.push({ entry, rank, order });
  });
  ranked.sort((a, b) => {
    if (a.rank.rank !== b.rank.rank) return a.rank.rank - b.rank.rank;
    if (a.rank.matchedLength !== b.rank.matchedLength) {
      return a.rank.matchedLength - b.rank.matchedLength;
    }
    return a.order - b.order;
  });
  const bandKey = (item: (typeof ranked)[number]) =>
    `${String(item.rank.rank)}:${String(item.rank.matchedLength)}`;
  const interleaved: typeof ranked = [];
  for (const band of new Set(ranked.map(bandKey))) {
    const lanes = new Map<Domain, typeof ranked>();
    for (const item of ranked) {
      if (bandKey(item) !== band) continue;
      const lane = lanes.get(item.entry.domain);
      if (lane) lane.push(item);
      else lanes.set(item.entry.domain, [item]);
    }
    const ordered = [...lanes.entries()]
      .sort(([a], [b]) => DOMAINS.indexOf(a) - DOMAINS.indexOf(b))
      .map(([, lane]) => lane);
    for (let depth = 0; ordered.some((lane) => lane.length > depth); depth += 1) {
      for (const lane of ordered) {
        const item = lane[depth];
        if (item) interleaved.push(item);
      }
    }
  }
  const head: typeof interleaved = [];
  const tail: typeof interleaved = [];
  const seen = new Map<Domain, number>();
  for (const item of interleaved) {
    const domain = item.entry.domain;
    const count = seen.get(domain) ?? 0;
    seen.set(domain, count + 1);
    (count < 3 ? head : tail).push(item);
  }
  return [...head, ...tail].map(({ entry }) => entry.result);
}

const WORDS = [
  'amal',
  'nour',
  'khaled',
  'sara',
  'omar',
  'lab',
  'review',
  'follow-up',
  'cardiology',
  'asthma',
  'blood',
  'panel',
  'aspirin',
  'metformin',
  'annual',
  'visit',
  'x',
  'ali',
];

/** A deterministic caseload: every domain, many term lengths, many bands. */
function fixture(size: number): IndexEntry[] {
  let seed = 42;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed;
  };
  const phrase = () => {
    const length = 1 + (next() % 4);
    return Array.from({ length }, () => WORDS[next() % WORDS.length]).join(' ');
  };
  return Array.from({ length: size }, (_, i) => {
    const domain = DOMAINS[next() % DOMAINS.length] as Domain;
    const terms = [phrase(), phrase(), `id-${String(i)}`];
    return {
      domain,
      terms,
      result: {
        id: `${domain}-${String(i)}`,
        label: terms[0] ?? '',
        hint: domain,
        path: `/x/${String(i)}`,
      },
    } satisfies IndexEntry;
  });
}

describe('searchIndex', () => {
  const index = fixture(10_000);

  it.each(['a', 'al', 'lab', 'khaled', 'follow', 'id-1', ' Sara ', 'zz-no-match', ''])(
    'orders %j exactly as the previous algorithm did',
    (term) => {
      expect(searchIndex(index, term).map((r) => r.id)).toEqual(
        legacySearch(index, term).map((r) => r.id),
      );
    },
  );

  it('matches the previous order on a small mixed fixture too', () => {
    const small = fixture(60);
    for (const term of ['a', 'e', 'lab', 'review']) {
      expect(searchIndex(small, term)).toEqual(legacySearch(small, term));
    }
  });

  it('answers a one-letter query over 10,000 entries within a keystroke budget', () => {
    // Generous on purpose: this guards against a return to quadratic work,
    // not against a slow CI machine.
    searchIndex(index, 'a');
    const started = performance.now();
    const results = searchIndex(index, 'a');
    const elapsed = performance.now() - started;

    expect(results.length).toBeGreaterThan(1_000);
    expect(elapsed).toBeLessThan(250);
  });
});
