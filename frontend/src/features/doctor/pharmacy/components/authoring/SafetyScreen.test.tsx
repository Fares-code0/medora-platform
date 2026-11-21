import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SafetyVerdict } from '../../model/safety-check';

import { SafetyScreen } from './SafetyScreen';

/**
 * Whose record the safety screen checked (WEB-8, DR-03/DR-04).
 *
 * A patient has one Medical Record per hospital. A clean screen is a claim
 * about this hospital's record only, and the screen has to say so — before
 * the check runs and again on the "no warnings" result, which is the
 * sentence a prescriber acts on.
 */

const CLEAN: SafetyVerdict = {
  status: 'completed',
  id: 'verdict-1',
  subjectKey: 'PT-1001|amoxicillin',
  checkedAt: '2026-10-26T09:00:00.000Z',
  source: 'clinical-service',
  warnings: [],
};

function renderScreen(verdict: SafetyVerdict | null, phase: 'idle' | 'settled') {
  render(
    <SafetyScreen
      phase={phase}
      verdict={verdict}
      acknowledgedIds={[]}
      acknowledgmentReason=""
      onToggleAcknowledged={vi.fn()}
      onReasonChange={vi.fn()}
      onRetry={vi.fn()}
      onSaveDraft={vi.fn()}
      onChangeMedication={vi.fn()}
      savingDraft={false}
    />,
  );
}

describe('SafetyScreen provenance', () => {
  it('names this hospital’s record as what it screens against', () => {
    renderScreen(null, 'idle');

    expect(screen.getByText(/screened against this hospital's record/i)).toBeInTheDocument();
  });

  it('scopes a clean result to this hospital’s record', () => {
    renderScreen(CLEAN, 'settled');

    expect(screen.getByText('No safety warnings')).toBeInTheDocument();
    expect(
      screen.getByText(/active medications in this hospital's record of the patient/i),
    ).toBeInTheDocument();
  });
});
