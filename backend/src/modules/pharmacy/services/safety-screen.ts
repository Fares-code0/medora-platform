/**
 * The prescribing safety screen (RM M13.2 — API §7.5).
 *
 * **The highest-risk logic in the platform, and the reason it is a pure
 * function.** RM M13's goal line demands 100% test coverage here; a unit
 * that touches no database can be driven into every branch from a table
 * of inputs, and a unit that opens a connection cannot. The queries live
 * in `safety.repository.ts`, the wiring in `safety.service.ts`, and
 * everything clinical is below.
 *
 * ## The rules are transcribed, not invented
 *
 * `frontend/src/features/doctor/pharmacy/model/safety-check.ts` is the
 * **coded** screen — rank-1 evidence under the source-of-truth hierarchy
 * (`DECISIONS.md`, "Frontend source code · The DTO mirrors *are* the
 * contract"). It fixes three things this file would otherwise have had
 * to invent, and each is cited at its rule below:
 *
 *  - an allergy match is `blocking` **always**, and `critical` only when
 *    the patient has a severity-`severe` allergy on file;
 *  - duplicate therapy is graded in two tiers — same generic is
 *    `critical`, same category is `warning` — and **neither blocks**;
 *  - `blocking` on the response means "an allergy conflict stands",
 *    because allergy is the only warning the coded screen marks blocking
 *    (`blockingWarnings`, and UX §2.7's "no override in v1").
 *
 * **One rule deliberately departs from the frontend, on instruction.**
 * The coded screen derives interactions from `medication.interactionNote`
 * — one canned string per drug. RM M13.2 requires them "severity-graded
 * from `drug_interactions`", and ADR-010 group 8 admitted that table
 * precisely because "the safety check degrades to one canned string per
 * drug" without it: a note says the same thing whatever the other drug
 * is, so it cannot grade anything. So the severity here is the
 * **pair's**, read from the row. The frontend's version is the degraded
 * demo it says it is ("Demo formulary … must not be relied on for care").
 *
 * ## What is NOT screened, and why that is not an omission
 *
 * `SafetyWarningKind` has a fourth member, `dosage`, and API §7.5 lists
 * it. **No dosage rule is implemented here.** Deciding that a given
 * strength × frequency × duration is too much for a given patient is a
 * clinical rule, and no source in this repository states one:
 * `medication_monographs.standard_dosing` is free prose, there is no
 * per-drug maximum column, no weight- or renal-adjustment input, and the
 * coded frontend screen implements "the three specified categories" and
 * no fourth. Inventing a threshold would mean a number nobody clinically
 * approved deciding whether a prescription is safe — the exact failure
 * this module's fail-closed posture exists to prevent. Recorded as
 * **PD-13.2** in the roadmap's M13.2 note; the enum value stays
 * available for the day a rule is supplied.
 *
 * ## Order
 *
 * Most severe first, and allergy before interaction before duplicate
 * within a severity — the order UX §2.7 lists them and the frontend
 * sorts them. The first warning announced is the one that stops the
 * prescription.
 */

/** The graded severities, `SafetyWarningSeverity` in wire form. */
export type ScreenSeverity = 'info' | 'warning' | 'critical';

/** The screened categories, `SafetyWarningKind` in wire form. */
export type ScreenKind = 'interaction' | 'allergy' | 'duplicate' | 'dosage';

export interface ScreenWarning {
  /**
   * Stable within one screening run, and derived from what was found —
   * never random. M13.3 has the client echo these back as
   * `acknowledgedWarningIds`, and the server re-runs the screen
   * in-transaction before comparing, so an id that changed between the
   * two runs would make every acknowledgment fail to match.
   */
  readonly id: string;
  readonly kind: ScreenKind;
  readonly severity: ScreenSeverity;
  readonly title: string;
  readonly detail: string;
  /** The concrete things the warning was raised against (drugs, allergies). */
  readonly against: readonly string[];
  /** Cannot be acknowledged away. Allergy only — UX §2.7, no override in v1. */
  readonly blocking: boolean;
}

/**
 * How a legacy row (no owning hospital, #17) is named wherever a warning
 * shows it — the owner's safety exception of 2026-11-24 requires it to be
 * shown, never dropped, and marked as such.
 */
export const LEGACY_MARK = 'legacy record, source hospital unknown';

function marked(name: string, legacy: boolean | undefined): string {
  return legacy === true ? `${name} (${LEGACY_MARK})` : name;
}

/** A medication the patient is already on, as the screen compares to it. */
export interface CurrentMedication {
  /** The `RX-…` reference, so a warning can name the offending script. */
  readonly prescriptionId: string;
  readonly medicationId: string;
  readonly name: string;
  readonly genericName: string;
  readonly category: string;
  readonly isHighRisk: boolean;
  /** A legacy prescription with no owning hospital (safety exception). */
  readonly legacy?: boolean;
}

/** One `drug_interactions` row, already resolved to the partner drug. */
export interface InteractionFinding {
  readonly partnerMedicationId: string;
  readonly severity: ScreenSeverity;
  readonly title: string;
  readonly detail: string;
  readonly management: string | null;
}

export interface PatientAllergy {
  readonly allergen: string;
  /** `mild | moderate | severe`, wire form. */
  readonly severity: string;
  /** A legacy allergy with no owning hospital (safety exception). */
  readonly legacy?: boolean;
}

export interface ScreenSubject {
  readonly patientName: string;
  readonly allergies: readonly PatientAllergy[];
  /** The candidate. */
  readonly medicationId: string;
  readonly brandName: string;
  readonly genericName: string;
  readonly category: string;
  readonly allergyClass: string | null;
  readonly currentMedications: readonly CurrentMedication[];
  /** Interaction rows found between the candidate and the current list. */
  readonly interactions: readonly InteractionFinding[];
}

export interface ScreenResult {
  readonly warnings: readonly ScreenWarning[];
  /**
   * API §7.5 — "Allergy match ⇒ `blocking: true`". True when any warning
   * is blocking, which is to say when an allergy conflict stands.
   */
  readonly blocking: boolean;
}

/**
 * Case- and whitespace-insensitive equality for clinical free text.
 *
 * `patient_allergies.allergen` is typed by a human and
 * `medications.allergy_class` by a catalogue editor; "penicillin" and
 * "Penicillin " are the same allergy and must match. Deliberately exact
 * after normalising rather than a substring test: `includes` would make
 * an allergy to "Codeine" match a drug class of "Iodinated contrast"
 * the moment either string contained the other, and a false allergy
 * block is an un-overridable refusal to treat.
 */
function sameTerm(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Rule 1 — allergy. Blocking, always, and there is no override path.
 *
 * The match is against `allergy_class`, which DB §F1's column comment
 * names for exactly this purpose: "Matched against
 * `patient_allergies.allergen` in the safety screen. API §7.7 gives an
 * allergy conflict no override path, so this column is load-bearing
 * rather than advisory."
 *
 * It is **also** matched against the brand and generic names, and that
 * is identity rather than a clinical rule: a patient recorded as
 * allergic to "Amoxicillin" is allergic to the drug called Amoxicillin,
 * whatever its class column happens to say. Omitting it would let a
 * recorded allergy to the exact drug being prescribed pass unremarked
 * whenever the catalogue row's `allergy_class` was left null — which is
 * every medication in the seed but one.
 *
 * Severity follows the frontend's coded screen: `critical` when the
 * patient has any allergy on file flagged `severe` (its
 * `hasSevereAllergy`), `warning` otherwise. Blocking does not follow
 * severity — a moderate recorded allergy still stops the prescription,
 * because §7.5 says an allergy match blocks and says nothing about
 * grading that decision.
 */
function allergyWarnings(subject: ScreenSubject): readonly ScreenWarning[] {
  const candidateTerms = [subject.allergyClass, subject.genericName, subject.brandName].filter(
    (term): term is string => term !== null && term.trim() !== '',
  );

  const matched = subject.allergies.filter((allergy) =>
    candidateTerms.some((term) => sameTerm(term, allergy.allergen)),
  );

  if (matched.length === 0) return [];

  // `hasSevereAllergy` is a property of the patient, not of the matched
  // row — the frontend computes it across every allergy on file
  // (`patient.service.ts:665`), and this mirrors it so one patient does
  // not get two different answers from two surfaces.
  const hasSevere = subject.allergies.some((allergy) => sameTerm(allergy.severity, 'severe'));
  const names = matched.map((allergy) => marked(allergy.allergen, allergy.legacy));
  const label = subject.allergyClass ?? subject.genericName;

  return [
    {
      id: 'safety-allergy',
      kind: 'allergy',
      severity: hasSevere ? 'critical' : 'warning',
      title: `Allergy conflict — ${label}`,
      detail:
        `${subject.patientName} has a recorded ${names.join(', ')} allergy` +
        `${hasSevere ? ', flagged severe' : ''}. ` +
        `${subject.brandName} (${subject.genericName}) belongs to that class and may ` +
        `cross-react. Choose a different medication — this cannot be overridden.`,
      against: names.map((name) => `Recorded allergy: ${name}`),
      blocking: true,
    },
  ];
}

/**
 * Rule 2 — drug–drug interaction, graded by the pair.
 *
 * One warning per interacting pair rather than one per prescription:
 * `drug_interactions` grades the *pair*, so collapsing three findings
 * into one line would have to pick a single severity for all of them and
 * would lose the management advice that differs per pair.
 *
 * `management` is appended when present because it is the actionable
 * half — "Check INR within 3–5 days" is what the reader does about the
 * mechanism `detail` explains.
 */
function interactionWarnings(subject: ScreenSubject): readonly ScreenWarning[] {
  const byMedicationId = new Map(
    subject.currentMedications.map((medication) => [medication.medicationId, medication]),
  );

  return subject.interactions.flatMap((finding) => {
    const partner = byMedicationId.get(finding.partnerMedicationId);

    // A finding whose partner is not on the current list cannot be
    // described truthfully ("interacts with — ?"), so it is dropped
    // rather than rendered with a blank. The repository only returns
    // pairs drawn from that list, so this is a guard, not a path.
    if (partner === undefined) return [];

    const label = marked(`${partner.name} (${partner.genericName})`, partner.legacy);

    return [
      {
        id: `safety-interaction-${finding.partnerMedicationId}`,
        kind: 'interaction' as const,
        severity: finding.severity,
        title: finding.title,
        detail:
          `${finding.detail} The patient is currently taking ${label}` +
          `${partner.isHighRisk ? ', a high-alert medication' : ''}.` +
          `${finding.management === null ? '' : ` ${finding.management}`}`,
        against: [label],
        blocking: false,
      },
    ];
  });
}

/**
 * Rule 3 — duplicate therapy, two tiers, neither blocking.
 *
 * Transcribed from the frontend's `duplicateWarnings`, including the
 * grading and the precedence: an exact generic match is `critical` and
 * suppresses the class-level check, because "already taking this drug"
 * is the more specific and more serious finding, and reporting both
 * would put the same prescription in two warnings.
 */
function duplicateWarnings(subject: ScreenSubject): readonly ScreenWarning[] {
  const sameDrug = subject.currentMedications.filter((medication) =>
    sameTerm(medication.genericName, subject.genericName),
  );

  if (sameDrug.length > 0) {
    const names = sameDrug.map((medication) =>
      marked(`${medication.name} · ${medication.prescriptionId}`, medication.legacy),
    );

    return [
      {
        id: 'safety-duplicate',
        kind: 'duplicate',
        severity: 'critical',
        title: `Duplicate therapy — ${subject.genericName} is already active`,
        detail:
          `${subject.patientName} already has an active prescription for ` +
          `${subject.genericName} (${names.join(', ')}). Signing this one doubles the ` +
          `dose unless the existing prescription is cancelled first.`,
        against: names,
        blocking: false,
      },
    ];
  }

  const sameClass = subject.currentMedications.filter((medication) =>
    sameTerm(medication.category, subject.category),
  );

  if (sameClass.length === 0) return [];

  const names = sameClass.map((medication) =>
    marked(`${medication.name} (${medication.genericName})`, medication.legacy),
  );

  return [
    {
      id: 'safety-duplicate',
      kind: 'duplicate',
      severity: 'warning',
      title: `Duplicate therapy — another ${subject.category.toLowerCase()} is active`,
      detail:
        `${subject.patientName} is already taking ${names.join(', ')}, in the same ` +
        `class (${subject.category}). Confirm both are intended.`,
      against: names,
      blocking: false,
    },
  ];
}

const SEVERITY_ORDER: Record<ScreenSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * The screen. Pure, synchronous, total — it cannot throw and cannot
 * return undefined, so there is no failure mode here that could be
 * mistaken for "checked and clear". Failing to *reach* the data is the
 * caller's problem and becomes `safety_check_unavailable` (M13.3).
 */
export function screenPrescription(subject: ScreenSubject): ScreenResult {
  const warnings = [
    ...allergyWarnings(subject),
    ...interactionWarnings(subject),
    ...duplicateWarnings(subject),
  ].sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]);

  return {
    warnings,
    blocking: warnings.some((warning) => warning.blocking),
  };
}

/**
 * The warnings a clinician must tick before signing (M13.3, API §7.7).
 *
 * The frontend's `warningsNeedingAcknowledgment` verbatim: everything
 * above `info` that is not blocking. A blocking warning is excluded
 * because it cannot be acknowledged at all — offering a tick box for it
 * would suggest the prescription becomes signable, and it never does.
 */
export function warningsNeedingAcknowledgment(
  warnings: readonly ScreenWarning[],
): readonly ScreenWarning[] {
  return warnings.filter((warning) => warning.severity !== 'info' && !warning.blocking);
}

/** The blocking subset — allergy conflicts, and nothing else today. */
export function blockingWarnings(warnings: readonly ScreenWarning[]): readonly ScreenWarning[] {
  return warnings.filter((warning) => warning.blocking);
}
