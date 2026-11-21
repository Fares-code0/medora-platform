import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { emptyDraft, type CompleteRecordDraft } from '../../model/authoring';

import { RecordReviewStep } from './RecordReviewStep';

/**
 * The allergy banner on Review. An empty list is "none recorded" only when
 * the chart was read; when it was not, the step must say so rather than
 * render the same silence as a patient with no allergies.
 */

const DRAFT: CompleteRecordDraft = {
  ...emptyDraft('MR-TEST', '2026-08-01T09:00:00.000Z'),
  patient: {
    id: 'PT-1',
    name: 'Test Patient',
    mrn: 'MRN-1',
    age: 40,
    gender: 'female',
    bloodType: 'O+',
    phone: '+10000000000',
  },
  visit: { visitDate: '2026-08-01', visitType: 'Follow-up', department: 'General Medicine' },
  chiefComplaint: 'Routine review',
  historyOfPresentIllness: 'Stable.',
  physicalExamination: 'Unremarkable.',
  diagnoses: [{ code: 'I10', label: 'Essential hypertension', isPrimary: true }],
  note: { title: 'Note', body: 'Plan unchanged.' },
};

function renderStep(props: { allergies?: { allergen: string; severe: boolean }[]; unknown?: boolean }) {
  return render(
    <RecordReviewStep
      draft={DRAFT}
      allergies={props.allergies ?? []}
      allergiesUnknown={props.unknown ?? false}
      attachesVitals
      persistsRecords
    />,
  );
}

describe('RecordReviewStep allergies', () => {
  it('warns that allergies could not be checked when the chart was not read', () => {
    renderStep({ unknown: true });
    expect(screen.getByText('Allergies could not be checked')).toBeInTheDocument();
    expect(screen.queryByText('Recorded allergies')).not.toBeInTheDocument();
  });

  it('shows nothing for a chart that was read and records no allergies', () => {
    renderStep({});
    expect(screen.queryByText('Allergies could not be checked')).not.toBeInTheDocument();
    expect(screen.queryByText('Recorded allergies')).not.toBeInTheDocument();
  });

  it('shows the recorded allergies when there are some', () => {
    renderStep({ allergies: [{ allergen: 'Penicillin', severe: true }] });
    expect(screen.getByText('Recorded allergies')).toBeInTheDocument();
    expect(screen.queryByText('Allergies could not be checked')).not.toBeInTheDocument();
  });
});
