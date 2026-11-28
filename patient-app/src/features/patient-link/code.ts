/**
 * Presenting a link code — pure, so each rule is testable alone.
 *
 * A patient reads this code aloud to a person at a desk, or turns the
 * phone round to show it. So it is grouped (4-4, the contract's display
 * rule), and a screen reader spells it character by character: read as a
 * word, "K7XM" is unpronounceable and "AB2C" is "ab-two-see".
 */

/** `ABCDEFGH` → `ABCD EFGH`. Anything not eight long is shown as it came. */
export function groupCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/**
 * `ABCD2345` → `A B C D, 2 3 4 5`: one character per word, the comma a
 * pause where the visual gap is.
 */
export function spokenCode(code: string): string {
  const spell = (part: string) => part.split('').join(' ');
  return code.length === 8 ? `${spell(code.slice(0, 4))}, ${spell(code.slice(4))}` : spell(code);
}

/** Whole seconds until `expiresAt`, floored at 0. An unparsable instant is expired. */
export function secondsUntil(expiresAt: string, now: number): number {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((at - now) / 1000));
}

/** `m:ss`, with Latin digits — the code itself is Latin, and so is its clock. */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
