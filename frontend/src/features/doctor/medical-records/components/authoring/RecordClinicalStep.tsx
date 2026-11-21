import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { RichTextField } from '@/components/patterns';
import { Button, Input, Select } from '@/components/ui';

import {
  VITALS_BOUNDS,
  bmiFor,
  implausibleVitals,
  isValidBloodPressure,
  type DraftNote,
  type DraftVitals,
  type VitalsField,
} from '../../model/authoring';
import { DIAGNOSES, type RecordDiagnosis } from '../../model/types';

/**
 * Step 3 — Clinical. Vitals, diagnoses, and the note itself.
 *
 * **Vitals are optional; implausible vitals are not.** A telemedicine
 * follow-up may legitimately record none, so nothing here is required — but a
 * value outside `VITALS_BOUNDS` is a typo rather than an observation, and the
 * step refuses to advance while one stands. The bounds are wide on purpose:
 * they catch 720 bpm and a temperature entered in Fahrenheit, and they let a
 * genuinely alarming reading through without comment, because reading it is
 * the doctor's job and not the form's.
 *
 * **BMI is displayed, never entered.** It is derived from the height and
 * weight beside it, so the two can never disagree.
 */
export interface RecordClinicalStepProps {
  vitals: DraftVitals;
  diagnoses: readonly RecordDiagnosis[];
  note: DraftNote;
  onVitalChange: <K extends keyof DraftVitals>(field: K, value: DraftVitals[K]) => void;
  onAddDiagnosis: (code: string) => void;
  onRemoveDiagnosis: (code: string) => void;
  onMakePrimary: (code: string) => void;
  onNoteChange: (field: 'title' | 'body', value: string) => void;
  showIssues: boolean;
  /**
   * Whether vitals entered here are stored with the record. When they are
   * not (`RecordService.capabilities.attachesVitals`), the fields are not
   * offered at all — a form that accepted readings and then dropped them
   * would leave the doctor believing they were charted.
   */
  attachesVitals: boolean;
}

/** '' → null, so an emptied field is "not recorded" rather than zero. */
function toNumberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function RecordClinicalStep({
  vitals,
  diagnoses,
  note,
  onVitalChange,
  onAddDiagnosis,
  onRemoveDiagnosis,
  onMakePrimary,
  onNoteChange,
  showIssues,
  attachesVitals,
}: RecordClinicalStepProps) {
  const implausible = implausibleVitals(vitals);
  const bmi = bmiFor(vitals);
  const bloodPressureInvalid =
    vitals.bloodPressure.trim() !== '' && !isValidBloodPressure(vitals.bloodPressure);

  const numericFields = Object.keys(VITALS_BOUNDS) as readonly VitalsField[];
  const unusedDiagnoses = DIAGNOSES.filter(
    (concept) => !diagnoses.some((entry) => entry.code === concept.code),
  );

  return (
    <Stack gap={6}>
      {attachesVitals ? null : (
        <Alert variant="info" title="Vitals are not part of this form yet">
          The records service does not attach vital signs to a record, so none are collected
          here. Readings taken at this visit belong on the patient&apos;s chart.
        </Alert>
      )}
      <section hidden={!attachesVitals}>
        <h3 className="text-body-sm font-semibold text-text-primary">Vitals</h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          Optional — leave anything that was not measured blank. BMI is calculated.
        </p>

        {implausible.length > 0 ? (
          <Alert
            variant="warning"
            className="mt-3"
            title={`Check ${String(implausible.length)} value${implausible.length === 1 ? '' : 's'}`}
          >
            {implausible
              .map((field) => {
                const bounds = VITALS_BOUNDS[field];
                return `${bounds.label} should be between ${String(bounds.min)} and ${String(bounds.max)} ${bounds.unit}`;
              })
              .join('; ')}
            . These bounds catch typing slips, not abnormal results.
          </Alert>
        ) : null}

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Blood pressure"
            placeholder="120/80"
            value={vitals.bloodPressure}
            onChange={(event) => onVitalChange('bloodPressure', event.target.value)}
            error={bloodPressureInvalid ? 'Enter it as systolic/diastolic, e.g. 120/80.' : undefined}
          />
          {numericFields.map((field) => {
            const bounds = VITALS_BOUNDS[field];
            return (
              <Input
                key={field}
                type="number"
                label={`${bounds.label} (${bounds.unit})`}
                value={vitals[field] === null ? '' : String(vitals[field])}
                onChange={(event) => onVitalChange(field, toNumberOrNull(event.target.value))}
                error={
                  implausible.includes(field)
                    ? `Between ${String(bounds.min)} and ${String(bounds.max)}.`
                    : undefined
                }
              />
            );
          })}
        </div>

        <p className="mt-3 text-body-sm text-text-secondary">
          BMI:{' '}
          {bmi === null ? (
            <span className="text-text-secondary">needs height and weight</span>
          ) : (
            <span className="font-medium tabular-nums text-text-primary">{bmi}</span>
          )}
        </p>
      </section>

      <section>
        <h3 className="text-body-sm font-semibold text-text-primary">Diagnoses</h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          The first one added is primary; choose a different one to promote it.
        </p>

        {diagnoses.length === 0 ? (
          <p
            className={
              showIssues
                ? 'mt-3 text-body-sm text-error'
                : 'mt-3 text-body-sm text-text-secondary'
            }
          >
            {showIssues
              ? 'Add at least one diagnosis before continuing.'
              : 'None added yet.'}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {diagnoses.map((diagnosis) => (
              <li
                key={diagnosis.code}
                className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-body-sm text-text-primary">
                    <span className="font-mono">{diagnosis.code}</span> — {diagnosis.label}
                  </p>
                  <p className="text-caption text-text-secondary">
                    {diagnosis.isPrimary ? 'Primary diagnosis' : 'Secondary'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {diagnosis.isPrimary ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onMakePrimary(diagnosis.code)}
                    >
                      Make primary
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveDiagnosis(diagnosis.code)}
                    aria-label={`Remove ${diagnosis.label}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {unusedDiagnoses.length > 0 ? (
          <div className="mt-3">
            <Select
              label="Add a diagnosis"
              placeholder="Search the ICD-10 shortlist"
              options={unusedDiagnoses.map((concept) => ({
                value: concept.code,
                label: `${concept.code} — ${concept.label}`,
              }))}
              value={null}
              onChange={onAddDiagnosis}
              containerClassName="sm:max-w-md"
              helperText="The demo vocabulary is a fourteen-item shortlist, not a full ICD-10 index."
            />
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="text-body-sm font-semibold text-text-primary">Clinical note</h3>
        <p className="mt-0.5 text-caption text-text-secondary">
          Markdown, previewable. It arrives unsigned and is signed on the record itself.
        </p>
        <Stack gap={4} className="mt-3">
          <Input
            label="Note title"
            required
            value={note.title}
            onChange={(event) => onNoteChange('title', event.target.value)}
            placeholder="e.g. Cardiology follow-up"
            error={showIssues && note.title.trim() === '' ? 'Give the note a title.' : undefined}
          />
          <RichTextField
            label="Note"
            required
            rows={8}
            value={note.body}
            onChange={(next: string) => onNoteChange('body', next)}
            placeholder="Assessment and plan…"
            error={showIssues && note.body.trim() === '' ? 'A note needs content.' : undefined}
          />
        </Stack>
      </section>
    </Stack>
  );
}
