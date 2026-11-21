import type { ReactNode } from 'react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Fact, FactGrid, StatusBadge } from '@/components/patterns';
import { Card } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';

import { bmiFor, type CompleteRecordDraft } from '../../model/authoring';
import { RECORD_ALLERGY_SEVERITY_META } from '../../model/types';

/**
 * Step 4 — Review. The whole record as it will be stored, and one honest
 * statement about what happens next.
 *
 * The note is shown **as unsigned**, because that is what creating produces:
 * signing is a separate act on the record itself. Saying "Create record"
 * rather than "Sign & file" is the difference between a button that describes
 * what it does and one that overstates it.
 */
export interface RecordReviewStepProps {
  draft: CompleteRecordDraft;
  /** The patient's recorded allergies, from the roster rather than the form. */
  allergies: readonly { readonly allergen: string; readonly severe: boolean }[];
  /** True when the patient's chart was not found, so an empty list is not "none recorded". */
  allergiesUnknown?: boolean;
  /** Whether vitals entered here are stored with the record (`RecordService.capabilities`). */
  attachesVitals: boolean;
  /** Whether creating sends the record to the records service, or keeps it in this tab. */
  persistsRecords: boolean;
}

/** A field caption on the review cards. */
function ReviewLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p
      className={cn(
        'text-caption font-semibold uppercase tracking-wider text-text-tertiary',
        className,
      )}
    >
      {children}
    </p>
  );
}

export function RecordReviewStep({
  draft,
  allergies,
  allergiesUnknown = false,
  attachesVitals,
  persistsRecords,
}: RecordReviewStepProps) {
  const bmi = bmiFor(draft.vitals);
  const primary = draft.diagnoses.find((diagnosis) => diagnosis.isPrimary) ?? draft.diagnoses[0];
  const hasVitals =
    draft.vitals.bloodPressure.trim() !== '' ||
    Object.values(draft.vitals).some((value) => typeof value === 'number' && value !== null);

  return (
    <Stack gap={5}>
      {allergiesUnknown && allergies.length === 0 ? (
        <Alert variant="warning" title="Allergies could not be checked">
          The patient&apos;s recorded allergies could not be loaded. Check the patient&apos;s
          chart before relying on this record.
        </Alert>
      ) : null}

      {allergies.length > 0 ? (
        <Alert
          variant={allergies.some((entry) => entry.severe) ? 'error' : 'warning'}
          critical={allergies.some((entry) => entry.severe)}
          title="Recorded allergies"
        >
          <div className="flex flex-wrap items-center gap-2">
            {allergies.map((entry) => (
              <StatusBadge
                key={entry.allergen}
                status={
                  RECORD_ALLERGY_SEVERITY_META[entry.severe ? 'severe' : 'moderate'].kind
                }
                label={entry.allergen}
              />
            ))}
          </div>
          <p className="mt-2">
            Carried from the patient&apos;s record, not from this form — this flow does not edit
            an allergy list.
          </p>
        </Alert>
      ) : null}

      <Card title="Encounter" headingAs="h3">
        <FactGrid>
          <Fact label="Patient">
            {draft.patient.name} · MRN {draft.patient.mrn}
          </Fact>
          <Fact label="Date">{formatDate(draft.visit.visitDate)}</Fact>
          <Fact label="Type">{draft.visit.visitType}</Fact>
          <Fact label="Department">{draft.visit.department}</Fact>
        </FactGrid>
        <ReviewLabel className="mt-3">Chief complaint</ReviewLabel>
        <p className="mt-1 text-body-sm text-text-primary">{draft.chiefComplaint}</p>
        <ReviewLabel className="mt-3">History of present illness</ReviewLabel>
        <p className="mt-1 whitespace-pre-wrap text-body-sm text-text-primary">
          {draft.historyOfPresentIllness}
        </p>
        <ReviewLabel className="mt-3">Physical examination</ReviewLabel>
        <p className="mt-1 whitespace-pre-wrap text-body-sm text-text-primary">
          {draft.physicalExamination}
        </p>
      </Card>

      <Card title="Clinical" headingAs="h3">
        <ReviewLabel>Diagnoses</ReviewLabel>
        <ul className="mt-1 flex flex-col gap-1">
          {draft.diagnoses.map((diagnosis) => (
            <li key={diagnosis.code} className="text-body-sm text-text-primary">
              <span className="font-mono">{diagnosis.code}</span> — {diagnosis.label}
              {diagnosis.code === primary?.code ? (
                <span className="ms-2 text-caption text-text-tertiary">primary</span>
              ) : null}
            </li>
          ))}
        </ul>

        {attachesVitals ? (
          <>
            <ReviewLabel className="mt-4">Vitals</ReviewLabel>
            {hasVitals ? (
              <FactGrid className="mt-1">
                {draft.vitals.bloodPressure.trim() !== '' ? (
                  <Fact label="Blood pressure">{draft.vitals.bloodPressure}</Fact>
                ) : null}
                {draft.vitals.heartRateBpm !== null ? (
                  <Fact label="Heart rate">{draft.vitals.heartRateBpm} bpm</Fact>
                ) : null}
                {draft.vitals.temperatureC !== null ? (
                  <Fact label="Temperature">{draft.vitals.temperatureC} °C</Fact>
                ) : null}
                {draft.vitals.respiratoryRate !== null ? (
                  <Fact label="Respiratory rate">{draft.vitals.respiratoryRate} /min</Fact>
                ) : null}
                {draft.vitals.oxygenSaturation !== null ? (
                  <Fact label="Oxygen saturation">{draft.vitals.oxygenSaturation} %</Fact>
                ) : null}
                {draft.vitals.weightKg !== null ? (
                  <Fact label="Weight">{draft.vitals.weightKg} kg</Fact>
                ) : null}
                {draft.vitals.heightCm !== null ? (
                  <Fact label="Height">{draft.vitals.heightCm} cm</Fact>
                ) : null}
                {bmi !== null ? <Fact label="BMI (calculated)">{bmi}</Fact> : null}
              </FactGrid>
            ) : (
              <p className="mt-1 text-body-sm text-text-secondary">
                None recorded for this encounter.
              </p>
            )}
          </>
        ) : null}
      </Card>

      <Card title="Clinical note" headingAs="h3" subtitle={draft.note.title}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status="awaiting" label="Will be created unsigned" />
        </div>
        <p className="mt-3 whitespace-pre-wrap text-body-sm text-text-primary">{draft.note.body}</p>
      </Card>

      <Alert variant="info" title="What happens when you create this record">
        The encounter is created as a <strong>draft</strong> with this note{' '}
        <strong>unsigned</strong>. Signing is a separate act on the record itself, and only you can
        sign your own note.{' '}
        {persistsRecords
          ? 'It is saved to the patient’s chart when you create it.'
          : 'Nothing is transmitted: no records system is connected, so the record lives in this browser session.'}
      </Alert>
    </Stack>
  );
}
