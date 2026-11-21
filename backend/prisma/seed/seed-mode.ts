/**
 * How a seed treats a row that already exists.
 *
 * - `refresh` (development, test, staging — `npm run db:seed`): the seed
 *   owns the content of its reference and catalogue rows, so a corrected
 *   reference range or a renamed role propagates on the next run.
 * - `create-only` (production — `npm run db:seed:production`): a row that
 *   exists is left exactly as it is. On a live database an administrator
 *   may have renamed a role or corrected a catalogue entry, and a seed that
 *   rewrote it would silently undo their work. Only what is missing is
 *   created.
 */
export type SeedMode = 'refresh' | 'create-only';

/** The `update` clause of an upsert under `mode`. */
export function refresh<T extends object>(mode: SeedMode, update: T): T | Record<string, never> {
  return mode === 'refresh' ? update : {};
}
