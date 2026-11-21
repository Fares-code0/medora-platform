import appConfig from '../../../app.json';

/**
 * The forced-upgrade gate (checklist W-06).
 *
 * ── Why a mobile client needs one and the SPA does not ───────────────
 * A web deployment replaces itself: the next page load is the new build,
 * and a defect can be withdrawn in minutes. An installed app cannot be
 * force-refreshed (MG §15.5). A build with a broken token path, a wrong
 * clinical vocabulary, or a disclosure defect keeps running on the
 * patient's phone until they choose to update — through a store review
 * queue measured in days. The only lever the operator has is the ability
 * to tell an old build to stop.
 *
 * That lever has to exist **before** the first release. Adding it in
 * version 2 does nothing for the copies of version 1 already installed,
 * which is precisely the population it would be needed for.
 *
 * ── Where the minimum comes from ─────────────────────────────────────
 * From a response header on the calls this client already makes — NOT
 * from a new endpoint. There is no version endpoint in the API contract
 * and inventing one is forbidden (§11 of the brief, `parity.test.ts`).
 * Reading a header off a response the client was making anyway invents
 * no route, costs no request, and works on whatever the app happens to
 * call first.
 *
 * **The backend does not send this header yet.** `docs/DECISIONS.md`
 * records deprecation headers as part of RM **M41.2**, which is
 * untouched. So the client half is built, tested and inert: with no
 * header the state is `unknown` and nothing is gated. When M41.2 lands
 * and agrees the spelling below, the gate starts working with no client
 * change. That is the honest shape — the same one `unavailableService`
 * takes for absent endpoints.
 *
 * ── Failing OPEN, deliberately ───────────────────────────────────────
 * Every ambiguous case resolves to "let the patient through": no header,
 * an unparseable header, an unparseable app version. A gate that fired
 * on a malformed value would let one bad deploy brick every installed
 * copy at once — the exact catastrophe this mechanism exists to prevent,
 * pointed the wrong way. The header can only ever *tighten* access, so
 * the safe direction when it cannot be read is to ignore it.
 */

/** The header the operator sets to raise the floor. Pending RM M41.2. */
export const MINIMUM_VERSION_HEADER = 'X-Minimum-App-Version';

export interface AppVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * `major.minor.patch`, and nothing cleverer.
 *
 * Pre-release and build metadata (`1.2.0-beta.1`, `1.2.0+42`) are
 * accepted and their suffix ignored rather than rejected: a store build
 * carrying one is still that version for the purpose of "is this old
 * enough to stop", and rejecting it would fail open on a version that
 * could have been compared. Anything else — missing parts, non-numeric
 * parts, empty — returns `null`.
 */
export function parseVersion(raw: string | null | undefined): AppVersion | null {
  if (typeof raw !== 'string') return null;
  const match = /^\s*(\d+)\.(\d+)\.(\d+)(?:[-+].*)?\s*$/.exec(raw);
  if (match === null) return null;
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null;
  }
  return { major, minor, patch };
}

/** Negative when `a` is older, 0 when equal, positive when `a` is newer. */
export function compareVersions(a: AppVersion, b: AppVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function formatVersion(version: AppVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * `unknown` is a first-class state, not an error.
 *
 * It is what the app is in today and for every request that carries no
 * header, and it renders exactly as `supported` does. Keeping the two
 * apart matters for the tests and for anyone reading the state later:
 * "the server did not say" and "the server said this build is fine" are
 * different facts, and collapsing them would hide the day the header
 * stops arriving.
 */
export type UpgradeState = 'unknown' | 'supported' | 'upgrade-required';

/** The whole decision, pure — no header, no clock, no React. */
export function decideUpgrade(
  currentRaw: string | null | undefined,
  minimumRaw: string | null | undefined,
): UpgradeState {
  const minimum = parseVersion(minimumRaw);
  if (minimum === null) return 'unknown';

  const current = parseVersion(currentRaw);
  // The app cannot read its own version. Nothing to compare against, and
  // locking a patient out over it would be a defect gating a defect.
  if (current === null) return 'unknown';

  return compareVersions(current, minimum) < 0 ? 'upgrade-required' : 'supported';
}

/**
 * The running build's version, read from `app.json` — the same value
 * `expo export` stamps into the bundle and the stores display.
 *
 * A JSON import rather than `expo-constants`: `Constants.expoConfig` is
 * reachable but `expo-constants` is a transitive dependency this package
 * does not declare, and `docs/ARCHITECTURE.md` requires every dependency
 * to be named against the capability that needs it. The JSON import needs
 * no dependency at all and resolves identically under TypeScript, Metro
 * and Jest.
 */
export const CURRENT_APP_VERSION: string = appConfig.expo.version;
