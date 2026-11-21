import { Stack } from '@/components/layout';
import { Input, Select, Textarea } from '@/components/ui';

import type { DraftVisit, NarrativeField } from '../../model/authoring';
import { RECORD_DEPARTMENTS, RECORD_VISIT_TYPES } from '../../model/types';

/**
 * Step 2 — Encounter. Date, type, department, the chief complaint in the
 * patient's own terms, and the history and examination findings — the three
 * narrative fields every record carries (API §6.3 requires them all, and a
 * record without an examination is one a reader cannot tell was examined).
 *
 * The date is capped at today: a record documents an encounter that happened,
 * and a future-dated one is either a typo or an appointment, which is a
 * different object in a different module.
 */
export interface RecordVisitStepProps {
  visit: DraftVisit;
  narrative: Readonly<Record<NarrativeField, string>>;
  onVisitChange: (field: 'visitDate' | 'visitType' | 'department', value: string | null) => void;
  onNarrativeChange: (field: NarrativeField, value: string) => void;
  showIssues: boolean;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordVisitStep({
  visit,
  narrative,
  onVisitChange,
  onNarrativeChange,
  showIssues,
}: RecordVisitStepProps) {
  const missing = (field: NarrativeField) => showIssues && narrative[field].trim() === '';
  return (
    <Stack gap={5}>
      <Input
        type="date"
        label="Encounter date"
        required
        max={todayKey()}
        value={visit.visitDate ?? ''}
        onChange={(event) =>
          onVisitChange('visitDate', event.target.value === '' ? null : event.target.value)
        }
        helperText="The day the patient was seen. Future dates are appointments, not records."
        error={showIssues && visit.visitDate === null ? 'Pick the encounter date.' : undefined}
      />

      <Select
        label="Visit type"
        required
        placeholder="Choose a visit type"
        options={RECORD_VISIT_TYPES.map((type) => ({ value: type, label: type }))}
        value={visit.visitType}
        onChange={(value) => onVisitChange('visitType', value)}
        error={showIssues && visit.visitType === null ? 'Choose the visit type.' : undefined}
      />

      <Select
        label="Department"
        required
        placeholder="Choose a department"
        options={RECORD_DEPARTMENTS.map((department) => ({
          value: department,
          label: department,
        }))}
        value={visit.department}
        onChange={(value) => onVisitChange('department', value)}
        error={showIssues && visit.department === null ? 'Choose the department.' : undefined}
      />

      <Textarea
        label="Chief complaint"
        required
        rows={2}
        value={narrative.chiefComplaint}
        onChange={(event) => onNarrativeChange('chiefComplaint', event.target.value)}
        placeholder="e.g. Shortness of breath on exertion for three weeks"
        helperText="What brought the patient in, in their terms."
        error={missing('chiefComplaint') ? 'Record what brought the patient in.' : undefined}
      />

      <Textarea
        label="History of present illness"
        required
        rows={3}
        maxLength={20_000}
        value={narrative.historyOfPresentIllness}
        onChange={(event) => onNarrativeChange('historyOfPresentIllness', event.target.value)}
        placeholder="Onset, course, and what has been tried"
        error={
          missing('historyOfPresentIllness') ? 'Record the history of the complaint.' : undefined
        }
      />

      <Textarea
        label="Physical examination"
        required
        rows={3}
        maxLength={20_000}
        value={narrative.physicalExamination}
        onChange={(event) => onNarrativeChange('physicalExamination', event.target.value)}
        placeholder="Findings on examination"
        error={missing('physicalExamination') ? 'Record the examination findings.' : undefined}
      />
    </Stack>
  );
}
