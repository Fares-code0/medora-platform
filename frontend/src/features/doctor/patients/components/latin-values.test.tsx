import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { PATIENT_COLUMNS } from './patient-table-columns';

/**
 * A blood group ends in a sign and a phone number starts with one, so on an
 * RTL page the bidi algorithm reorders both: "O+" reads "+O", and
 * "+20 100 214 3387" reads "3387 214 100 20+". Each value is pinned
 * left-to-right (`docs/handoff/i18n.md` §5). jsdom has no bidi layout; what
 * is asserted is the isolation the browser acts on.
 */

const PATIENT = MOCK_PATIENTS[0];
if (PATIENT === undefined) throw new Error('roster is empty');

function renderCell(id: string) {
  const column = PATIENT_COLUMNS.find((c) => c.id === id);
  if (column === undefined) throw new Error(`no ${id} column`);
  return render(<>{column.cell(PATIENT!)}</>).container;
}

describe('patients table — Latin-only values in RTL', () => {
  it('pins the blood group left-to-right', () => {
    expect(renderCell('bloodType').querySelector('[dir="ltr"]')?.textContent).toBe(
      PATIENT.bloodType,
    );
  });

  it('pins the phone number left-to-right', () => {
    expect(renderCell('phone').querySelector('[dir="ltr"]')?.textContent).toBe(PATIENT.phone);
  });
});
