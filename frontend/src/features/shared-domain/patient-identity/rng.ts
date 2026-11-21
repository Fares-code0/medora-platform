/**
 * Deterministic mock-data helpers shared by the roster and profile
 * generators. Seeded generation keeps every session's dataset identical
 * (stable ids, reproducible bug reports). Deleted with the mock layer
 * when the real API lands.
 */

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash for seeding per-entity generators (FNV-1a). */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function pick<T>(items: readonly T[], random: number): T {
  const item = items[Math.floor(random * items.length) % items.length];
  if (item === undefined) throw new Error('pick() requires a non-empty array');
  return item;
}

/** Weighted choice from [value, weight] pairs. */
export function weighted<T>(entries: ReadonlyArray<readonly [T, number]>, random: number): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = random * total;
  for (const [value, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  const last = entries[entries.length - 1];
  if (last === undefined) throw new Error('weighted() requires entries');
  return last[0];
}

const DAY_MS = 86_400_000;

export function isoDaysFromNow(days: number, hour: number, minute: number): string {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}
