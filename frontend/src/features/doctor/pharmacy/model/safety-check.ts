import type { MessageKey } from '@/i18n';

import type { CompleteDraft } from './authoring';
import type { MedicationCategory, SafetyWarning, SafetyWarningSeverity } from './types';

/**
 * The blocking safety screen (D-17, UX §2.7) — and the one correctness
 * property this feature exists to guarantee: **it fails closed.**
 *
 * The whole design is one sentence: *a signature is only obtainable from a
 * completed verdict.* Not "the button is disabled when the check failed" — a
 * disabled button is one careless refactor away from being enabled. Instead
 * `assessSignability` is the only producer of `SignablePrescription`, that
 * type carries a module-private symbol, and the sign mutation demands one.
 * So a failed check, a timed-out check, a check that never ran, and a check
 * whose result we could not positively read all reach the same place: there
 * is no value to hand to `signPrescription`, and no way to forge one — not
 * in TypeScript, because the symbol cannot be named outside this module, and
 * not at runtime, because `assertSignable` compares against it.
 *
 * `runSafetyCheck` therefore never rejects. A failure is a *value* of the
 * verdict union, because an exception is something a `catch` can swallow into
 * an optimistic default, and a verdict variant is something the type system
 * makes you handle.
 *
 * The verdicts themselves are computed from `catalogue.ts` — a five-item demo
 * formulary with canned notes. Every warning and every verdict therefore
 * carries `source`, and the UI renders its "demo" marker from that field
 * (the DX-10 contract): the label cannot be deleted while the content stays
 * fake, and it disappears by itself the day a real interaction service answers.
 */

/* ── Provenance ─────────────────────────────────────────────────── */

export type SafetyEvidenceSource = 'demo-formulary' | 'clinical-service';

export const SAFETY_EVIDENCE_META: Record<
  SafetyEvidenceSource,
  {
    readonly label: string;
    readonly labelKey: MessageKey;
    readonly detail: string;
    readonly detailKey: MessageKey;
    readonly isDemo: boolean;
  }
> = {
  'demo-formulary': {
    label: 'Demo formulary',
    labelKey: 'rx.evidence.demoFormulary',
    detailKey: 'rx.evidence.demoFormulary.detail',
    detail:
      'Screened against a five-medication demo formulary and its canned notes — not a clinical interaction service. Verdicts here are illustrative and must not be relied on for care.',
    isDemo: true,
  },
  'clinical-service': {
    label: 'Clinical interaction service',
    labelKey: 'rx.evidence.clinicalService',
    detailKey: 'rx.evidence.clinicalService.detail',
    detail: 'Screened against the licensed drug interaction and allergy service.',
    isDemo: false,
  },
};

/* ── Warnings ───────────────────────────────────────────────────── */

/**
 * A screening warning. Extends the read-only `SafetyWarning` the detail page
 * already renders — same ids, same kinds, same severity scale — with the
 * three things authoring needs: what it was found *against*, whether it can
 * be overridden at all, and where the evidence came from.
 */
export interface AuthoringSafetyWarning extends SafetyWarning {
  /** The concrete things this warning was raised against (drugs, allergies). */
  readonly against: readonly string[];
  /**
   * Blocking warnings cannot be acknowledged away. UX §2.7: an allergy
   * conflict has no override in v1 — the medication must change.
   */
  readonly blocking: boolean;
  readonly source: SafetyEvidenceSource;
}

/** A medication the patient is already on, as the screen compares against it. */
export interface CurrentMedication {
  readonly prescriptionId: string;
  readonly name: string;
  readonly genericName: string;
  readonly category: MedicationCategory;
  readonly isHighRisk: boolean;
}

export interface SafetyCheckSubject {
  readonly patientId: string;
  /** The formulary id of the medication being screened (`MedicationSpec.id`). */
  readonly medicationId: string;
  readonly patientName: string;
  readonly allergies: readonly string[];
  readonly hasSevereAllergy: boolean;
  readonly genericName: string;
  readonly brandName: string;
  readonly category: MedicationCategory;
  readonly strength: string;
  readonly frequency: string;
  readonly durationDays: number;
  readonly quantity: number;
  readonly isHighRisk: boolean;
  readonly interactionNote: string | null;
  readonly allergyClass: string | null;
  readonly currentMedications: readonly CurrentMedication[];
}

/**
 * The identity of *what was screened*. An acknowledgment is only ever valid
 * against the verdict that produced it, and a verdict is only ever valid for
 * the subject that produced it — so changing the medication or any dosage
 * field yields a different key, a re-run, and a cleared acknowledgment.
 */
export function subjectKey(subject: SafetyCheckSubject): string {
  return [
    subject.patientId,
    subject.genericName,
    subject.strength,
    subject.frequency,
    String(subject.durationDays),
    String(subject.quantity),
    subject.currentMedications
      .map((medication) => medication.prescriptionId)
      .slice()
      .sort()
      .join('+'),
  ].join('|');
}

export function subjectFromDraft(
  draft: CompleteDraft,
  currentMedications: readonly CurrentMedication[],
): SafetyCheckSubject {
  return {
    patientId: draft.patient.id,
    medicationId: draft.spec.id,
    patientName: draft.patient.name,
    allergies: draft.patient.allergies,
    hasSevereAllergy: draft.patient.hasSevereAllergy,
    genericName: draft.spec.genericName,
    brandName: draft.spec.name,
    category: draft.spec.category,
    strength: draft.strength,
    frequency: draft.frequency,
    durationDays: draft.durationDays,
    quantity: draft.quantity,
    isHighRisk: draft.spec.isHighRisk,
    interactionNote: draft.spec.interactionNote,
    allergyClass: draft.spec.allergyClass,
    currentMedications,
  };
}

/* ── The three specified categories ─────────────────────────────── */

/**
 * Compared trimmed and without case. Allergies arrive as free text a clinician
 * typed on the chart, and an exact match would let "penicillin" or
 * "Penicillin " slip past a Penicillin-class block — the screen failing open
 * on spelling.
 */
const sameAllergen = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function allergyWarnings(subject: SafetyCheckSubject): readonly AuthoringSafetyWarning[] {
  const { allergyClass } = subject;
  if (allergyClass === null || !subject.allergies.some((a) => sameAllergen(a, allergyClass))) {
    return [];
  }

  const severity: SafetyWarningSeverity = subject.hasSevereAllergy ? 'critical' : 'warning';
  return [
    {
      id: 'safety-allergy',
      kind: 'allergy',
      severity,
      title: `Allergy conflict — ${allergyClass}`,
      detail: `${subject.patientName} has a recorded ${allergyClass} allergy${
        subject.hasSevereAllergy ? ', flagged severe' : ''
      }. ${subject.brandName} (${subject.genericName}) belongs to that class and may cross-react. Choose a different medication — this cannot be overridden.`,
      against: [`Recorded allergy: ${allergyClass}`],
      blocking: true,
      source: 'demo-formulary',
    },
  ];
}

function interactionWarnings(subject: SafetyCheckSubject): readonly AuthoringSafetyWarning[] {
  const { interactionNote, currentMedications } = subject;
  if (interactionNote === null || currentMedications.length === 0) return [];

  const highRiskPartners = currentMedications.filter((medication) => medication.isHighRisk);
  const partners = highRiskPartners.length > 0 ? highRiskPartners : currentMedications;
  const severity: SafetyWarningSeverity =
    subject.isHighRisk || highRiskPartners.length > 0 ? 'critical' : 'warning';
  const names = partners.map((medication) => `${medication.name} (${medication.genericName})`);

  return [
    {
      id: 'safety-interaction',
      kind: 'interaction',
      severity,
      title:
        severity === 'critical'
          ? `Interaction with a high-alert medication — ${names.join(', ')}`
          : `Possible interaction with ${names.join(', ')}`,
      detail: `${subject.brandName} (${subject.genericName}): ${interactionNote} The patient is currently taking ${names.join(', ')}. Review before signing.`,
      against: names,
      blocking: false,
      source: 'demo-formulary',
    },
  ];
}

function duplicateWarnings(subject: SafetyCheckSubject): readonly AuthoringSafetyWarning[] {
  const sameDrug = subject.currentMedications.filter(
    (medication) => medication.genericName === subject.genericName,
  );
  if (sameDrug.length > 0) {
    const names = sameDrug.map((medication) => `${medication.name} · ${medication.prescriptionId}`);
    return [
      {
        id: 'safety-duplicate',
        kind: 'duplicate',
        severity: 'critical',
        title: `Duplicate therapy — ${subject.genericName} is already active`,
        detail: `${subject.patientName} already has an active prescription for ${subject.genericName} (${names.join(', ')}). Signing this one doubles the dose unless the existing prescription is cancelled first.`,
        against: names,
        blocking: false,
        source: 'demo-formulary',
      },
    ];
  }

  const sameClass = subject.currentMedications.filter(
    (medication) => medication.category === subject.category,
  );
  if (sameClass.length === 0) return [];

  const names = sameClass.map((medication) => `${medication.name} (${medication.genericName})`);
  return [
    {
      id: 'safety-duplicate',
      kind: 'duplicate',
      severity: 'warning',
      title: `Duplicate therapy — another ${subject.category.toLowerCase()} is active`,
      detail: `${subject.patientName} is already taking ${names.join(', ')}, in the same class (${subject.category}). Confirm both are intended.`,
      against: names,
      blocking: false,
      source: 'demo-formulary',
    },
  ];
}

const SEVERITY_ORDER: Record<SafetyWarningSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * The screen itself — pure, synchronous, and the whole of the clinical logic.
 * Three categories, in the order UX §2.7 lists them, sorted so the most
 * severe finding is the first thing announced.
 */
export function screenPrescription(
  subject: SafetyCheckSubject,
): readonly AuthoringSafetyWarning[] {
  return [
    ...allergyWarnings(subject),
    ...interactionWarnings(subject),
    ...duplicateWarnings(subject),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/* ── The verdict ────────────────────────────────────────────────── */

export type SafetyFailureReason = 'error' | 'timeout' | 'unreadable';

export const SAFETY_FAILURE_META: Record<SafetyFailureReason, string> = {
  error: 'The interaction check failed.',
  timeout: 'The interaction check timed out.',
  unreadable: 'The interaction check returned a result that could not be read.',
};

export interface CompletedSafetyVerdict {
  readonly status: 'completed';
  readonly id: string;
  readonly subjectKey: string;
  readonly checkedAt: string;
  readonly source: SafetyEvidenceSource;
  readonly warnings: readonly AuthoringSafetyWarning[];
}

export interface FailedSafetyVerdict {
  readonly status: 'failed';
  readonly id: string;
  readonly subjectKey: string;
  readonly attemptedAt: string;
  readonly reason: SafetyFailureReason;
  readonly message: string;
}

export type SafetyVerdict = CompletedSafetyVerdict | FailedSafetyVerdict;

export function isCompleted(verdict: SafetyVerdict | null): verdict is CompletedSafetyVerdict {
  return verdict !== null && verdict.status === 'completed';
}

/** Highest severity in a completed verdict, or null when it is clear. */
export function verdictSeverity(
  verdict: CompletedSafetyVerdict,
): SafetyWarningSeverity | null {
  if (verdict.warnings.some((warning) => warning.severity === 'critical')) return 'critical';
  if (verdict.warnings.some((warning) => warning.severity === 'warning')) return 'warning';
  return verdict.warnings.length > 0 ? 'info' : null;
}

/** Warnings a doctor must tick before signing: everything above `info`. */
export function warningsNeedingAcknowledgment(
  verdict: CompletedSafetyVerdict,
): readonly AuthoringSafetyWarning[] {
  return verdict.warnings.filter(
    (warning) => warning.severity !== 'info' && !warning.blocking,
  );
}

export function blockingWarnings(
  verdict: CompletedSafetyVerdict,
): readonly AuthoringSafetyWarning[] {
  return verdict.warnings.filter((warning) => warning.blocking);
}

/* ── Running the check ──────────────────────────────────────────── */

export const SAFETY_CHECK_TIMEOUT_MS = 8_000;

export interface SafetyCheckRunner {
  (subject: SafetyCheckSubject, signal: AbortSignal): Promise<unknown>;
}

export interface RunSafetyCheckOptions {
  readonly run: SafetyCheckRunner;
  /**
   * Where the runner's answer comes from — the port's
   * `capabilities.safetySource`. It is stamped on the verdict, which is how
   * a clear result is labelled demo or not when there is no warning to
   * carry the label.
   */
  readonly source?: SafetyEvidenceSource;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

/** A result is only "checked and clear" if it is literally an array of warnings. */
function readWarnings(value: unknown): readonly AuthoringSafetyWarning[] | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const warning = entry as Partial<AuthoringSafetyWarning>;
    if (
      typeof warning.id !== 'string' ||
      typeof warning.title !== 'string' ||
      typeof warning.detail !== 'string' ||
      typeof warning.blocking !== 'boolean' ||
      typeof warning.source !== 'string' ||
      !Array.isArray(warning.against) ||
      (warning.severity !== 'info' &&
        warning.severity !== 'warning' &&
        warning.severity !== 'critical')
    ) {
      return null;
    }
  }
  return value as readonly AuthoringSafetyWarning[];
}

/**
 * Runs the check and always resolves to a verdict.
 *
 * Three ways to fail, one shape: a rejection is `error`, exceeding
 * `timeoutMs` is `timeout`, and a resolved value that is not recognisably a
 * warning list is `unreadable`. None of them produce a completed verdict, so
 * none of them produce a signature. A rejection arriving *after* the timeout
 * is swallowed deliberately — the verdict is already decided, and an
 * unhandled rejection would be the only way this function could still throw.
 */
export async function runSafetyCheck(
  subject: SafetyCheckSubject,
  options: RunSafetyCheckOptions,
): Promise<SafetyVerdict> {
  const {
    run,
    source = 'demo-formulary',
    timeoutMs = SAFETY_CHECK_TIMEOUT_MS,
    now = () => new Date(),
    newId = () => `chk-${Math.random().toString(36).slice(2, 10)}`,
  } = options;

  const id = newId();
  const key = subjectKey(subject);
  const controller = new AbortController();

  const failed = (reason: SafetyFailureReason, message?: string): FailedSafetyVerdict => ({
    status: 'failed',
    id,
    subjectKey: key,
    attemptedAt: now().toISOString(),
    reason,
    message: message ?? SAFETY_FAILURE_META[reason],
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SafetyVerdict>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(failed('timeout'));
    }, timeoutMs);
  });

  const attempt = (async (): Promise<SafetyVerdict> => {
    try {
      const result = await run(subject, controller.signal);
      const warnings = readWarnings(result);
      if (warnings === null) return failed('unreadable');
      return {
        status: 'completed',
        id,
        subjectKey: key,
        checkedAt: now().toISOString(),
        source,
        warnings,
      };
    } catch (error) {
      return failed('error', error instanceof Error ? error.message : undefined);
    }
  })();

  // Never let a late rejection escape as an unhandled rejection once the
  // timeout has already decided the verdict.
  attempt.catch(() => undefined);

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* ── Acknowledgment ─────────────────────────────────────────────── */

export interface SafetyAcknowledgment {
  /** The verdict this acknowledgment was given against — never another. */
  readonly verdictId: string;
  readonly warningIds: readonly string[];
  readonly reason: string;
  readonly acknowledgedAt: string;
}

/**
 * An acknowledgment survives only as long as the verdict it was given
 * against. Re-running the check mints a new verdict id, so ticks made
 * against the previous medication or dosage stop counting the moment the
 * screen re-runs — which is exactly what "prior acknowledgments do not carry
 * over" means (D-17).
 */
export function acknowledgmentApplies(
  acknowledgment: SafetyAcknowledgment | null,
  verdict: CompletedSafetyVerdict,
): boolean {
  if (acknowledgment === null) return false;
  if (acknowledgment.verdictId !== verdict.id) return false;

  const required = warningsNeedingAcknowledgment(verdict);
  if (required.length === 0) return true;
  if (!required.every((warning) => acknowledgment.warningIds.includes(warning.id))) return false;

  /*
   * UX §2.7: proceeding past a *severe* warning needs an explicit
   * acknowledgment AND a reason, which is audit-logged. A tick with no
   * reason is not an acknowledgment. The rule lives here rather than in the
   * hook so the model is the single authority on what "acknowledged" means —
   * a second opinion upstream previously reported "unacknowledged" for a
   * prescription whose real blocker was an un-overridable allergy conflict.
   */
  if (acknowledgment.reason.trim() === '' && reasonRequired(verdict)) return false;

  return true;
}

/**
 * Whether proceeding past this verdict's warnings needs a stated reason.
 *
 * Past a *critical* warning, always (UX §2.7). Past any warning at all when
 * the verdict is the clinical service's: its signing gate (API §7.7,
 * `acknowledgment_required`) refuses every acknowledgment that carries no
 * reason, and a form that let the doctor sign without one would only be
 * refused at the server.
 */
export function reasonRequired(verdict: CompletedSafetyVerdict): boolean {
  const required = warningsNeedingAcknowledgment(verdict);
  if (required.length === 0) return false;
  return (
    verdict.source === 'clinical-service' ||
    required.some((warning) => warning.severity === 'critical')
  );
}

/* ── Signability — the unforgeable part ─────────────────────────── */

/**
 * Module-private. `SignablePrescription` declares a property keyed by this
 * symbol, and nothing outside this file can name it — so no other module can
 * write an object literal that satisfies the type, and no cast survives
 * `assertSignable`, which compares the runtime value.
 */
const SIGNABLE: unique symbol = Symbol('medora.pharmacy.signable');

export interface SignablePrescription {
  readonly [SIGNABLE]: true;
  readonly draft: CompleteDraft;
  readonly verdict: CompletedSafetyVerdict;
  readonly acknowledgment: SafetyAcknowledgment | null;
}

export type SignBlockedReason =
  | 'incomplete-draft'
  | 'not-checked'
  | 'stale-check'
  | 'check-failed'
  | 'blocking-warning'
  | 'unacknowledged';

export const SIGN_BLOCKED_META: Record<SignBlockedReason, string> = {
  'incomplete-draft': 'The prescription is not complete yet.',
  'not-checked': 'The safety screen has not run for this prescription.',
  'stale-check': 'The prescription changed after the last safety screen. Re-run the check.',
  'check-failed': 'The safety screen could not complete, so this prescription cannot be signed.',
  'blocking-warning': 'A blocking safety warning stands. Change the medication.',
  'unacknowledged': 'Acknowledge every safety warning before signing.',
};

export type SignabilityResult =
  | { readonly signable: SignablePrescription; readonly blockedBy: null }
  | { readonly signable: null; readonly blockedBy: SignBlockedReason };

export interface SignabilityInput {
  readonly draft: CompleteDraft | null;
  readonly verdict: SafetyVerdict | null;
  readonly subject: SafetyCheckSubject | null;
  readonly acknowledgment: SafetyAcknowledgment | null;
}

/**
 * The only producer of `SignablePrescription`. Every path that is not a
 * completed, current, non-blocking, acknowledged verdict returns null — and
 * null is not something the sign mutation accepts.
 */
export function assessSignability(input: SignabilityInput): SignabilityResult {
  const { draft, verdict, subject, acknowledgment } = input;

  if (draft === null || subject === null) {
    return { signable: null, blockedBy: 'incomplete-draft' };
  }
  if (verdict === null) return { signable: null, blockedBy: 'not-checked' };
  if (verdict.status !== 'completed') return { signable: null, blockedBy: 'check-failed' };
  if (verdict.subjectKey !== subjectKey(subject)) {
    return { signable: null, blockedBy: 'stale-check' };
  }
  if (blockingWarnings(verdict).length > 0) {
    return { signable: null, blockedBy: 'blocking-warning' };
  }
  if (!acknowledgmentApplies(acknowledgment, verdict)) {
    return warningsNeedingAcknowledgment(verdict).length === 0
      ? // No warnings to acknowledge: a clear verdict signs on its own.
        { signable: { [SIGNABLE]: true, draft, verdict, acknowledgment: null }, blockedBy: null }
      : { signable: null, blockedBy: 'unacknowledged' };
  }

  return { signable: { [SIGNABLE]: true, draft, verdict, acknowledgment }, blockedBy: null };
}

export class NotSignableError extends Error {
  constructor() {
    super('Refusing to sign: the value did not come from a completed safety verdict.');
    this.name = 'NotSignableError';
  }
}

/**
 * The runtime half of the guarantee. A cast, a hand-built object, or a value
 * revived from JSON all lack the private symbol and are refused here — so
 * the type is not merely advisory.
 */
export function assertSignable(value: SignablePrescription): void {
  const candidate = value as unknown as Record<symbol, unknown> | null;
  if (typeof candidate !== 'object' || candidate === null || candidate[SIGNABLE] !== true) {
    throw new NotSignableError();
  }
}
