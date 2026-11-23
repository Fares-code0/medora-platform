/**
 * Emergency configuration.
 *
 * ── The rule this file exists to enforce ─────────────────────────────
 *
 * **No emergency number is hardcoded anywhere in this application.**
 *
 * That instruction from the brief (§22) is doing real work, and the audit
 * (§11) says why: emergency numbers are country- and region-specific
 * (112, 911, 997, 123, 999), they change, and a wrong one in a healthcare
 * app is a category of harm distinct from every other bug in this
 * repository. There is no table, no setting and no constant anywhere in
 * the Medora backend that holds one today.
 *
 * So the app ships with an EMPTY configuration and a screen that says so
 * plainly. Numbers arrive from the operator, per deployment region,
 * through `GET /public/emergency-contacts` (audit BE-11, a
 * `platform_settings` slice that does not exist yet). Until then the
 * Emergency screen renders its guidance, its disclaimer and its "call
 * your local emergency number" instruction — which is correct and useful
 * — and does NOT render a plausible-looking number nobody approved.
 *
 * A future contributor looking for the place to "just add 911 for now"
 * should read this paragraph and stop.
 */

/**
 * One operator-approved number a patient may dial.
 *
 * `label` and `whenToUse` are **operator data**, not application copy:
 * they are rendered exactly as configured, in every app language, and
 * this client never translates them (W-10 translation approval,
 * 2026-11-23, covers application-controlled copy only). A deployment
 * serving Arabic-speaking patients configures them in Arabic; a
 * per-locale field would be a BE-11 contract change and is an open item.
 */
export interface EmergencyNumber {
  /** Stable key for lists and tests. Not shown to the patient. */
  readonly id: string;
  /** What this number reaches: "Ambulance", "Poison control". */
  readonly label: string;
  /** The dial string, exactly as the operator configured it. */
  readonly number: string;
  /** When to use it, in one line. Shown under the label. */
  readonly whenToUse?: string;
  /** ISO-3166-1 alpha-2, when the operator scopes a number to a region. */
  readonly region?: string;
}

/** The clinic's own contact details, for non-life-threatening urgency. */
export interface ClinicEmergencyContact {
  readonly name: string;
  readonly phone: string;
  readonly addressLine: string;
}

/**
 * Everything the Emergency screen renders that is not bundled content.
 *
 * Every field is optional-by-emptiness on purpose: an unconfigured
 * deployment is a valid, honest state, not an error.
 */
export interface EmergencyConfiguration {
  readonly numbers: readonly EmergencyNumber[];
  readonly clinic: ClinicEmergencyContact | null;
  /**
   * Where this configuration came from. Rendered as provenance and used
   * by the tests that assert nothing is invented.
   *
   * `unconfigured` — the operator has supplied nothing. The default.
   * `operator`     — from the backend's public settings projection.
   * `cached`       — a previous `operator` response, served offline.
   */
  readonly source: 'unconfigured' | 'operator' | 'cached';
}

/** The shipped default: nothing, honestly. */
export const UNCONFIGURED_EMERGENCY: EmergencyConfiguration = {
  numbers: [],
  clinic: null,
  source: 'unconfigured',
};

/**
 * The port. One method, no arguments, never throws — because the
 * Emergency screen must render with no network and no session, and a
 * service that can reject is a service that can blank the one screen that
 * must not blank.
 */
export interface EmergencyService {
  getConfiguration(): Promise<EmergencyConfiguration>;
}
