import { Stack } from '@/components/layout';
import { Input, Select, Textarea } from '@/components/ui';

import {
  findMedicationSpec,
  type DraftDosage,
  type StepValidation,
} from '../../model/authoring';
import type { Formulary } from '../../model/catalogue';

/**
 * Step 3 — Dosage & instructions. The strength, schedule and duration
 * vocabularies come from the catalogue entry rather than from free text, so
 * a dosage cannot name a schedule the medication is not offered on.
 * Quantity and instructions are proposed from the schedule and stay
 * editable — a proposal a doctor can overrule, not a value they must accept.
 */

export interface DosageStepProps {
  formulary: Formulary;
  genericName: string | null;
  strength: string | null;
  dosage: DraftDosage;
  onChange: <K extends keyof DraftDosage>(key: K, value: DraftDosage[K]) => void;
  validation: StepValidation;
  showIssues: boolean;
}

function toNumberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function DosageStep({
  formulary,
  genericName,
  strength,
  dosage,
  onChange,
  validation,
  showIssues,
}: DosageStepProps) {
  const spec = genericName === null ? null : findMedicationSpec(genericName, formulary);

  const issueFor = (field: string) =>
    showIssues ? validation.issues.find((entry) => entry.field === field)?.message : undefined;

  return (
    <Stack gap={4}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Dose" value={strength ?? ''} readOnly helperText="Set on the medication step." />
        <Input
          label="Route"
          value={spec?.route ?? ''}
          readOnly
          helperText="Determined by the medication's form."
        />
      </div>

      <Select
        label="Frequency"
        required
        value={dosage.frequency}
        placeholder="How often…"
        onChange={(value) => onChange('frequency', value)}
        error={issueFor('frequency')}
        options={(spec?.frequencies ?? []).map((value) => ({ value, label: value }))}
        helperText={
          spec === null ? 'Choose a medication first.' : `Schedules listed for ${spec.name}.`
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          label="Duration (days)"
          required
          value={dosage.durationDays === null ? '' : String(dosage.durationDays)}
          onChange={(event) => onChange('durationDays', toNumberOrNull(event.target.value))}
          error={issueFor('durationDays')}
        />
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          label="Quantity"
          required
          value={dosage.quantity === null ? '' : String(dosage.quantity)}
          onChange={(event) => onChange('quantity', toNumberOrNull(event.target.value))}
          error={issueFor('quantity')}
          helperText="Proposed from the schedule; override as needed."
        />
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={11}
          label="Refills"
          value={String(dosage.refillsAllowed)}
          onChange={(event) => onChange('refillsAllowed', toNumberOrNull(event.target.value) ?? 0)}
          error={issueFor('refillsAllowed')}
          disabled={spec?.isControlled === true}
          helperText={
            spec?.isControlled === true ? 'Controlled — no refills permitted.' : '0–11 refills.'
          }
        />
      </div>

      <Textarea
        label="Instructions for the patient"
        required
        rows={3}
        value={dosage.instructions}
        onChange={(event) => onChange('instructions', event.target.value)}
        error={issueFor('instructions')}
        placeholder="Plain language — what to take, when, and anything to avoid."
        helperText="Written in plain language; printed on the prescription."
      />
    </Stack>
  );
}
