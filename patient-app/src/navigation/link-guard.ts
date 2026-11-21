/**
 * The deep-link input guard — `docs/DEPENDENCIES.md` §4.1.
 *
 * ── The advisory this exists for ─────────────────────────────────────
 *
 * One dependency advisory reaches a patient's phone rather than the
 * machine that builds the app: `decode-uri-component` ←
 * `query-string` ← `@react-navigation/core`, a denial of service
 * through exponential decoding of **malformed percent-encoded input**,
 * with **no fix available at any version**.
 *
 * The reachable input is a deep link. `@react-navigation/core`'s
 * `getStateFromPath` is the function that parses the query string, and
 * it runs before any of this app's own code sees the URL — so a crafted
 * `medora://…` opened on the device hangs the JS thread. Nothing is
 * disclosed and nothing is remote; something has to make the phone open
 * that URL, and a hang is recoverable by force-quitting. It is still the
 * one advisory a patient can be on the wrong end of.
 *
 * `DEPENDENCIES.md` §4.1 listed three things that **bound** it — a
 * closed route table, `deep-link.ts`'s allow-list on server-supplied
 * links, and the fact that a hang is survivable — and said in as many
 * words that none of them is a fix. This is the missing one: the
 * vulnerable parser is never reached with input it cannot survive.
 *
 * ── Why a refusal and not a sanitiser ───────────────────────────────
 *
 * Repairing a malformed escape means deciding what the author meant,
 * and the input here is hostile by assumption. A link this app or its
 * server produced never contains a malformed escape, so refusing one
 * costs a patient nothing and guessing could route them somewhere they
 * did not ask to go — which on a screen that shows a chart is the more
 * expensive mistake.
 *
 * A refused link resolves to **nothing**, which is already what §4.1
 * says an unmatched path does: the app opens where it would have opened
 * anyway. It is not an error state, because there is no action a patient
 * can take about a link they did not knowingly follow.
 *
 * ── What this does NOT do ────────────────────────────────────────────
 *
 * It is not a fix for the advisory and `DEPENDENCIES.md` still carries
 * it. `decode-uri-component` is still in the tree, still reachable from
 * any other caller `query-string` may acquire, and the entry stays until
 * a fixed version exists or React Navigation drops the dependency. This
 * closes the one path into it that this app opens.
 *
 * It is also **not** the O-04 allow-list. `deep-link.ts` decides which
 * server-supplied links may navigate at all — a policy about
 * destinations. This decides whether a string is safe to hand to a
 * parser, and applies to every link from every source, including one a
 * patient taps in a mail client.
 */

/**
 * The longest link this app can legitimately receive, with room to
 * spare: the longest declared route is `appointments/:appointmentId`,
 * and an id is short. A cap is the cheap half of the guard — the
 * decoder's cost is superlinear in the length of the malformed run, so
 * bounding the length bounds the worst case even for input the escape
 * check would pass.
 */
const MAX_LINK_LENGTH = 512;

/**
 * A `%` that is not the start of a well-formed `%XX` escape.
 *
 * This is the exact shape the advisory needs, and the exact shape no
 * link this system produces has: `encodeURIComponent` cannot emit one.
 */
const MALFORMED_ESCAPE = /%(?![0-9A-Fa-f]{2})/;

/** Whether a path is safe to hand to React Navigation's parser. */
export function isSafeLinkPath(path: string): boolean {
  if (path.length > MAX_LINK_LENGTH) return false;
  return !MALFORMED_ESCAPE.test(path);
}
