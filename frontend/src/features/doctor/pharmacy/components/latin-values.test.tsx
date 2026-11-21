import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MOCK_PRESCRIPTIONS } from '../model/mock-data';

import { DosageSection } from './detail/DosageSection';
import { MedicationDetailsSection } from './detail/MedicationDetailsSection';
import { PrescriptionPatientCell } from './PharmacyCells';
import { buildPrescriptionColumns } from './prescription-table-columns';

/**
 * A dose or a duration is a Latin-only run that starts with a digit. On an
 * RTL page the bidi algorithm puts its unit first — "mg 250", "days 7" — so
 * the cell pins it left-to-right (`docs/handoff/i18n.md` §5). jsdom has no
 * bidi layout; what is asserted is the isolation the browser acts on.
 */

const RX = MOCK_PRESCRIPTIONS[0];
if (RX === undefined) throw new Error('prescription seed is empty');

function renderCell(id: string) {
  const column = buildPrescriptionColumns({ onOpen: vi.fn() }).find((c) => c.id === id);
  if (column === undefined) throw new Error(`no ${id} column`);
  return render(<>{column.cell(RX!)}</>).container;
}

describe('prescription table — Latin-only values in RTL', () => {
  it.each(['dosage', 'duration'])('pins the %s cell left-to-right', (id) => {
    const container = renderCell(id);
    const value = id === 'dosage' ? RX.dosage : RX.duration;

    const pinned = container.querySelector('[dir="ltr"]');
    expect(pinned?.textContent).toBe(value);
  });
});

describe('prescription detail and list — Latin-only values in RTL (pass 8)', () => {
  function pinnedTexts(container: HTMLElement): string[] {
    return [...container.querySelectorAll('[dir="ltr"]')].map(
      (element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  it('pins the strength, the dosage and the duration on the detail page', () => {
    const { container: medication } = render(<MedicationDetailsSection prescription={RX} />);
    expect(pinnedTexts(medication)).toContain(RX.medication.strength);

    const { container: dosage } = render(<DosageSection prescription={RX} />);
    expect(pinnedTexts(dosage)).toEqual(expect.arrayContaining([RX.dosage, RX.duration]));
  });

  it('pins the age · sex line in the patient cell', () => {
    const { container } = render(<PrescriptionPatientCell prescription={RX} />);
    expect(pinnedTexts(container)).toContain(
      `${String(RX.patient.age)} · ${RX.patient.gender === 'female' ? 'F' : 'M'}`,
    );
  });
});
