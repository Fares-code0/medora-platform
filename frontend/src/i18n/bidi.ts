/**
 * Left-to-right isolation for a Latin-only value that has to travel as a
 * plain string — a badge label, a select option, a radio description —
 * where an inline `<span dir="ltr">` cannot be placed (NEW-32,
 * `docs/handoff/i18n.md` §5). Wherever the value is JSX, use the span: it is
 * what the rest of the app does, and it keeps the string itself clean.
 *
 * LRI … PDI (U+2066, U+2069) are the plain-text form of that span: inside an
 * RTL paragraph the bidi algorithm lays the run out left to right and treats
 * it as one neutral, so "30 min" stays "30 min" instead of "min 30".
 */
const LRI = '⁦';
const PDI = '⁩';
const ISOLATE_CONTROLS = /[⁦-⁩]/g;

export function isolateLtr(text: string): string {
  return `${LRI}${text}${PDI}`;
}

/** The text without isolate controls — for matching what the user typed. */
export function withoutIsolates(text: string): string {
  return text.replace(ISOLATE_CONTROLS, '');
}
