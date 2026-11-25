/**
 * Bidirectional isolation for values placed inside a translated sentence.
 *
 * A sentence in Arabic that embeds a Latin hospital name, a doctor's
 * name or a phone number is laid out by the bidi algorithm using the
 * sentence's direction, and the embedded run's neighbours leak into it:
 * punctuation and digits drift to the wrong side, and "+20 100 555 0199"
 * can read as "0199 555 100 20+". Wrapping the value in an isolate makes
 * the algorithm treat it as one opaque unit, in both directions: the
 * value cannot reorder what is around it, and what is around it cannot
 * reorder the value.
 *
 * These are the plain-string form of what `<span dir>` does on the web
 * (`frontend/src/i18n/bidi.ts`), for a React Native `<Text>` where a
 * value arrives interpolated into a catalogue string. Where the value
 * can be its own `<Text>`, a `writingDirection` style is still the
 * better tool (see `EmergencyCallButton`); this is for when it cannot.
 *
 * Nothing calls these yet: they are prepared for hospital and doctor
 * names (ADR-042), which will be the first mixed-direction values the
 * app interpolates. A helper is cheaper to land before the first
 * screen needs it than to retrofit after.
 *
 * - `isolate` — first-strong isolate (FSI … PDI). The value's own first
 *   strong letter picks its direction: right-to-left for an Arabic name,
 *   left-to-right for a Latin one. Use it for names.
 * - `isolateLtr` — left-to-right isolate (LRI … PDI). Forces left to
 *   right. Use it for phone numbers, codes and identifiers, which read
 *   left to right whatever language surrounds them.
 */

const LRI = '\u2066';
const FSI = '\u2068';
const PDI = '\u2069';

/** LRI, RLI, FSI and PDI — the four isolate controls (U+2066–U+2069). */
const ISOLATE_CONTROLS = /[\u2066-\u2069]/g;

function wrap(open: string, value: string): string {
  // Nothing to isolate. An empty pair would be a pair of invisible
  // characters in a sentence for no reason, and would make
  // `value === ''` checks on the result lie.
  if (value === '') return '';
  // Already isolated by this same opener: wrapping again would nest a
  // pair per call, and a value passed through two layers should not
  // grow. Only an exact outer pair counts.
  if (value.startsWith(open) && value.endsWith(PDI) && balancedOuterPair(value)) return value;
  return `${open}${value}${PDI}`;
}

/** The first opener's own PDI is the last character, not an earlier one. */
function balancedOuterPair(value: string): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === LRI || char === FSI || char === '\u2067') depth += 1;
    else if (char === PDI) {
      depth -= 1;
      if (depth === 0 && i < value.length - 1) return false;
    }
  }
  return depth === 0;
}

/** Isolate a value whose direction is its own: a name, in any script. */
export function isolate(value: string): string {
  return wrap(FSI, value);
}

/** Isolate a value that is always left to right: a number or a code. */
export function isolateLtr(value: string): string {
  return wrap(LRI, value);
}

/** The text without isolate controls — for comparing or logging what was typed. */
export function withoutIsolates(value: string): string {
  return value.replace(ISOLATE_CONTROLS, '');
}
