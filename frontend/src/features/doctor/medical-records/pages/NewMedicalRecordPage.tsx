import { useEffect, useState } from 'react';

import { FilePlus2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useDoctorProfile, useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { Breadcrumb, Button, Card, ConfirmationDialog } from '@/components/ui';
import { usePatientDirectoryQuery } from '@/features/shared-domain/patient-identity';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { routes } from '@/routes';

import {
  useCreateRecordMutation,
  useSaveRecordDraftMutation,
} from '../api/useRecordMutations';
import { RecordClinicalStep } from '../components/authoring/RecordClinicalStep';
import { RecordPatientStep } from '../components/authoring/RecordPatientStep';
import { RecordReviewStep } from '../components/authoring/RecordReviewStep';
import { RecordStepper } from '../components/authoring/RecordStepper';
import { RecordVisitStep } from '../components/authoring/RecordVisitStep';
import { useRecordAuthoring } from '../hooks/useRecordAuthoring';
import { RECORD_STEPS, isDraftComplete, nextRecordStep, previousRecordStep } from '../model/authoring';
import { RECORD_NOTE_NOT_SAVED } from '../model/record-service';
import { recordService } from '../service';

/**
 * Record authoring (D-21) — the flow the module never had. UX §2.3's Notes
 * and Visits tabs describe signed/unsigned clinical notes; nothing in the
 * Phase-6 build could produce one.
 *
 * **Creating and signing are two acts.** This page ends at "Create record",
 * which produces a draft encounter with an unsigned note; signing happens on
 * the record itself, where the note can be read in its final context and
 * where the author check applies. Collapsing them into one button would mean
 * a doctor could attest to a clinical statement without ever seeing it in the
 * record it belongs to.
 *
 * **Nothing is claimed before it lands.** The create mutation is pessimistic,
 * the failure keeps the doctor on the review step with the draft intact, and
 * the success toast names the record it actually made.
 */
/** The id of a record created without its note (`RECORD_NOTE_NOT_SAVED`), else null. */
function partialRecordId(error: Error): string | null {
  if (error.message !== RECORD_NOTE_NOT_SAVED || !('recordId' in error)) return null;
  return typeof error.recordId === 'string' ? error.recordId : null;
}

export function NewMedicalRecordPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const author = profile.fullName || 'Doctor';

  const [searchParams] = useSearchParams();
  const flow = useRecordAuthoring({ initialPatientId: searchParams.get('patient') });

  const saveDraft = useSaveRecordDraftMutation();
  const createRecord = useCreateRecordMutation();

  /* UX §2.3: "Unsaved note navigation triggers a confirm dialog." */
  const blocker = useUnsavedChangesGuard(flow.dirty && !createRecord.isPending);

  /*
   * A navigation that must wait for the guard to stand down: `markClean`
   * lands on the next render, and navigating before it would be blocked.
   */
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  useEffect(() => {
    if (leaveTo !== null && !flow.dirty) navigate(leaveTo);
  }, [leaveTo, flow.dirty, navigate]);

  const { draft, step } = flow;
  const stepMeta = RECORD_STEPS.find((entry) => entry.id === step);

  const { attachesVitals, persistsRecords } = recordService.capabilities;

  /* The allergy banner reads the patient's chart (the directory), never the form. */
  const directory = usePatientDirectoryQuery({ enabled: draft.patient !== null });
  const chartPatient = directory.data?.find((candidate) => candidate.id === draft.patient?.id);
  const allergies = (chartPatient?.allergies ?? []).map((allergen) => ({
    allergen,
    severe: chartPatient?.hasSevereAllergy ?? false,
  }));
  /*
   * An empty list means "no recorded allergies" only when the patient's
   * chart was actually found. A patient missing from the directory (a read
   * still pending, a refetch that dropped them) is unknown, and the review
   * step says so instead of showing nothing.
   */
  const allergiesUnknown = chartPatient === undefined;

  const onSaveDraft = () => {
    saveDraft.mutate(draft, {
      onSuccess: () => {
        flow.markClean();
        toast({
          variant: 'success',
          title: 'Draft saved',
          description:
            'It stays for this browser session — drafts are not persisted, and nothing was transmitted.',
        });
      },
      onError: () =>
        toast({
          variant: 'error',
          title: 'Could not save the draft',
          description: 'Nothing was stored. Your work is still on screen.',
        }),
    });
  };

  const onCreate = () => {
    if (!isDraftComplete(draft)) return;
    createRecord.mutate(
      { draft, authoredBy: author },
      {
        onSuccess: (created) => {
          flow.markClean();
          toast({
            variant: 'success',
            title: `${created.id} created`,
            description: `A draft encounter for ${created.patient.name}. The note is unsigned — sign it on the record.`,
          });
          navigate(routes.doctor.medicalRecord(created.id));
        },
        onError: (error) => {
          const partial = partialRecordId(error);
          if (partial !== null) {
            // The record exists without its note — say so, and go to it,
            // rather than invite a second record by retrying here.
            flow.markClean();
            toast({
              variant: 'error',
              title: `${partial} was created without its note`,
              description: 'The note did not save. Add it from the record.',
            });
            setLeaveTo(routes.doctor.medicalRecord(partial));
            return;
          }
          toast({
            variant: 'error',
            title: 'Could not create the record',
            description: 'Nothing was created. Your draft is unchanged.',
          });
        },
      },
    );
  };

  const back = previousRecordStep(step);
  const forward = nextRecordStep(step);

  return (
    <PageContainer width="xl">
      <PageSections>
        <ContentHeader
          title="New medical record"
          caption="Document an encounter, then sign the note on the record it creates."
          icon={FilePlus2}
          tone="secondary"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: 'Overview', href: routes.doctor.overview },
                { label: 'Medical records', href: routes.doctor.medicalRecords },
                { label: 'New record' },
              ]}
            />
          }
        />

        <RecordStepper
          current={step}
          furthestReached={flow.furthestReached}
          isStepValid={flow.isStepValid}
          isStepReachable={flow.isStepReachable}
          onSelect={flow.goTo}
        />

        <Card title={stepMeta?.label ?? 'Record'} subtitle={stepMeta?.caption} headingAs="h2">
          <Stack gap={5}>
            {createRecord.isError && partialRecordId(createRecord.error) === null ? (
              <Alert variant="error" critical title="The record was not created">
                Nothing was stored. Your draft is exactly as you left it — try again, or save it
                as a draft and come back.
              </Alert>
            ) : null}

            {step === 'patient' ? (
              <RecordPatientStep
                selectedPatientId={draft.patient?.id ?? null}
                onSelect={flow.setPatient}
                showIssues={flow.showIssues}
              />
            ) : null}

            {step === 'visit' ? (
              <RecordVisitStep
                visit={draft.visit}
                narrative={draft}
                onVisitChange={flow.setVisitField}
                onNarrativeChange={flow.setNarrative}
                showIssues={flow.showIssues}
              />
            ) : null}

            {step === 'clinical' ? (
              <RecordClinicalStep
                vitals={draft.vitals}
                diagnoses={draft.diagnoses}
                note={draft.note}
                onVitalChange={flow.setVital}
                onAddDiagnosis={flow.addDiagnosis}
                onRemoveDiagnosis={flow.removeDiagnosis}
                onMakePrimary={flow.makePrimaryDiagnosis}
                onNoteChange={flow.setNoteField}
                showIssues={flow.showIssues}
                attachesVitals={attachesVitals}
              />
            ) : null}

            {step === 'review' && isDraftComplete(draft) ? (
              <RecordReviewStep
                draft={draft}
                allergies={allergies}
                allergiesUnknown={allergiesUnknown}
                attachesVitals={attachesVitals}
                persistsRecords={persistsRecords}
              />
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                {back !== null ? (
                  <Button variant="secondary" onClick={flow.goBack}>
                    Back
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={onSaveDraft}
                  loading={saveDraft.isPending}
                  disabled={createRecord.isPending}
                >
                  Save as draft
                </Button>
                {/*
                  The flow's explicit exit. It goes through the router so the
                  unsaved-changes guard sees it — the breadcrumb above is a
                  plain anchor, which is a full page load and therefore covered
                  by `beforeunload` instead. Two escape routes, two mechanisms.
                */}
                <Button
                  variant="ghost"
                  onClick={() => navigate(routes.doctor.medicalRecords)}
                  disabled={createRecord.isPending}
                >
                  Cancel
                </Button>
              </div>

              {step === 'review' ? (
                <Button
                  onClick={onCreate}
                  loading={createRecord.isPending}
                  disabled={!flow.complete}
                >
                  Create record
                </Button>
              ) : (
                <Button onClick={flow.goNext} disabled={forward === null}>
                  Continue
                </Button>
              )}
            </div>
          </Stack>
        </Card>
      </PageSections>

      <ConfirmationDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving this record?"
        description="The encounter you have started is not saved. Leaving discards it."
        confirmLabel="Discard and leave"
        cancelLabel="Stay here"
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </PageContainer>
  );
}
