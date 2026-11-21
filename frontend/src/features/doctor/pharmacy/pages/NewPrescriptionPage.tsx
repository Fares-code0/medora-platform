import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FilePlus2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useToast } from '@/app/providers';
import { Alert, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { Breadcrumb, Button, Card } from '@/components/ui';
import { env } from '@/configs/env';
import { usePatientDirectoryQuery } from '@/features/shared-domain/patient-identity';
import { routes } from '@/routes';
import { isApiError } from '@/types/api';

import { useSaveDraftMutation, useSignPrescriptionMutation } from '../api/usePrescriptionMutations';
import {
  useCurrentMedicationsQuery,
  useFormularyQuery,
  usePrescriptionDraftsQuery,
  usePrescriptionsQuery,
} from '../api/usePrescriptionsQuery';
import { AuthoringStepper } from '../components/authoring/AuthoringStepper';
import { DosageStep } from '../components/authoring/DosageStep';
import { MedicationStep } from '../components/authoring/MedicationStep';
import {
  PatientContextStrip,
  type CurrentMedicationsState,
} from '../components/authoring/PatientContextStrip';
import { PatientStep } from '../components/authoring/PatientStep';
import { ReviewStep } from '../components/authoring/ReviewStep';
import { SafetyScreen } from '../components/authoring/SafetyScreen';
import { usePrescriptionAuthoring } from '../hooks/usePrescriptionAuthoring';
import {
  AUTHORING_STEPS,
  canAdvanceTo,
  completeDraft,
  stepIndex,
  toPrescriptionPatient,
  type AuthoringStepId,
  type PrescriptionDraft,
} from '../model/authoring';
import type { Formulary } from '../model/catalogue';
import { CURRENT_PRESCRIPTION_STATUSES } from '../model/prescription-service';
import {
  isCompleted,
  subjectKey,
  type CurrentMedication,
  type SafetyCheckRunner,
  type SignabilityResult,
} from '../model/safety-check';
import {
  SAFETY_SIMULATION_LABEL,
  parseSafetySimulation,
  simulateSafetyRunner,
} from '../model/safety-simulation';
import type { PrescriptionPatientSnapshot } from '../model/types';
import { prescriptionService } from '../service';

/**
 * The prescription authoring flow (D-17) — Patient → Medication → Dosage →
 * Review & sign, with the blocking safety screen between the last two.
 *
 * Entry points, all deep-linkable:
 *   `/doctor/pharmacy/new`                  cold start, patient picker
 *   `/doctor/pharmacy/new?patient=PT-1002`  pre-selected patient, opens on step 2
 *   `/doctor/pharmacy/new?draft=<id>`       resume a saved or renewal draft
 *   `/doctor/pharmacy/new?simulate=error`   fault-injected safety check (mocks only)
 *
 * Headings: `ContentHeader` owns the page's one h1, the step card is an h2,
 * and the cards inside a step are h3 — no level is skipped (F-17). Focus
 * moves to the step panel on every advance, and the safety screen takes
 * focus while it blocks, so a keyboard user is never stranded on a control
 * that has just been unmounted.
 */

/**
 * Why a signature was refused, in the server's words when it gave some — an
 * allergy conflict, a missing acknowledgment, an unreachable screen (API
 * §7.7) — and never a generic "try again" for a refusal that retrying will
 * not change.
 */
function refusalOf(error: Error): string {
  if (isApiError(error) && error.kind === 'conflict') return error.detail;
  if (isApiError(error) && error.kind === 'validation') {
    const first = Object.values(error.fieldErrors)[0]?.[0];
    if (first !== undefined) return first;
  }
  return 'Nothing was issued. Please try again.';
}

export function NewPrescriptionPage() {
  const [searchParams] = useSearchParams();

  const patientParam = searchParams.get('patient');
  const draftParam = searchParams.get('draft');
  const simulation = env.enableMocks ? parseSafetySimulation(searchParams.get('simulate')) : null;

  const draftsQuery = usePrescriptionDraftsQuery();
  const formulary = useFormularyQuery();
  const directory = usePatientDirectoryQuery({ enabled: patientParam !== null });

  const initialPatient = useMemo(() => {
    if (patientParam === null) return null;
    const patient = directory.data?.find((candidate) => candidate.id === patientParam);
    return patient ? toPrescriptionPatient(patient) : null;
  }, [patientParam, directory.data]);

  const runner = useMemo<SafetyCheckRunner>(() => {
    const base: SafetyCheckRunner = (subject, signal) =>
      prescriptionService.checkSafety(subject, signal);
    return simulation === null ? base : simulateSafetyRunner(simulation, base);
  }, [simulation]);

  /*
   * A resumed draft is captured once. Re-seeding the flow every time the
   * drafts query refetches would discard whatever the doctor typed since.
   */
  const [resumedDraft, setResumedDraft] = useState<PrescriptionDraft | null>(null);
  const resumeSettled = useRef(false);
  useEffect(() => {
    if (draftParam === null || resumeSettled.current || draftsQuery.data === undefined) return;
    resumeSettled.current = true;
    setResumedDraft(draftsQuery.data.find((candidate) => candidate.id === draftParam) ?? null);
  }, [draftParam, draftsQuery.data]);

  // Wait for the draft lookup before mounting the flow, so a resumed draft is
  // the flow's initial state rather than something applied to it afterwards.
  const waitingForDraft = draftParam !== null && !resumeSettled.current;

  /*
   * Nothing can be validated without the formulary, and a deep-linked
   * patient is the flow's initial state — so both are in hand before the
   * flow mounts. A formulary that will not load is an error, never the
   * demo list standing in for it.
   */
  if (formulary.isError) {
    return (
      <PageContainer width="xl">
        <ErrorState
          title="Couldn't load the formulary"
          description="A prescription cannot be written without it."
          error={formulary.error}
          onRetry={() => void formulary.refetch()}
        />
      </PageContainer>
    );
  }
  if (formulary.data === undefined || (patientParam !== null && directory.isPending)) {
    return (
      <PageContainer width="xl">
        <Stack gap={3} aria-busy="true" aria-label="Loading the prescription form">
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </Stack>
      </PageContainer>
    );
  }

  return (
    <AuthoringFlow
      key={waitingForDraft ? 'loading-draft' : (resumedDraft?.id ?? 'fresh')}
      formulary={formulary.data}
      initialPatient={initialPatient}
      initialDraft={resumedDraft}
      runner={runner}
      simulationNote={simulation === null ? null : SAFETY_SIMULATION_LABEL[simulation]}
      waitingForDraft={waitingForDraft}
      missingDraft={draftParam !== null && resumeSettled.current && resumedDraft === null}
    />
  );
}

interface AuthoringFlowProps {
  formulary: Formulary;
  initialPatient: PrescriptionPatientSnapshot | null;
  initialDraft: PrescriptionDraft | null;
  runner: SafetyCheckRunner;
  simulationNote: string | null;
  waitingForDraft: boolean;
  missingDraft: boolean;
}

function AuthoringFlow({
  formulary,
  initialPatient,
  initialDraft,
  runner,
  simulationNote,
  waitingForDraft,
  missingDraft,
}: AuthoringFlowProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const prescriptionsQuery = usePrescriptionsQuery();
  const saveDraft = useSaveDraftMutation();
  const signPrescription = useSignPrescriptionMutation();

  const [patientId, setPatientId] = useState<string | null>(
    initialDraft?.patient?.id ?? initialPatient?.id ?? null,
  );

  /*
   * Interactions and duplicates are screened against what this patient is
   * actually on — their active prescriptions — not a canned list.
   */
  const currentMedications = useMemo<readonly CurrentMedication[]>(() => {
    if (patientId === null) return [];
    return (prescriptionsQuery.data ?? [])
      .filter(
        (prescription) =>
          prescription.patient.id === patientId && CURRENT_PRESCRIPTION_STATUSES.has(prescription.status),
      )
      .map((prescription) => ({
        prescriptionId: prescription.id,
        name: prescription.medication.name,
        genericName: prescription.medication.genericName,
        category: prescription.medication.category,
        isHighRisk: prescription.medication.isHighRisk,
      }));
  }, [prescriptionsQuery.data, patientId]);

  /*
   * An empty list and an unloaded list are not the same fact. Until the
   * prescriptions query has actually answered, the flow is told the current
   * medications are unknown, and the safety check fails closed rather than
   * reporting "no interactions" for a patient whose list simply had not
   * arrived yet.
   */
  const medicationsKnown = patientId === null || prescriptionsQuery.isSuccess;

  /*
   * What the pinned strip shows: the patient's record, every prescriber
   * included — not `currentMedications` above, which is the demo engine's
   * input and, live, only this doctor's own prescriptions (API §7.3).
   */
  const onRecordQuery = useCurrentMedicationsQuery(patientId);
  const currentMedicationsState: CurrentMedicationsState = onRecordQuery.isError
    ? { status: 'error', retry: () => void onRecordQuery.refetch() }
    : onRecordQuery.isSuccess
      ? { status: 'success', medications: onRecordQuery.data }
      : { status: 'pending' };

  const flow = usePrescriptionAuthoring({
    initialPatient,
    initialDraft,
    currentMedications,
    medicationsKnown,
    formulary,
    runner,
    safetySource: prescriptionService.capabilities.safetySource,
  });

  const selectedPatientId = flow.draft.patient?.id ?? null;
  useEffect(() => {
    setPatientId(selectedPatientId);
  }, [selectedPatientId]);

  const stepPanelRef = useRef<HTMLSpanElement>(null);
  const renderedStep = useRef<AuthoringStepId>(flow.step);
  useEffect(() => {
    if (renderedStep.current !== flow.step) {
      renderedStep.current = flow.step;
      stepPanelRef.current?.focus();
    }
  }, [flow.step]);

  const meta = AUTHORING_STEPS[stepIndex(flow.step)] ?? AUTHORING_STEPS[0]!;
  const complete = useMemo(() => completeDraft(flow.draft, formulary), [flow.draft, formulary]);
  const safetyCleared =
    isCompleted(flow.verdict) &&
    flow.subject !== null &&
    flow.verdict.subjectKey === subjectKey(flow.subject);

  const isReachable = useCallback(
    (step: AuthoringStepId) =>
      canAdvanceTo(flow.draft, flow.step, step, { safetyCleared, formulary }).allowed,
    [flow.draft, flow.step, safetyCleared, formulary],
  );

  const onSaveDraft = useCallback(() => {
    saveDraft.mutate(flow.draft, {
      onSuccess: () =>
        toast({
          variant: 'success',
          title: 'Saved as draft',
          description: 'Kept for this session. Nothing has been signed or sent.',
        }),
      onError: () =>
        toast({
          variant: 'error',
          title: 'Could not save the draft',
          description: 'Please try again.',
        }),
    });
  }, [saveDraft, flow.draft, toast]);

  const onSign = useCallback(
    (signable: NonNullable<SignabilityResult['signable']>) => {
      signPrescription.mutate(signable, {
        onSuccess: (prescription) => {
          toast({
            variant: 'success',
            title: `Prescription ${prescription.id} signed`,
            description: prescriptionService.capabilities.transmits
              ? 'Signed and issued. It is on the patient’s record.'
              : 'Recorded in this session. No pharmacy system is connected, so nothing was transmitted.',
          });
          navigate(routes.doctor.prescription(prescription.id));
        },
        onError: (error) =>
          toast({
            variant: 'error',
            title: 'Could not sign the prescription',
            description: refusalOf(error),
          }),
      });
    },
    [signPrescription, toast, navigate],
  );

  const blockedNotice =
    flow.blockedBy?.kind === 'invalid-step'
      ? `Finish the ${
          AUTHORING_STEPS[stepIndex(flow.blockedBy.step)]?.label ?? ''
        } step before moving on.`
      : flow.blockedBy?.kind === 'safety-not-cleared'
        ? 'Review is unavailable until the safety screen completes.'
        : null;

  const safetyScreen =
    flow.step === 'review' || (flow.step === 'dosage' && flow.safetyPhase !== 'idle') ? (
      <SafetyScreen
        phase={flow.safetyPhase}
        verdict={flow.verdict}
        acknowledgedIds={flow.acknowledgedIds}
        acknowledgmentReason={flow.acknowledgmentReason}
        onToggleAcknowledged={flow.toggleAcknowledged}
        onReasonChange={flow.setAcknowledgmentReason}
        onRetry={flow.runCheck}
        onSaveDraft={onSaveDraft}
        onChangeMedication={() => flow.goTo('medication')}
        savingDraft={saveDraft.isPending}
      />
    ) : null;

  return (
    <PageContainer width="xl">
      <PageSections>
        <ContentHeader
          title="New prescription"
          icon={FilePlus2}
          tone="success"
          caption="Patient, medication, dosage — then a blocking safety screen before you can sign."
          breadcrumb={
            <Breadcrumb
              items={[
                { label: 'Overview', href: routes.doctor.overview },
                { label: 'Pharmacy', href: routes.doctor.pharmacy },
                { label: 'New prescription' },
              ]}
            />
          }
        />

        {simulationNote !== null ? (
          <Alert variant="warning" title="Safety-check fault injection is active">
            {simulationNote} This is a demo switch for exercising the fail-closed path — drop the{' '}
            <code>simulate</code> parameter for the real check.
          </Alert>
        ) : null}

        {missingDraft ? (
          <Alert variant="warning" title="That draft is no longer available">
            Drafts are kept for the session only. Starting a new prescription instead.
          </Alert>
        ) : null}

        {waitingForDraft ? (
          <p className="text-body-sm text-text-secondary">Loading draft…</p>
        ) : null}

        <AuthoringStepper
          current={flow.step}
          furthestReached={flow.furthestReached}
          isStepValid={(step) => flow.validation[step].valid}
          isStepReachable={isReachable}
          onSelect={flow.goTo}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            <Stack gap={4}>
              <Card title={meta.label} subtitle={meta.caption} headingAs="h2">
                {/* Focus target for step changes. Visually hidden and not a
                    heading, so the document outline is unchanged. */}
                <span ref={stepPanelRef} tabIndex={-1} className="sr-only">
                  {meta.label}. {meta.caption}
                </span>

                {flow.step === 'patient' ? (
                  <PatientStep
                    selectedPatientId={flow.draft.patient?.id ?? null}
                    onSelect={flow.setPatient}
                    validation={flow.validation.patient}
                    showIssues={flow.showIssuesFor.has('patient')}
                  />
                ) : null}

                {flow.step === 'medication' ? (
                  <MedicationStep
                    formulary={formulary}
                    source={prescriptionService.capabilities.safetySource}
                    monographs={prescriptionService.capabilities.monographs}
                    genericName={flow.draft.medication?.genericName ?? null}
                    strength={flow.draft.medication?.strength ?? null}
                    onSelectMedication={flow.setMedication}
                    onSelectStrength={flow.setStrength}
                    validation={flow.validation.medication}
                    showIssues={flow.showIssuesFor.has('medication')}
                  />
                ) : null}

                {flow.step === 'dosage' ? (
                  <DosageStep
                    formulary={formulary}
                    genericName={flow.draft.medication?.genericName ?? null}
                    strength={flow.draft.medication?.strength ?? null}
                    dosage={flow.draft.dosage}
                    onChange={flow.setDosage}
                    validation={flow.validation.dosage}
                    showIssues={flow.showIssuesFor.has('dosage')}
                  />
                ) : null}

                {flow.step === 'review' && complete !== null ? (
                  <ReviewStep
                    draft={complete}
                    signability={flow.signability}
                    onSign={onSign}
                    onSaveDraft={onSaveDraft}
                    signing={signPrescription.isPending}
                    savingDraft={saveDraft.isPending}
                    transmits={prescriptionService.capabilities.transmits}
                  />
                ) : null}
              </Card>

              {blockedNotice !== null ? (
                <Alert variant="warning" title="Not yet">
                  {blockedNotice}
                </Alert>
              ) : null}

              {/* The safety screen owns the space between Dosage and Review:
                  on Dosage it is the blocker, on Review the record of what
                  was found and what was acknowledged. */}
              {safetyScreen}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" onClick={flow.back} disabled={flow.step === 'patient'}>
                  Back
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => navigate(routes.doctor.pharmacy)}>
                    Cancel
                  </Button>
                  {flow.step === 'review' ? null : (
                    <Button
                      onClick={flow.advance}
                      loading={
                        (flow.step === 'dosage' && flow.safetyPhase === 'running') ||
                        (flow.step === 'dosage' && !medicationsKnown)
                      }
                      disabled={flow.step === 'dosage' && !medicationsKnown}
                    >
                      {flow.step === 'dosage' ? 'Run safety screen' : 'Continue'}
                    </Button>
                  )}
                </div>
              </div>
            </Stack>
          </div>

          <div className="min-w-0 lg:col-span-4">
            <div className="lg:sticky lg:top-6">
              {flow.draft.patient === null ? (
                <Card title="Patient context" headingAs="h3" padding="compact">
                  <p className="text-body-sm text-text-secondary">
                    Choose a patient and their allergies and current medications stay pinned here
                    for the rest of the flow.
                  </p>
                </Card>
              ) : (
                <PatientContextStrip
                  patient={flow.draft.patient}
                  currentMedications={currentMedicationsState}
                />
              )}
            </div>
          </div>
        </div>
      </PageSections>
    </PageContainer>
  );
}
