/**
 * The safety screen's response (API §7.5).
 *
 * The contract states the shape exactly: `{ warnings: SafetyWarning[],
 * blocking: boolean }`, with kinds `interaction|allergy|duplicate|dosage`
 * and severities `info|warning|critical`.
 *
 * Two fields are carried beyond the frontend's read-only `SafetyWarning`
 * — `against` and `blocking` — and both come from the same rank-1 source
 * the rules do: `AuthoringSafetyWarning`
 * (`pharmacy/model/safety-check.ts:59`) extends `SafetyWarning` with
 * exactly these, for exactly this flow. Without `blocking` per warning
 * the client cannot tell which finding has no override, so it would have
 * to re-derive "allergy means blocking" — a second copy of the rule,
 * which is what `availableActions` exists elsewhere to prevent. Without
 * `against` the stepper cannot say *what* the drug clashed with.
 */

export interface SafetyWarningView {
  readonly id: string;
  /** `interaction | allergy | duplicate | dosage`. */
  readonly kind: string;
  /** `info | warning | critical`. */
  readonly severity: string;
  readonly title: string;
  readonly detail: string;
  /** The concrete things the warning was raised against. */
  readonly against: readonly string[];
  /** Cannot be acknowledged away — an allergy conflict has no override. */
  readonly blocking: boolean;
}

export interface SafetyCheckView {
  readonly warnings: readonly SafetyWarningView[];
  /** True when an allergy conflict stands (API §7.5). */
  readonly blocking: boolean;
  /**
   * The warning ids a signature must carry in `acknowledgedWarningIds`
   * (API §7.7). Served so the stepper ticks exactly what the server will
   * demand, rather than deriving the rule a second time — the ids are
   * stable within a run, so an echo can be compared.
   */
  readonly requiresAcknowledgment: readonly string[];
}
