import { useCallback, useEffect, useRef, useState } from 'react';

import { usePatientDirectoryQuery } from '@/features/shared-domain/patient-identity';

import {
  canAdvanceTo,
  emptyDraft,
  isDraftComplete,
  isStepValid,
  nextRecordStep,
  previousRecordStep,
  recordStepIndex,
  toRecordPatientSnapshot,
  withDiagnosisAdded,
  withDiagnosisRemoved,
  withPrimaryDiagnosis,
  type DraftVitals,
  type MedicalRecordDraft,
  type NarrativeField,
  type RecordStepId,
} from '../model/authoring';
import type { RecordPatientSnapshot } from '../model/types';

/**
 * The authoring flow's state (D-21).
 *
 * The hook owns the draft and the current step and nothing else: every
 * question about whether a step is reachable or the draft is finished is
 * delegated to `model/authoring.ts`, so the rules are unit-testable without a
 * renderer and there is no second opinion living in component state.
 *
 * `dirty` drives the unsaved-changes guard. It is "has anything been entered",
 * not "does this differ from a saved copy" — a draft that has never been
 * saved is exactly the thing a navigation would lose.
 */

function newDraftId(): string {
  return `draft-record-${Date.now().toString(36)}`;
}

export interface UseRecordAuthoringOptions {
  /** From `?patient=`; pre-selects and opens on the encounter step. */
  readonly initialPatientId: string | null;
}

export function useRecordAuthoring({ initialPatientId }: UseRecordAuthoringOptions) {
  const [draft, setDraft] = useState<MedicalRecordDraft>(() =>
    emptyDraft(newDraftId(), new Date().toISOString()),
  );
  const [step, setStep] = useState<RecordStepId>('patient');
  const [furthestReached, setFurthestReached] = useState<RecordStepId>(step);

  /*
   * `?patient=` resolves against the directory, which loads asynchronously:
   * once it answers, the patient is pre-selected and the flow opens on the
   * encounter step — once, and only if the doctor has not chosen already.
   */
  const directory = usePatientDirectoryQuery({ enabled: initialPatientId !== null });
  const seededFromLink = useRef(false);
  useEffect(() => {
    if (seededFromLink.current || initialPatientId === null || directory.data === undefined) {
      return;
    }
    seededFromLink.current = true;
    const patient = directory.data.find((candidate) => candidate.id === initialPatientId);
    if (patient === undefined) return;
    setDraft((previous) =>
      previous.patient === null
        ? { ...previous, patient: toRecordPatientSnapshot(patient) }
        : previous,
    );
    setStep((previous) => (previous === 'patient' ? 'visit' : previous));
    setFurthestReached((previous) => (previous === 'patient' ? 'visit' : previous));
  }, [directory.data, initialPatientId]);
  /** Issues stay quiet until the doctor tries to move on — not while typing. */
  const [showIssues, setShowIssues] = useState(false);
  const [dirty, setDirty] = useState(false);

  const update = useCallback((mutate: (previous: MedicalRecordDraft) => MedicalRecordDraft) => {
    setDirty(true);
    setDraft((previous) => ({ ...mutate(previous), updatedAt: new Date().toISOString() }));
  }, []);

  const goTo = useCallback(
    (target: RecordStepId) => {
      if (!canAdvanceTo(draft, target)) {
        setShowIssues(true);
        return;
      }
      setShowIssues(false);
      setStep(target);
      setFurthestReached((previous) =>
        recordStepIndex(target) > recordStepIndex(previous) ? target : previous,
      );
    },
    [draft],
  );

  const goNext = useCallback(() => {
    const target = nextRecordStep(step);
    if (target === null) return;
    goTo(target);
  }, [goTo, step]);

  const goBack = useCallback(() => {
    const target = previousRecordStep(step);
    if (target === null) return;
    // Going back is always allowed — it cannot make the draft less valid.
    setShowIssues(false);
    setStep(target);
  }, [step]);

  return {
    draft,
    step,
    furthestReached,
    showIssues,
    dirty,
    complete: isDraftComplete(draft),

    isStepValid: useCallback((candidate: RecordStepId) => isStepValid(draft, candidate), [draft]),
    isStepReachable: useCallback(
      (candidate: RecordStepId) => canAdvanceTo(draft, candidate),
      [draft],
    ),

    goTo,
    goNext,
    goBack,

    setPatient: useCallback(
      (patient: RecordPatientSnapshot) => update((previous) => ({ ...previous, patient })),
      [update],
    ),
    setVisitField: useCallback(
      (field: 'visitDate' | 'visitType' | 'department', value: string | null) =>
        update((previous) => ({ ...previous, visit: { ...previous.visit, [field]: value } })),
      [update],
    ),
    setNarrative: useCallback(
      (field: NarrativeField, value: string) =>
        update((previous) => ({ ...previous, [field]: value })),
      [update],
    ),
    setVital: useCallback(
      <K extends keyof DraftVitals>(field: K, value: DraftVitals[K]) =>
        update((previous) => ({ ...previous, vitals: { ...previous.vitals, [field]: value } })),
      [update],
    ),
    addDiagnosis: useCallback(
      (code: string) =>
        update((previous) => ({
          ...previous,
          diagnoses: withDiagnosisAdded(previous.diagnoses, code),
        })),
      [update],
    ),
    removeDiagnosis: useCallback(
      (code: string) =>
        update((previous) => ({
          ...previous,
          diagnoses: withDiagnosisRemoved(previous.diagnoses, code),
        })),
      [update],
    ),
    makePrimaryDiagnosis: useCallback(
      (code: string) =>
        update((previous) => ({
          ...previous,
          diagnoses: withPrimaryDiagnosis(previous.diagnoses, code),
        })),
      [update],
    ),
    setNoteField: useCallback(
      (field: 'title' | 'body', value: string) =>
        update((previous) => ({ ...previous, note: { ...previous.note, [field]: value } })),
      [update],
    ),

    /** Called once the draft has been saved or turned into a record. */
    markClean: useCallback(() => setDirty(false), []),
    replaceDraft: useCallback((next: MedicalRecordDraft) => {
      setDraft(next);
      setDirty(false);
    }, []),
  } as const;
}
