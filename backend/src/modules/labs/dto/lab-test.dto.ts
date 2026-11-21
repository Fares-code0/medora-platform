/**
 * The test catalogue as the ordering form reads it (API §8.1).
 *
 * ## Why this is the frontend's `TestSpec`/`AnalyteSpec`, widened
 *
 * `shared-domain/lab-studies/catalogue.ts` declares both types and the
 * demo corpus generates values from them, so they are rank-1 evidence
 * for every shared field name — `analyte`, `unit`, `refLow`, `refHigh`,
 * `criticalLow`, `criticalHigh`, `decimals`, `qualitativeOptions`. Those
 * spellings are kept verbatim (the contract's §11 field-name law).
 *
 * Three fields are added, and each has a reason the mock did not need:
 *
 *  - `id` on both shapes, because §8.4 takes a `testCode` but §8.6 takes
 *    analyte identities that must resolve to a spec row, and a mock
 *    array is indexed by position.
 *  - `container` and `specimenType` on the test, because §8.5's specimen
 *    capture is filled from the catalogue: a phlebotomist reading
 *    "EDTA (lavender top)" off the order draws into the right tube.
 *  - `active`, because a withdrawn test still appears on orders written
 *    before it was withdrawn (the same rule the formulary applies).
 *
 * ## `referenceText` is derived here and stored there
 *
 * The catalogue carries bounds; a *result* carries the human range it
 * was judged against (`lab_results.ref_text`, snapshotted — DB §E5). The
 * two are computed by one function, `referenceTextFor`, so the range the
 * order form previews and the range printed beside a result cannot be
 * worded differently.
 */

export interface LabAnalyteSpecView {
  readonly id: string;
  readonly analyte: string;
  readonly unit: string;
  /** Null for a qualitative analyte — see `qualitativeOptions`. */
  readonly refLow: number | null;
  readonly refHigh: number | null;
  /** Display precision, 0–3 (DB §E2). */
  readonly decimals: number;
  /**
   * The thresholds that turn a number into an alert. Either may be null:
   * a high TSH is critical and a low one is not, so a spec with only
   * `criticalHigh` is a real entry rather than a half-filled one.
   */
  readonly criticalLow: number | null;
  readonly criticalHigh: number | null;
  /**
   * The possible values of a qualitative analyte, index 0 being the
   * normal result — the convention `AnalyteSpec` states and the flag
   * computation at §8.6 reads.
   */
  readonly qualitativeOptions: readonly string[];
  /** `"4.0–11.0"`, or the normal option for a qualitative analyte. */
  readonly referenceText: string;
}

export interface LabTestCatalogueView {
  readonly id: string;
  readonly name: string;
  /** LOINC-style, and the identifier §8.4 orders by. */
  readonly code: string;
  readonly category: string;
  readonly specimenType: string;
  readonly container: string;
  readonly active: boolean;
  readonly analytes: readonly LabAnalyteSpecView[];
}
