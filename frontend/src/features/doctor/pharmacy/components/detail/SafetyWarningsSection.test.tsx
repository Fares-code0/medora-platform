import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MOCK_PRESCRIPTIONS } from '@/features/shared-domain/prescriptions/mock-data';

import type { Prescription, SafetyWarning } from '../../model/types';

import { SafetyWarningsSection } from './SafetyWarningsSection';

/**
 * NEW-35. The prescription detail's safety checks — the server's warnings
 * (`http-prescription-service.ts` reads them as sent) — had no test: 13.8 %
 * of the section's lines ran. What is pinned is what DS §8.22 requires of a
 * clinical alert on this screen: a critical warning is announced and can
 * never be dismissed, every warning says what kind of check raised it, and
 * "no warnings" is said only when the list is genuinely empty.
 */

const BASE = MOCK_PRESCRIPTIONS[0] as Prescription;

function withWarnings(warnings: readonly SafetyWarning[]): Prescription {
  return { ...BASE, warnings };
}

describe('SafetyWarningsSection', () => {
  it('says no warnings were raised only when the list is empty', () => {
    render(<SafetyWarningsSection prescription={withWarnings([])} />);

    expect(
      screen.getByText('No safety warnings were raised for this prescription.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces a critical warning, names its check, and offers no way to dismiss it', () => {
    render(
      <SafetyWarningsSection
        prescription={withWarnings([
          {
            id: 'w-1',
            kind: 'allergy',
            severity: 'critical',
            title: 'Penicillin allergy on record',
            detail: 'Amoxicillin is a penicillin.',
          },
        ])}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Penicillin allergy on record');
    expect(alert).toHaveTextContent('Allergy conflict. Amoxicillin is a penicillin.');
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No safety warnings were raised for this prescription.'),
    ).not.toBeInTheDocument();
  });

  it('renders every warning, in the order the server sent them, at its own severity', () => {
    render(
      <SafetyWarningsSection
        prescription={withWarnings([
          {
            id: 'w-1',
            kind: 'interaction',
            severity: 'warning',
            title: 'Interaction with warfarin',
            detail: 'Raises INR.',
          },
          {
            id: 'w-2',
            kind: 'dosage',
            severity: 'info',
            title: 'Renal dose check',
            detail: 'Review eGFR.',
          },
        ])}
      />,
    );

    // Warning and error variants are alerts; info is a status, not an interruption.
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Drug interaction. Raises INR.');
    expect(screen.getByRole('status')).toHaveTextContent('Dosage alert. Review eGFR.');

    const titles = screen.getAllByText(/Interaction with warfarin|Renal dose check/);
    expect(titles.map((node) => node.textContent)).toEqual([
      'Interaction with warfarin',
      'Renal dose check',
    ]);
  });
});
