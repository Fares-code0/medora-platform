/**
 * A clinical literal, as a patient reads it.
 *
 * ── The rule this implements, and where it is written ───────────────
 *
 * `messages/en.ts` draws one line and this is the far side of it:
 * **clinical vocabulary the record itself is written in** — allergy
 * severity, medication status, lab-result flags, the kind of a history
 * entry — stays in English until W-10's clinical owner signs off on a
 * translation. These are the words a clinician chose and the one a
 * paramedic reads off a phone; getting "severe" subtly wrong in a
 * language nobody on this project speaks natively is a different class
 * of mistake from a mistranslated button.
 *
 * Not translating them is a decision. Rendering the *wire literal* is
 * not, and that is the defect this function closes: the medical-history
 * row read `hospitalization · 14 September 2026`, a lower-case database
 * value on a screen, while the two badges beside it had each
 * capitalised their own literal inline. One implementation, three
 * callers, and a place for the rule to be written down.
 *
 * A-07's "field names are law" is untouched: the literal is still what
 * this client sends and compares. This is only what it draws.
 */
export function clinicalWord(literal: string): string {
  return literal.charAt(0).toUpperCase() + literal.slice(1);
}
