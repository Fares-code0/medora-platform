/**
 * The billing feature flag (RM M17, ADR-010 group 6).
 *
 * ## Why a constant, and not a platform setting
 *
 * The mirror is the contract (MG §18.5), and the frontend's is a
 * build-time constant:
 *
 * ```ts
 * // frontend/src/configs/feature-flags.ts
 * export const featureFlags = { billing: false } as const;
 * ```
 *
 * Its own header is unusually clear about what that means: "`false` is
 * an accurate statement here: no billing widget exists to switch on …
 * **It has no consumer, so flipping it to `true` today does nothing**".
 * A server-side flag stored in `platform_settings` and editable from the
 * admin panel would be a switch an administrator could throw with
 * nothing behind it — a worse state than the honest constant, because a
 * setting that appears in a panel implies something happens when it
 * changes.
 *
 * M17's exit gate is "nothing built ahead of product need; contract slot
 * reserved", and this is the smallest thing that reserves the slot.
 *
 * ## What changes the day billing turns on
 *
 * Three things, in this order, and none of them is this file alone:
 *
 * 1. **M24** adds a `features` slice to `platform_settings` and this
 *    constant becomes a read through `PolicyService`, so the flag is
 *    per-deployment rather than per-build.
 * 2. **The tables land.** ADR-010 scoped `invoices`, `invoice_lines` and
 *    `payments` OUT with the trigger recorded as "billing turns on";
 *    ADR-037 carries the sketch.
 * 3. **M21** serves a real `AnalyticsSnapshot` for `category=revenue`
 *    when the flag is on, and this module's alternate when it is off.
 *
 * Until all three, `isBillingEnabled()` is the one reader's one answer,
 * and every caller goes through it rather than through the constant — so
 * step 1 is an edit to this function's body and to nothing else.
 */

/** ADR-010 group 6: OUT until billing turns on. */
const BILLING_ENABLED = false;

export function isBillingEnabled(): boolean {
  return BILLING_ENABLED;
}
