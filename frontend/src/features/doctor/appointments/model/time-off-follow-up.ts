import type { TimeOffBlock, TimeOffKind } from './time-off-service';

/**
 * What survives a Block Time Off flow that was interrupted — the record that
 * lets Upcoming Time Off offer the follow-up again.
 *
 * Booking a block is two server calls (`createBlock`, then `resolve`), and
 * only the first is unconditional. If the doctor leaves the page, reloads,
 * or loses the network in between, the block can exist on the server while
 * the appointments inside it were never decided — and the API returns the
 * impact list only with the create. So the flow writes down, per signed-in
 * user and in this browser:
 *
 * - `saving` — *before* the create is sent: a request whose outcome is not
 *   known yet. A failure that does not prove a refusal (the network dropped,
 *   the server errored, the page went away) leaves it in place, because the
 *   server may well have booked the block.
 * - `follow-up` — the server confirmed a block that has appointments inside
 *   it, and the doctor has not yet decided what happens to them.
 *
 * Reconciling against the server's own list (`GET /me/time-off`) turns a
 * `saving` record into a `follow-up` when a block with that exact window and
 * kind exists, and drops it once it is clear none does. The record holds the
 * window, the kind and the block id — no patient data; the impact itself is
 * re-read from the server when the follow-up is opened (`previewImpact`).
 */

export interface TimeOffWindow {
  readonly from: string;
  readonly to: string;
  readonly kind: TimeOffKind;
}

export type FollowUpRecord =
  | (TimeOffWindow & { readonly state: 'saving'; readonly id: string; readonly at: number })
  | (TimeOffWindow & {
      readonly state: 'follow-up';
      readonly id: string;
      readonly at: number;
      readonly blockId: string;
    });

const KEY_PREFIX = 'medora.timeOff.followUp.v1:';

/**
 * How long an unmatched `saving` record is treated as possibly still in
 * flight before the absence of a matching block is taken to mean it was not
 * booked. Generous against a slow network; short against a doctor's memory.
 */
export const SAVING_GRACE_MS = 2 * 60_000;

const storageKey = (userId: string) => `${KEY_PREFIX}${userId}`;

function isRecord(value: unknown): value is FollowUpRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const window =
    typeof record.id === 'string' &&
    typeof record.from === 'string' &&
    typeof record.to === 'string' &&
    (record.kind === 'vacation' || record.kind === 'emergency-block') &&
    typeof record.at === 'number';
  if (!window) return false;
  if (record.state === 'saving') return true;
  return record.state === 'follow-up' && typeof record.blockId === 'string';
}

/** Every record for this user; empty when storage is unavailable or unreadable. */
export function readFollowUps(userId: string): readonly FollowUpRecord[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

export function writeFollowUps(userId: string, records: readonly FollowUpRecord[]): void {
  try {
    if (records.length === 0) window.localStorage.removeItem(storageKey(userId));
    else window.localStorage.setItem(storageKey(userId), JSON.stringify(records));
  } catch {
    // Storage blocked (private mode, quota): the flow still works; only the
    // after-the-fact recovery is lost, and the in-page guard still applies.
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Notes a create that is about to be sent; returns the record's id. */
export function startSaving(userId: string, window: TimeOffWindow, now = Date.now()): string {
  const id = newId();
  writeFollowUps(userId, [
    ...readFollowUps(userId),
    { state: 'saving', id, from: window.from, to: window.to, kind: window.kind, at: now },
  ]);
  return id;
}

/**
 * The server booked the block. With appointments inside it the follow-up is
 * outstanding until `clearBlock`; with none there is nothing left to do.
 */
export function settleSaved(
  userId: string,
  recordId: string,
  block: TimeOffBlock,
  impactedCount: number,
): void {
  const rest = readFollowUps(userId).filter((record) => record.id !== recordId);
  if (impactedCount === 0) {
    writeFollowUps(userId, rest);
    return;
  }
  writeFollowUps(userId, [
    ...rest.filter((record) => record.state !== 'follow-up' || record.blockId !== block.id),
    {
      state: 'follow-up',
      id: recordId,
      blockId: block.id,
      from: block.startsAt,
      to: block.endsAt,
      kind: block.kind,
      at: Date.now(),
    },
  ]);
}

/** The server refused the create, so nothing was booked. */
export function settleRefused(userId: string, recordId: string): void {
  writeFollowUps(
    userId,
    readFollowUps(userId).filter((record) => record.id !== recordId),
  );
}

/** The follow-up for this block is done (resolved, or deliberately left). */
export function clearBlock(userId: string, blockId: string): void {
  writeFollowUps(
    userId,
    readFollowUps(userId).filter(
      (record) => record.state !== 'follow-up' || record.blockId !== blockId,
    ),
  );
}

/** Whether a block on the server is the one this window asked for. */
export function sameWindow(window: TimeOffWindow, block: TimeOffBlock): boolean {
  return (
    window.kind === block.kind &&
    new Date(window.from).getTime() === new Date(block.startsAt).getTime() &&
    new Date(window.to).getTime() === new Date(block.endsAt).getTime()
  );
}

export interface Reconciled {
  /** Records to keep, with every matched `saving` turned into a `follow-up`. */
  readonly records: readonly FollowUpRecord[];
  /** Blocks whose follow-up is outstanding, by block id. */
  readonly followUps: ReadonlyMap<string, FollowUpRecord>;
  /** Saves younger than the grace period that match no block yet. */
  readonly stillSaving: readonly FollowUpRecord[];
  /** Saves past the grace period that match no upcoming block: not booked, or already over. */
  readonly notFound: readonly FollowUpRecord[];
}

/**
 * Reconciles the local records with the server's list of upcoming blocks.
 * A follow-up whose block is no longer listed (cancelled, or ended) is
 * dropped: there is nothing left to decide about it.
 */
export function reconcile(
  records: readonly FollowUpRecord[],
  blocks: readonly TimeOffBlock[],
  now = Date.now(),
): Reconciled {
  const kept: FollowUpRecord[] = [];
  const followUps = new Map<string, FollowUpRecord>();
  const stillSaving: FollowUpRecord[] = [];
  const notFound: FollowUpRecord[] = [];

  for (const record of records) {
    if (record.state === 'follow-up') {
      if (blocks.some((block) => block.id === record.blockId)) {
        kept.push(record);
        followUps.set(record.blockId, record);
      }
      continue;
    }
    const match = blocks.find((block) => sameWindow(record, block));
    if (match !== undefined) {
      if (followUps.has(match.id)) continue;
      const promoted: FollowUpRecord = {
        state: 'follow-up',
        id: record.id,
        blockId: match.id,
        from: match.startsAt,
        to: match.endsAt,
        kind: match.kind,
        at: record.at,
      };
      kept.push(promoted);
      followUps.set(match.id, promoted);
    } else if (now - record.at < SAVING_GRACE_MS) {
      kept.push(record);
      stillSaving.push(record);
    } else {
      notFound.push(record);
    }
  }

  return { records: kept, followUps, stillSaving, notFound };
}
