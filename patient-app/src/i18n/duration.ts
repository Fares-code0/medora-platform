import type { Locale } from './locales';

/**
 * Minute counts, in a form each language will accept.
 *
 * ── Why this exists rather than a plural library ─────────────────────
 *
 * `docs/ARCHITECTURE.md` lists `i18next` under *deliberately absent* and
 * says its plural rules "would need their own decision when a message
 * needs one". Exactly one message needs one: the background-timeout
 * notice on the sign-in screen, which names how long the app waited
 * before signing the patient out.
 *
 * So this is that decision, at the size of the problem — one formatter,
 * two languages, no dependency and no general plural machinery for the
 * catalogue to grow around. A message that needs a count interpolates
 * the OUTPUT of this function, not a bare number, which is what keeps
 * `{minutes} minutes` — wrong in English at one, wrong in Arabic at
 * almost every value — from appearing in a catalogue at all.
 *
 * ── The Arabic rule, written out because it is not the English one ───
 *
 * Arabic does not have "singular and plural". The forms this needs are:
 *
 * | count   | form                          |
 * |---------|-------------------------------|
 * | 1       | دقيقة واحدة  (singular)        |
 * | 2       | دقيقتان      (dual)            |
 * | 3–10    | ٣ دقائق      (paucal, plural noun) |
 * | 11+     | ١١ دقيقة     (singular noun after the numeral) |
 *
 * A two-form English-shaped rule ("1 minute" / "N minutes") gets three
 * of those four wrong, and it gets them wrong in the sentence that
 * explains why someone was signed out — which is the sentence a patient
 * is least willing to puzzle over.
 *
 * Zero is not reachable: the caller rounds up to at least one minute,
 * because "signed you out after 0 minutes" describes nothing.
 */
export function formatMinutes(locale: Locale, ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return locale === 'ar' ? arabicMinutes(minutes) : englishMinutes(minutes);
}

function englishMinutes(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function arabicMinutes(minutes: number): string {
  if (minutes === 1) return 'دقيقة واحدة';
  if (minutes === 2) return 'دقيقتان';
  if (minutes <= 10) return `${minutes} دقائق`;
  return `${minutes} دقيقة`;
}
