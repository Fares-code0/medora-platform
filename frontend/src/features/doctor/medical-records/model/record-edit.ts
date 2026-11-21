import {
  RECORD_EDIT_REASON_MAX,
  RECORD_PLAN_STEP_MAX,
  RECORD_PLAN_STEPS_MAX,
  type RecordEditableFields,
} from './record-service';
import type { MedicalRecord } from './types';

/**
 * The edit form of a draft record (DEC-004) — what it holds, what it sends,
 * and what it refuses — kept apart from the dialog so each rule is tested on
 * its own.
 *
 * **Department is not here.** `PATCH /medical-records/:id` accepts it and
 * applies nothing (the service's update writes no department), so offering it
 * would report a change the record never received.
 *
 * **Medications and allergies are not here either**, though the route takes
 * both. A record's allergies come from the patient's chart, which the allergy
 * banner reads; a second, hand-typed copy could disagree with it. Medications
 * are prescribed through the pharmacy flow, whose safety check a free-text
 * list here would bypass.
 */

/** One step of the plan as the form edits it; the id keeps focus on a step that moves. */
export interface PlanStepDraft {
  readonly id: string;
  readonly text: string;
}

export interface RecordEditForm {
  readonly visitDate: string;
  readonly visitType: string;
  readonly chiefComplaint: string;
  readonly historyOfPresentIllness: string;
  readonly physicalExamination: string;
  readonly diagnoses: RecordEditableFields['diagnoses'];
  readonly treatmentPlan: readonly PlanStepDraft[];
  /** `''` when no follow-up is set. */
  readonly followUpDate: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A day as a date input holds it, in local time — the record reads its days as local. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

let stepSequence = 0;

/** A new, empty step with an id no other step in this tab holds. */
export function newPlanStep(text = ''): PlanStepDraft {
  stepSequence += 1;
  return { id: `step-${String(stepSequence)}`, text };
}

export function editFormOf(record: MedicalRecord): RecordEditForm {
  return {
    visitDate: dayKey(record.visitDate),
    visitType: record.visitType,
    chiefComplaint: record.chiefComplaint,
    historyOfPresentIllness: record.historyOfPresentIllness,
    physicalExamination: record.physicalExamination,
    diagnoses: record.diagnoses,
    treatmentPlan: record.treatmentPlan.map((text) => newPlanStep(text)),
    followUpDate: record.followUpDate === null ? '' : dayKey(record.followUpDate),
  };
}

const planTexts = (steps: readonly PlanStepDraft[]) => steps.map((step) => step.text.trim());

const sameDiagnoses = (a: RecordEditForm['diagnoses'], b: RecordEditForm['diagnoses']) =>
  a.length === b.length &&
  a.every(
    (entry, index) => entry.code === b[index]?.code && entry.isPrimary === b[index]?.isPrimary,
  );

const sameStrings = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/**
 * What differs from the record as loaded — and only that. The server writes a
 * version row naming every list it is sent, changed or not, so an unchanged
 * plan is never sent.
 */
export function editChangesOf(
  original: RecordEditForm,
  form: RecordEditForm,
): Partial<RecordEditableFields> {
  const changes: { -readonly [K in keyof RecordEditableFields]?: RecordEditableFields[K] } = {};
  for (const field of [
    'visitDate',
    'visitType',
    'chiefComplaint',
    'historyOfPresentIllness',
    'physicalExamination',
  ] as const) {
    if (form[field].trim() !== original[field].trim()) changes[field] = form[field];
  }
  if (!sameDiagnoses(original.diagnoses, form.diagnoses)) changes.diagnoses = form.diagnoses;
  const plan = planTexts(form.treatmentPlan);
  if (!sameStrings(planTexts(original.treatmentPlan), plan)) changes.treatmentPlan = plan;
  if (form.followUpDate !== original.followUpDate) {
    changes.followUpDate = form.followUpDate === '' ? null : form.followUpDate;
  }
  return changes;
}

export interface RecordEditIssues {
  readonly reason?: string | undefined;
  readonly visitDate?: string | undefined;
  readonly chiefComplaint?: string | undefined;
  readonly historyOfPresentIllness?: string | undefined;
  readonly physicalExamination?: string | undefined;
  readonly followUpDate?: string | undefined;
  /** By step id. */
  readonly treatmentPlan: Readonly<Record<string, string>>;
}

const narrativeIssue = (value: string) =>
  value.trim() === '' ? 'Required — the record cannot be left without it' : undefined;

/** Every rule the server would refuse, plus one it would not: a follow-up before the visit. */
export function editIssuesOf(form: RecordEditForm, reason: string): RecordEditIssues {
  const plan: Record<string, string> = {};
  for (const step of form.treatmentPlan) {
    const text = step.text.trim();
    if (text === '') plan[step.id] = 'Write the step, or remove it';
    else if (text.length > RECORD_PLAN_STEP_MAX) {
      plan[step.id] = `Keep each step to ${String(RECORD_PLAN_STEP_MAX)} characters`;
    }
  }
  return {
    reason:
      reason.trim().length > RECORD_EDIT_REASON_MAX
        ? `Keep it to ${String(RECORD_EDIT_REASON_MAX)} characters`
        : undefined,
    visitDate: form.visitDate === '' ? 'Enter the visit date' : undefined,
    chiefComplaint: narrativeIssue(form.chiefComplaint),
    historyOfPresentIllness: narrativeIssue(form.historyOfPresentIllness),
    physicalExamination: narrativeIssue(form.physicalExamination),
    // Both are `YYYY-MM-DD`, so the string order is the calendar order.
    followUpDate:
      form.followUpDate !== '' && form.visitDate !== '' && form.followUpDate < form.visitDate
        ? 'The follow-up cannot be before the visit'
        : undefined,
    treatmentPlan: plan,
  };
}

export function hasEditIssues(issues: RecordEditIssues): boolean {
  const { treatmentPlan, ...fields } = issues;
  return (
    Object.values(fields).some((issue) => issue !== undefined) ||
    Object.keys(treatmentPlan).length > 0
  );
}

/* ── The plan's steps ───────────────────────────────────────────── */

export function canAddPlanStep(steps: readonly PlanStepDraft[]): boolean {
  return steps.length < RECORD_PLAN_STEPS_MAX;
}

export function withPlanStepAdded(steps: readonly PlanStepDraft[]): readonly PlanStepDraft[] {
  return canAddPlanStep(steps) ? [...steps, newPlanStep()] : steps;
}

export function withPlanStepText(
  steps: readonly PlanStepDraft[],
  id: string,
  text: string,
): readonly PlanStepDraft[] {
  return steps.map((step) => (step.id === id ? { ...step, text } : step));
}

export function withPlanStepRemoved(
  steps: readonly PlanStepDraft[],
  id: string,
): readonly PlanStepDraft[] {
  return steps.filter((step) => step.id !== id);
}

/** Swaps a step with its neighbour; a step already at that end stays put. */
export function withPlanStepMoved(
  steps: readonly PlanStepDraft[],
  id: string,
  direction: 'up' | 'down',
): readonly PlanStepDraft[] {
  const from = steps.findIndex((step) => step.id === id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  [next[from], next[to]] = [next[to] as PlanStepDraft, next[from] as PlanStepDraft];
  return next;
}
