import { useCallback, useMemo, useRef, useState } from 'react';

import {
  AUTHORING_STEP_IDS,
  canAdvanceTo,
  completeDraft,
  emptyDraft,
  findMedicationSpec,
  nextStep,
  previousStep,
  stepIndex,
  suggestedInstructions,
  suggestedQuantity,
  validateAllSteps,
  type AuthoringStepId,
  type DraftDosage,
  type PrescriptionDraft,
  type StepBlock,
} from '../model/authoring';
import type { Formulary } from '../model/catalogue';
import {
  assessSignability,
  isCompleted,
  runSafetyCheck,
  subjectFromDraft,
  subjectKey,
  type CurrentMedication,
  type SafetyAcknowledgment,
  type SafetyCheckRunner,
  type SafetyCheckSubject,
  type SafetyEvidenceSource,
  type SafetyVerdict,
  type SignabilityResult,
} from '../model/safety-check';
import type { PrescriptionPatientSnapshot } from '../model/types';

/**
 * The authoring flow's state machine (D-17).
 *
 * Two invariants live here, and both are enforced by construction rather
 * than by remembering to call something:
 *
 * 1. **The verdict belongs to a subject.** Any edit that changes what would
 *    be screened — the medication, the strength, the schedule, the duration,
 *    the quantity — drops the verdict and the acknowledgment together. There
 *    is no path that keeps a tick made against an older medication, because
 *    the tick is stored inside the acknowledgment and the acknowledgment is
 *    stored beside the verdict it was given against.
 * 2. **Review is gated on a completed verdict, not on "not currently
 *    running".** `safetyCleared` is true only for a completed verdict whose
 *    `subjectKey` still matches the draft. Idle, running, failed, timed out
 *    and stale all read false.
 */

export type SafetyPhase = 'idle' | 'running' | 'settled';

export interface AuthoringFlowOptions {
  /** Pre-selected patient (deep-link from a patient context). */
  readonly initialPatient?: PrescriptionPatientSnapshot | null;
  /** Resume a saved or renewal draft instead of starting empty. */
  readonly initialDraft?: PrescriptionDraft | null;
  /** The patient's active prescriptions — what interactions are screened against. */
  readonly currentMedications: readonly CurrentMedication[];
  /**
   * Whether that list is actually known. An empty array means two very
   * different things — "this patient takes nothing" and "the list has not
   * loaded" — and screening the second as the first silently reports no
   * interaction and no duplicate for a patient who has both. Defaults to
   * true so a caller supplying a literal list needs no ceremony; the page
   * passes the query's success state.
   */
  readonly medicationsKnown?: boolean;
  /** The formulary the draft is written from — the service's, already loaded. */
  readonly formulary: Formulary;
  /** The port's `checkSafety`, or a fault-injecting wrapper around it. */
  readonly runner: SafetyCheckRunner;
  /** What `runner` screens against (the port's `capabilities.safetySource`). */
  readonly safetySource?: SafetyEvidenceSource;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface AuthoringFlow {
  readonly draft: PrescriptionDraft;
  readonly step: AuthoringStepId;
  readonly validation: ReturnType<typeof validateAllSteps>;
  /** Steps whose advance has been attempted — issues show only after that. */
  readonly showIssuesFor: ReadonlySet<AuthoringStepId>;
  readonly safetyPhase: SafetyPhase;
  readonly verdict: SafetyVerdict | null;
  readonly subject: SafetyCheckSubject | null;
  readonly acknowledgment: SafetyAcknowledgment | null;
  readonly acknowledgedIds: readonly string[];
  readonly acknowledgmentReason: string;
  readonly signability: SignabilityResult;
  readonly blockedBy: StepBlock | null;
  readonly furthestReached: AuthoringStepId;

  readonly setPatient: (patient: PrescriptionPatientSnapshot | null) => void;
  readonly setMedication: (genericName: string) => void;
  readonly setStrength: (strength: string) => void;
  readonly setDosage: <K extends keyof DraftDosage>(key: K, value: DraftDosage[K]) => void;
  readonly goTo: (step: AuthoringStepId) => void;
  readonly back: () => void;
  readonly advance: () => void;
  readonly runCheck: () => void;
  readonly toggleAcknowledged: (warningId: string) => void;
  readonly setAcknowledgmentReason: (reason: string) => void;
  readonly resetDraft: () => void;
}

let draftCounter = 0;
function newDraftId(): string {
  draftCounter += 1;
  return `draft-${Date.now().toString(36)}-${String(draftCounter)}`;
}

export function usePrescriptionAuthoring(options: AuthoringFlowOptions): AuthoringFlow {
  const {
    initialPatient = null,
    initialDraft = null,
    currentMedications,
    medicationsKnown = true,
    formulary,
    runner,
    safetySource = 'demo-formulary',
  } = options;

  const [draft, setDraft] = useState<PrescriptionDraft>(() => {
    if (initialDraft !== null) return initialDraft;
    const base = emptyDraft(newDraftId(), new Date().toISOString());
    return initialPatient === null ? base : { ...base, patient: initialPatient };
  });

  const [step, setStep] = useState<AuthoringStepId>(() =>
    (initialDraft?.patient ?? initialPatient) === null ? 'patient' : 'medication',
  );
  const [showIssuesFor, setShowIssuesFor] = useState<ReadonlySet<AuthoringStepId>>(new Set());
  const [safetyPhase, setSafetyPhase] = useState<SafetyPhase>('idle');
  const [verdict, setVerdict] = useState<SafetyVerdict | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState<readonly string[]>([]);
  const [acknowledgmentReason, setAcknowledgmentReason] = useState('');
  const [blockedBy, setBlockedBy] = useState<StepBlock | null>(null);
  const [furthestReached, setFurthestReached] = useState<AuthoringStepId>(step);

  /** Guards against a superseded check landing after a newer one. */
  const runToken = useRef(0);

  const validation = useMemo(() => validateAllSteps(draft, formulary), [draft, formulary]);
  const complete = useMemo(() => completeDraft(draft, formulary), [draft, formulary]);
  const subject = useMemo(
    () => (complete === null ? null : subjectFromDraft(complete, currentMedications)),
    [complete, currentMedications],
  );

  /**
   * A verdict counts only while it still describes the current draft. This is
   * belt-and-braces beside `invalidateVerdict` — if some future edit path
   * forgets to clear, the key comparison still refuses the stale verdict.
   */
  const safetyCleared =
    isCompleted(verdict) && subject !== null && verdict.subjectKey === subjectKey(subject);

  const acknowledgment: SafetyAcknowledgment | null = useMemo(() => {
    if (!isCompleted(verdict)) return null;
    if (acknowledgedIds.length === 0) return null;
    return {
      verdictId: verdict.id,
      warningIds: acknowledgedIds,
      reason: acknowledgmentReason.trim(),
      acknowledgedAt: new Date().toISOString(),
    };
  }, [verdict, acknowledgedIds, acknowledgmentReason]);

  /*
   * One authority on signability: `assessSignability`. The "a critical
   * warning also needs a stated reason" rule lives inside it (via
   * `acknowledgmentApplies`), not as a pre-check here — short-circuiting it
   * upstream reported "acknowledge every warning" for a prescription whose
   * actual blocker was a blocking allergy conflict that no acknowledgment
   * can clear.
   */
  const signability = useMemo<SignabilityResult>(
    () => assessSignability({ draft: complete, verdict, subject, acknowledgment }),
    [complete, verdict, subject, acknowledgment],
  );

  /** Any edit to what gets screened voids the verdict and every tick on it. */
  const invalidateVerdict = useCallback(() => {
    runToken.current += 1;
    setVerdict(null);
    setSafetyPhase('idle');
    setAcknowledgedIds([]);
    setAcknowledgmentReason('');
    setFurthestReached((current) => (current === 'review' ? 'dosage' : current));
  }, []);

  const patch = useCallback(
    (next: Partial<PrescriptionDraft>) => {
      setDraft((current) => ({ ...current, ...next, updatedAt: new Date().toISOString() }));
    },
    [],
  );

  const setPatient = useCallback(
    (patient: PrescriptionPatientSnapshot | null) => {
      invalidateVerdict();
      patch({ patient });
    },
    [invalidateVerdict, patch],
  );

  const setMedication = useCallback(
    (genericName: string) => {
      invalidateVerdict();
      const spec = findMedicationSpec(genericName, formulary);
      const strength = spec?.strengths[0] ?? '';
      setDraft((current) => ({
        ...current,
        medication: { genericName, strength },
        // The schedule vocabulary belongs to the medication, so a change of
        // drug cannot keep a frequency the new drug does not offer.
        dosage: {
          ...current.dosage,
          frequency: null,
          durationDays: spec?.durationsDays[0] ?? null,
          quantity: null,
          refillsAllowed: spec?.isControlled === true ? 0 : current.dosage.refillsAllowed,
          instructions: '',
        },
        updatedAt: new Date().toISOString(),
      }));
    },
    [invalidateVerdict, formulary],
  );

  const setStrength = useCallback(
    (strength: string) => {
      invalidateVerdict();
      setDraft((current) =>
        current.medication === null
          ? current
          : {
              ...current,
              medication: { ...current.medication, strength },
              updatedAt: new Date().toISOString(),
            },
      );
    },
    [invalidateVerdict],
  );

  const setDosage = useCallback(
    <K extends keyof DraftDosage>(key: K, value: DraftDosage[K]) => {
      invalidateVerdict();
      setDraft((current) => {
        let dosage: DraftDosage = { ...current.dosage, [key]: value };
        const spec =
          current.medication === null
            ? null
            : findMedicationSpec(current.medication.genericName, formulary);

        // Propose a quantity and instructions once the schedule is known;
        // both remain editable, and neither overwrites a doctor's own text.
        if ((key === 'frequency' || key === 'durationDays') && spec !== null) {
          if (dosage.frequency !== null && dosage.durationDays !== null) {
            dosage = {
              ...dosage,
              quantity: suggestedQuantity(dosage.frequency, dosage.durationDays),
            };
          }
          if (dosage.frequency !== null && dosage.instructions.trim() === '') {
            dosage = {
              ...dosage,
              instructions: suggestedInstructions(
                spec,
                current.medication?.strength ?? '',
                dosage.frequency,
              ),
            };
          }
        }

        return { ...current, dosage, updatedAt: new Date().toISOString() };
      });
    },
    [invalidateVerdict, formulary],
  );

  const runCheck = useCallback(() => {
    if (subject === null) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setSafetyPhase('running');
    setVerdict(null);
    setAcknowledgedIds([]);
    setAcknowledgmentReason('');

    /*
     * Fail closed on missing context, not just on a failing check. Without
     * the patient's current medications there is nothing to screen
     * interactions and duplicates against, and an empty verdict here would
     * read as "checked and clear" — the fail-open this feature exists to
     * prevent, arriving through the back door.
     */
    if (!medicationsKnown) {
      setVerdict({
        status: 'failed',
        id: `chk-ctx-${String(token)}`,
        subjectKey: subjectKey(subject),
        attemptedAt: new Date().toISOString(),
        reason: 'error',
        message:
          "The patient's current medications could not be loaded, so interactions and duplicate therapy cannot be screened.",
      });
      setSafetyPhase('settled');
      return;
    }

    void runSafetyCheck(subject, {
      run: runner,
      source: safetySource,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.newId === undefined ? {} : { newId: options.newId }),
    }).then((result) => {
      // A superseded run must never install its verdict — that is how a
      // check for the previous medication would end up clearing this one.
      if (runToken.current !== token) return;
      setVerdict(result);
      setSafetyPhase('settled');
      if (result.status === 'completed') {
        setStep('review');
        setFurthestReached('review');
        setBlockedBy(null);
      }
    });
  }, [
    subject,
    runner,
    safetySource,
    medicationsKnown,
    options.timeoutMs,
    options.now,
    options.newId,
  ]);

  const goTo = useCallback(
    (target: AuthoringStepId) => {
      const transition = canAdvanceTo(draft, step, target, { safetyCleared, formulary });

      if (transition.allowed) {
        setBlockedBy(null);
        setStep(target);
        setFurthestReached((current) =>
          stepIndex(target) > stepIndex(current) ? target : current,
        );
        return;
      }

      setBlockedBy(transition.blockedBy);

      if (transition.blockedBy.kind === 'invalid-step') {
        // Surface that step's issues and put the doctor on it.
        const blocking = transition.blockedBy.step;
        setShowIssuesFor((current) => new Set([...current, blocking]));
        setStep(blocking);
        return;
      }

      // Review was asked for without a completed verdict. Stand on Dosage and
      // run the screen; Review becomes reachable only if it completes.
      setStep('dosage');
      if (safetyPhase !== 'running') runCheck();
    },
    [draft, step, safetyCleared, formulary, safetyPhase, runCheck],
  );

  const advance = useCallback(() => {
    const validationForStep = validation[step];
    if (!validationForStep.valid) {
      setShowIssuesFor((current) => new Set([...current, step]));
      setBlockedBy({ kind: 'invalid-step', step });
      return;
    }
    const target = nextStep(step);
    if (target === null) return;
    goTo(target);
  }, [validation, step, goTo]);

  const back = useCallback(() => {
    const target = previousStep(step);
    if (target !== null) {
      setBlockedBy(null);
      setStep(target);
    }
  }, [step]);

  const toggleAcknowledged = useCallback((warningId: string) => {
    setAcknowledgedIds((current) =>
      current.includes(warningId)
        ? current.filter((id) => id !== warningId)
        : [...current, warningId],
    );
  }, []);

  const resetDraft = useCallback(() => {
    runToken.current += 1;
    setDraft(emptyDraft(newDraftId(), new Date().toISOString()));
    setStep(AUTHORING_STEP_IDS[0] ?? 'patient');
    setShowIssuesFor(new Set());
    setSafetyPhase('idle');
    setVerdict(null);
    setAcknowledgedIds([]);
    setAcknowledgmentReason('');
    setBlockedBy(null);
    setFurthestReached('patient');
  }, []);

  return {
    draft,
    step,
    validation,
    showIssuesFor,
    safetyPhase,
    verdict,
    subject,
    acknowledgment,
    acknowledgedIds,
    acknowledgmentReason,
    signability,
    blockedBy,
    furthestReached,
    setPatient,
    setMedication,
    setStrength,
    setDosage,
    goTo,
    back,
    advance,
    runCheck,
    toggleAcknowledged,
    setAcknowledgmentReason,
    resetDraft,
  };
}
