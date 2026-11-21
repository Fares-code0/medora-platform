/**
 * Turning a reported value into a flag (RM M14.4 — API §8.6).
 *
 * **This module is to M14 what `safety-screen.ts` is to M13**: the one
 * clinical judgement the laboratory module makes, kept pure so it can be
 * read in full and tested without a database. A wrong flag here is not a
 * display defect — `critical-high` is what puts a result in front of a
 * doctor today rather than at the next clinic, and `normal` is what lets
 * a bulk review clear it with a checkbox (RM M14.5).
 *
 * ## The ladder, most severe first
 *
 * | Test | Flag |
 * |---|---|
 * | `criticalLow !== null && value <= criticalLow` | `critical-low` |
 * | `criticalHigh !== null && value >= criticalHigh` | `critical-high` |
 * | `refLow !== null && value < refLow` | `low` |
 * | `refHigh !== null && value > refHigh` | `high` |
 * | otherwise | `normal` |
 *
 * The order matters and the comparisons do too.
 *
 * **Critical is tested first** because the bands nest: `critical_low <
 * ref_low` and `critical_high > ref_high` are CHECK constraints (M5.5),
 * so every critical value is also out of range and testing `low` first
 * would grade every critical result as merely low.
 *
 * **The reference range is inclusive and the critical thresholds are
 * not.** A value exactly at `refHigh` is normal — that is what a
 * reference *interval* means, and `flagForValue` in the frontend's
 * corpus (`value < low` / `value > high`) says the same. A value exactly
 * at `criticalHigh` is critical, because a threshold a result may sit on
 * without raising the alert is a threshold one unit higher than written.
 * The two conventions cannot collide: the CHECKs above make the bands
 * strictly disjoint.
 *
 * **A one-sided spec is a real spec, not a half-filled one.** TSH has a
 * `criticalHigh` and no `criticalLow`, because a suppressed TSH is not
 * the emergency an extremely high one is. Each bound is therefore tested
 * independently, and a null bound never fails a value — it abstains.
 *
 * ## Qualitative analytes can only be `normal` or `abnormal`
 *
 * `qualitative_options[0]` is the normal result (the convention
 * `AnalyteSpec` states); anything else is `abnormal`.
 *
 * The demo corpus goes further — `qualitativeFlag` in
 * `shared-domain/lab-studies/corpus.ts` grades an option matching
 * `/malignant|isolated|cfu|incompatible|high-grade|lesion/i` as
 * `critical-high`. **That rule is deliberately not transcribed, and the
 * database is why**: `lab_results_numeric_flag_needs_value` (M5.8) is
 * `flag IN ('normal','abnormal') OR value_numeric IS NOT NULL`, so a
 * qualitative result — which has no numeric value by definition — cannot
 * carry `critical-high` at all. The corpus is generating display data
 * for a mock that has no database behind it; this runs against one that
 * refuses the row. Grading a positive culture as critical is also a
 * clinical rule that a regular expression over free text is the wrong
 * instrument for: "No growth" contains no keyword and "Isolated" is a
 * word that appears in benign findings. See PD-14.4.
 *
 * ## Nothing here reads the clock or the database
 *
 * The caller passes the spec it snapshotted; this module compares
 * numbers. That is what makes the flag reproducible from the stored row
 * — `ref_low`, `ref_high` and `ref_text` are snapshotted onto
 * `lab_results` (DB §E5) precisely so a range revised next year cannot
 * retroactively change whether last year's result was abnormal.
 */

import type { LabResultFlag } from '../../../generated/prisma/enums';

/** The bounds a value is judged against, as numbers rather than decimals. */
export interface AnalyteBounds {
  readonly refLow: number | null;
  readonly refHigh: number | null;
  readonly criticalLow: number | null;
  readonly criticalHigh: number | null;
  /** Display precision, 0–3 (DB §E2). Defaults to 0 where absent. */
  readonly decimals: number;
  /** Index 0 is the normal result. Empty for a numeric analyte. */
  readonly qualitativeOptions: readonly string[];
}

/** A numeric analyte has a range; a qualitative one has options (M5.5 CHECK). */
export function isQualitative(bounds: AnalyteBounds): boolean {
  return bounds.refLow === null && bounds.refHigh === null;
}

/**
 * The flag for a numeric value. See the ladder in the file header.
 */
export function flagForNumeric(value: number, bounds: AnalyteBounds): LabResultFlag {
  if (bounds.criticalLow !== null && value <= bounds.criticalLow) return 'CRITICAL_LOW';
  if (bounds.criticalHigh !== null && value >= bounds.criticalHigh) return 'CRITICAL_HIGH';
  if (bounds.refLow !== null && value < bounds.refLow) return 'LOW';
  if (bounds.refHigh !== null && value > bounds.refHigh) return 'HIGH';

  return 'NORMAL';
}

/**
 * The flag for a qualitative value.
 *
 * The comparison is case-insensitive and trimmed, because the option
 * list is display text a client echoes back and "negative" is the same
 * answer as "Negative". It is **not** fuzzy beyond that: a value that is
 * not one of the offered options is `abnormal`, never `normal`. Reading
 * an unrecognised answer as normal is the fail-open this whole module
 * exists to avoid — see `assertQualitativeOption`, which refuses it
 * before it ever reaches here.
 */
export function flagForQualitative(value: string, bounds: AnalyteBounds): LabResultFlag {
  const normal = bounds.qualitativeOptions[0];
  if (normal === undefined) return 'ABNORMAL';

  return sameOption(value, normal) ? 'NORMAL' : 'ABNORMAL';
}

export function sameOption(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether a reported qualitative value is one the catalogue offers. */
export function isOfferedOption(value: string, bounds: AnalyteBounds): boolean {
  return bounds.qualitativeOptions.some((option) => sameOption(value, option));
}

/**
 * `critical-low` and `critical-high`, and nothing else.
 *
 * The frontend's `isCriticalFlag` is the same two members, and the M5.10
 * trigger that maintains `lab_orders.has_critical_result` names the same
 * two wire values. Three places, one rule — this is the backend's, and
 * the e2e specs assert it agrees with the trigger.
 */
export function isCriticalFlag(flag: LabResultFlag): boolean {
  return flag === 'CRITICAL_LOW' || flag === 'CRITICAL_HIGH';
}

/** Any released value outside its reference range — the bulk-review gate. */
export function isAbnormalFlag(flag: LabResultFlag): boolean {
  return flag !== 'NORMAL';
}

/**
 * The human range, worded once for the catalogue and the result alike.
 *
 * `referenceText` in the frontend's corpus, transcribed: bounds joined
 * by an en dash at the analyte's own precision, and the normal
 * qualitative option where there are no bounds. Both surfaces call this
 * so the range the order form previews and the range printed beside a
 * released result cannot be worded differently — two spellings of one
 * interval is how a reader concludes the result was judged against
 * something else.
 *
 * The fallback is `'See report'`, also the corpus's, for the analyte
 * that has neither — which the M5.5 CHECK makes unreachable through the
 * catalogue and which a caller could still construct in a test.
 */
export function referenceTextFor(bounds: AnalyteBounds): string {
  if (bounds.refLow !== null && bounds.refHigh !== null) {
    return `${format(bounds.refLow, bounds.decimals)}–${format(bounds.refHigh, bounds.decimals)}`;
  }

  // A one-sided numeric range is legal at the database (the CHECK asks
  // for *either* bound) and has no two-sided wording, so it is stated
  // rather than faked with an invented other end.
  if (bounds.refLow !== null) return `≥ ${format(bounds.refLow, bounds.decimals)}`;
  if (bounds.refHigh !== null) return `≤ ${format(bounds.refHigh, bounds.decimals)}`;

  return bounds.qualitativeOptions[0] ?? 'See report';
}

/** The value as reported, at the analyte's own display precision. */
export function formatValue(value: number, decimals: number): string {
  return format(value, decimals);
}

function format(value: number, decimals: number): string {
  return value.toFixed(clampDecimals(decimals));
}

/**
 * `toFixed` throws a `RangeError` outside 0–100, and `decimals` arrives
 * from a nullable SmallInt column. The M5.5 CHECK holds it to 0–3, but a
 * projection that can throw on a row the database considers valid is a
 * 500 waiting for the one row that slipped in before the constraint.
 */
function clampDecimals(decimals: number): number {
  if (!Number.isFinite(decimals)) return 0;

  return Math.min(3, Math.max(0, Math.trunc(decimals)));
}
