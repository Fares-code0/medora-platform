import { shouldLockOnForeground } from './biometrics';
import { decideOnForeground, type SessionLockPolicy } from './lock-policy';

/**
 * The session guard (checklist D-15 / T-11, cold start).
 *
 * ── Why it exists ────────────────────────────────────────────────────
 * The biometric lock and the T-11 absence clock used to live in memory
 * only. A process killed while the lock was up, or killed in the
 * background and never foregrounded, came back on the next cold start
 * with the stored refresh token and no prompt: the warm-path decision
 * never ran. This record carries just enough across process death for
 * the cold start to apply the SAME decision (`decideOnForeground`, then
 * `shouldLockOnForeground`) before the stored token is presented.
 *
 * ── Why it names nobody ──────────────────────────────────────────────
 * A schema version, a three-value state, two booleans and one
 * epoch-millisecond timestamp of the last time the app left the
 * foreground. No user id, email, name, token or token-derived value, no
 * biometric data, no device id: it cannot say WHO is locked out, which
 * is the objection `storage.ts` raises to a stored lock. It lives in the
 * keychain beside the refresh token, through `storage.ts` only, and is
 * removed with it.
 *
 * The only legal records:
 *
 * | Record                                      | Meaning                                  |
 * |---------------------------------------------|------------------------------------------|
 * | `{"v":1,"s":"fg","lock":<bool>}`            | session standing, in the foreground      |
 * | `{"v":1,"s":"bg","at":<ms>,"lock":<bool>,"b":<bool>}` | left the foreground at `at`; `b` is the biometric opt-in at that moment |
 * | `{"v":1,"s":"ended"}`                       | tombstone: a teardown began              |
 */

export const SESSION_GUARD_KEY = 'medora.session-guard';

/** An `at` this far ahead of the clock is read as unverifiable, not as zero. */
export const FUTURE_SKEW_TOLERANCE_MS = 60_000;

/** Longer than any legal record; anything over it is corrupt. */
const MAX_ENCODED_LENGTH = 96;

export type SessionGuardRecord =
  | { readonly v: 1; readonly s: 'fg'; readonly lock: boolean }
  | {
      readonly v: 1;
      readonly s: 'bg';
      readonly at: number;
      readonly lock: boolean;
      /** The biometric opt-in when the app left the foreground. */
      readonly b: boolean;
    }
  | { readonly v: 1; readonly s: 'ended' };

export type SessionGuardRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'record'; readonly record: SessionGuardRecord };

/** What the cold start found, including a keychain that would not answer. */
export type ColdStartInput = SessionGuardRead | { readonly kind: 'unreadable' };

export type ColdStartVerdict =
  /** Exchange the stored token as before. */
  | 'restore'
  /** Exchange it, and raise the biometric lock in the step that activates. */
  | 'restore-locked'
  /** T-11: the absence ended the session. Never presented to the server. */
  | 'reauthenticate'
  /** A record that cannot be vouched for (corrupt, or `at` in the future). */
  | 'invalid'
  /** A tombstone: an earlier teardown did not finish. Finish it. */
  | 'discard'
  /** The guard could not be read. Decline to restore; delete nothing. */
  | 'hold';

export function encodeSessionGuard(record: SessionGuardRecord): string {
  // Fixed key order, and only the documented keys: the record is built
  // here from typed fields, never spread from a caller's object.
  switch (record.s) {
    case 'fg':
      return JSON.stringify({ v: 1, s: 'fg', lock: record.lock });
    case 'bg':
      return JSON.stringify({ v: 1, s: 'bg', at: record.at, lock: record.lock, b: record.b });
    case 'ended':
      return JSON.stringify({ v: 1, s: 'ended' });
  }
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/** Strict. Anything that is not exactly a legal record is `corrupt`. */
export function decodeSessionGuard(raw: string | null): SessionGuardRead {
  if (raw === null) return { kind: 'missing' };
  if (raw.length > MAX_ENCODED_LENGTH) return { kind: 'corrupt' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'corrupt' };
  }
  const value = parsed as Record<string, unknown>;
  if (value.v !== 1) return { kind: 'corrupt' };
  switch (value.s) {
    case 'fg':
      if (!hasExactly(value, ['v', 's', 'lock']) || typeof value.lock !== 'boolean') break;
      return { kind: 'record', record: { v: 1, s: 'fg', lock: value.lock } };
    case 'bg': {
      const { at, lock, b } = value;
      if (
        !hasExactly(value, ['v', 's', 'at', 'lock', 'b']) ||
        typeof at !== 'number' ||
        !Number.isSafeInteger(at) ||
        at <= 0 ||
        typeof lock !== 'boolean' ||
        typeof b !== 'boolean'
      ) {
        break;
      }
      return { kind: 'record', record: { v: 1, s: 'bg', at, lock, b } };
    }
    case 'ended':
      if (!hasExactly(value, ['v', 's'])) break;
      return { kind: 'record', record: { v: 1, s: 'ended' } };
    default:
      break;
  }
  return { kind: 'corrupt' };
}

/**
 * What a cold start does with the guard it found. Pure.
 *
 * `optInNow` is the preference as read at launch. A `bg` record also
 * carries the opt-in as it was when the app left (`b`), and either one
 * being on counts: wiping the preference store (a reinstall keeps the
 * iOS keychain, not AsyncStorage) must not turn an owed lock into none.
 */
export function decideOnColdStart(
  read: ColdStartInput,
  nowMs: number,
  policy: SessionLockPolicy,
  optInNow: boolean,
): ColdStartVerdict {
  switch (read.kind) {
    case 'unreadable':
      return 'hold';
    // The first launch after this record was introduced finds none, and
    // must not sign every patient out (accepted; see the design's R1).
    case 'missing':
      return 'restore';
    case 'corrupt':
      return 'invalid';
    case 'record':
      break;
  }
  const record = read.record;
  switch (record.s) {
    case 'ended':
      return 'discard';
    case 'fg':
      return record.lock ? 'restore-locked' : 'restore';
    case 'bg': {
      if (record.at > nowMs + FUTURE_SKEW_TOLERANCE_MS) return 'invalid';
      const action = decideOnForeground(Math.max(0, nowMs - record.at), policy);
      // T-11 is unconditional: the opt-in does not enter into it.
      if (action === 'reauthenticate') return 'reauthenticate';
      if (record.lock || shouldLockOnForeground(action, record.b || optInNow)) {
        return 'restore-locked';
      }
      return 'restore';
    }
  }
}
