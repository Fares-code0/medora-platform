import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderBare, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { completeDraft, emptyDraft } from '../../model/authoring';
import { MEDICATION_CATALOGUE } from '../../model/catalogue';

import { MedicationStep } from './MedicationStep';
import { ReviewStep } from './ReviewStep';

/**
 * What the authoring steps say about where their data comes from is read
 * from the adapter in use (FE-10.6): the demo notices appear over the demo
 * formulary and only there, and the live copy claims nothing the mock does.
 */

const VALID = { step: 'medication' as const, issues: [], valid: true };

// The medication step runs D-18's search query, so it needs a client.
const render = (ui: ReactNode) =>
  renderBare(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('MedicationStep wording', () => {
  it('labels the demo formulary as a demo', () => {
    render(
      <MedicationStep
        formulary={MEDICATION_CATALOGUE}
        source="demo-formulary"
        monographs={false}
        genericName={null}
        strength={null}
        onSelectMedication={vi.fn()}
        onSelectStrength={vi.fn()}
        validation={VALID}
        showIssues={false}
      />,
    );
    expect(screen.getByText(/Demo formulary — 5 medications/)).toBeInTheDocument();
  });

  it('does not call the clinic formulary a demo', () => {
    render(
      <MedicationStep
        formulary={MEDICATION_CATALOGUE.slice(0, 2)}
        source="clinical-service"
        monographs
        genericName={null}
        strength={null}
        onSelectMedication={vi.fn()}
        onSelectStrength={vi.fn()}
        validation={VALID}
        showIssues={false}
      />,
    );
    expect(screen.queryByText(/Demo formulary/)).not.toBeInTheDocument();
    expect(screen.getByText(/The clinic formulary — 2 medications/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});

describe('ReviewStep wording', () => {
  const draft = completeDraft(
    {
      ...emptyDraft('draft-1', '2026-10-04T09:00:00.000Z'),
      patient: {
        id: 'PT-1004',
        name: 'Omar Farouk',
        mrn: '4472-90',
        age: 60,
        gender: 'male',
        bloodType: 'AB+',
        phone: '+20 101 662 7408',
        allergies: [],
        hasSevereAllergy: false,
      },
      medication: { genericName: 'Atorvastatin', strength: '20 mg' },
      dosage: {
        frequency: 'Once daily at night',
        durationDays: 30,
        quantity: 30,
        refillsAllowed: 0,
        instructions: 'Take one tablet at night.',
      },
    },
    MEDICATION_CATALOGUE,
  );
  if (draft === null) throw new Error('fixture is not complete');

  const props = {
    draft,
    signability: { signable: null, blockedBy: 'not-checked' } as const,
    onSign: vi.fn(),
    onSaveDraft: vi.fn(),
    signing: false,
    savingDraft: false,
  };

  it('says nothing is transmitted when nothing is', () => {
    render(<ReviewStep {...props} transmits={false} />);
    expect(screen.getByText(/No pharmacy system is connected/)).toBeInTheDocument();
  });

  it('says the server re-screens before issuing when it does', () => {
    render(<ReviewStep {...props} transmits />);
    expect(screen.queryByText(/No pharmacy system is connected/)).not.toBeInTheDocument();
    expect(screen.getByText(/re-runs the safety screen before issuing it/)).toBeInTheDocument();
  });
});
