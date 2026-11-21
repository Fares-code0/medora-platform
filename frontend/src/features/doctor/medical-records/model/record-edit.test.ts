import { describe, expect, it } from 'vitest';

import { MOCK_MEDICAL_RECORDS } from './mock-data';
import {
  canAddPlanStep,
  editChangesOf,
  editFormOf,
  editIssuesOf,
  hasEditIssues,
  newPlanStep,
  withPlanStepAdded,
  withPlanStepMoved,
  withPlanStepRemoved,
  withPlanStepText,
  type RecordEditForm,
} from './record-edit';
import { RECORD_PLAN_STEP_MAX, RECORD_PLAN_STEPS_MAX } from './record-service';
import type { MedicalRecord } from './types';

function record(overrides: Partial<MedicalRecord> = {}): MedicalRecord {
  const base = MOCK_MEDICAL_RECORDS[0];
  if (base === undefined) throw new Error('fixture has no records');
  return {
    ...base,
    visitDate: '2026-10-04T00:00:00',
    followUpDate: null,
    treatmentPlan: ['Start lisinopril 10 mg daily', 'Recheck blood pressure in 2 weeks'],
    ...overrides,
  };
}

const texts = (form: RecordEditForm) => form.treatmentPlan.map((step) => step.text);

describe('editFormOf', () => {
  it('holds the plan as steps with distinct ids, and days as the date input does', () => {
    const form = editFormOf(record({ followUpDate: '2026-10-18T00:00:00' }));
    expect(texts(form)).toEqual([
      'Start lisinopril 10 mg daily',
      'Recheck blood pressure in 2 weeks',
    ]);
    expect(new Set(form.treatmentPlan.map((step) => step.id)).size).toBe(2);
    expect(form.visitDate).toBe('2026-10-04');
    expect(form.followUpDate).toBe('2026-10-18');
  });

  it('holds no follow-up as an empty field', () => {
    expect(editFormOf(record()).followUpDate).toBe('');
  });
});

describe('editChangesOf', () => {
  it('sends nothing when nothing changed, and never an unchanged plan', () => {
    const original = editFormOf(record());
    // Fresh ids, same text: the plan is unchanged.
    expect(editChangesOf(original, editFormOf(record()))).toEqual({});
  });

  it('sends the whole plan, trimmed, when a step is reworded', () => {
    const original = editFormOf(record());
    const first = original.treatmentPlan[0];
    if (first === undefined) throw new Error('no step');
    const form = {
      ...original,
      treatmentPlan: withPlanStepText(
        original.treatmentPlan,
        first.id,
        '  Start lisinopril 20 mg daily ',
      ),
    };
    expect(editChangesOf(original, form)).toEqual({
      treatmentPlan: ['Start lisinopril 20 mg daily', 'Recheck blood pressure in 2 weeks'],
    });
  });

  it('treats a reorder as a change — the order is the plan', () => {
    const original = editFormOf(record());
    const first = original.treatmentPlan[0];
    if (first === undefined) throw new Error('no step');
    const form = {
      ...original,
      treatmentPlan: withPlanStepMoved(original.treatmentPlan, first.id, 'down'),
    };
    expect(editChangesOf(original, form)).toEqual({
      treatmentPlan: ['Recheck blood pressure in 2 weeks', 'Start lisinopril 10 mg daily'],
    });
  });

  it('ignores whitespace-only rewording of a step', () => {
    const original = editFormOf(record());
    const first = original.treatmentPlan[0];
    if (first === undefined) throw new Error('no step');
    const form = {
      ...original,
      treatmentPlan: withPlanStepText(
        original.treatmentPlan,
        first.id,
        ' Start lisinopril 10 mg daily  ',
      ),
    };
    expect(editChangesOf(original, form)).toEqual({});
  });

  it('sends a new follow-up as a day, and a cleared one as null', () => {
    const none = editFormOf(record());
    expect(editChangesOf(none, { ...none, followUpDate: '2026-11-01' })).toEqual({
      followUpDate: '2026-11-01',
    });
    const set = editFormOf(record({ followUpDate: '2026-10-18T00:00:00' }));
    expect(editChangesOf(set, { ...set, followUpDate: '' })).toEqual({ followUpDate: null });
  });

  it('never carries a department — the server keeps the one the record was created with', () => {
    const original = editFormOf(record());
    expect('department' in original).toBe(false);
    const visitType = original.visitType === 'Procedure' ? 'Telemedicine' : 'Procedure';
    expect(Object.keys(editChangesOf(original, { ...original, visitType }))).toEqual(['visitType']);
  });
});

describe('editIssuesOf', () => {
  it('accepts the record as loaded', () => {
    expect(hasEditIssues(editIssuesOf(editFormOf(record()), ''))).toBe(false);
  });

  it('names a blank step and an over-long one by step', () => {
    const original = editFormOf(record());
    const blank = newPlanStep('   ');
    const long = newPlanStep('x'.repeat(RECORD_PLAN_STEP_MAX + 1));
    const issues = editIssuesOf({ ...original, treatmentPlan: [blank, long] }, '');
    expect(issues.treatmentPlan).toEqual({
      [blank.id]: 'Write the step, or remove it',
      [long.id]: `Keep each step to ${String(RECORD_PLAN_STEP_MAX)} characters`,
    });
    expect(hasEditIssues(issues)).toBe(true);
  });

  it('refuses a follow-up before the visit, and accepts one on the visit day', () => {
    const original = editFormOf(record());
    expect(editIssuesOf({ ...original, followUpDate: '2026-10-03' }, '').followUpDate).toBe(
      'The follow-up cannot be before the visit',
    );
    expect(
      editIssuesOf({ ...original, followUpDate: '2026-10-04' }, '').followUpDate,
    ).toBeUndefined();
  });
});

describe('the plan’s steps', () => {
  it('adds an empty step, up to the server’s ceiling', () => {
    const one = withPlanStepAdded([]);
    expect(one).toHaveLength(1);
    expect(one[0]?.text).toBe('');

    const full = Array.from({ length: RECORD_PLAN_STEPS_MAX }, () => newPlanStep('a'));
    expect(canAddPlanStep(full)).toBe(false);
    expect(withPlanStepAdded(full)).toBe(full);
  });

  it('leaves a step at either end where it is', () => {
    const steps = [newPlanStep('a'), newPlanStep('b')];
    const [a, b] = steps;
    if (a === undefined || b === undefined) throw new Error('no steps');
    expect(withPlanStepMoved(steps, a.id, 'up')).toBe(steps);
    expect(withPlanStepMoved(steps, b.id, 'down')).toBe(steps);
    expect(withPlanStepMoved(steps, b.id, 'up').map((step) => step.text)).toEqual(['b', 'a']);
  });

  it('removes only the step named', () => {
    const steps = [newPlanStep('a'), newPlanStep('a')];
    const [first] = steps;
    if (first === undefined) throw new Error('no steps');
    expect(withPlanStepRemoved(steps, first.id)).toEqual([steps[1]]);
  });
});
