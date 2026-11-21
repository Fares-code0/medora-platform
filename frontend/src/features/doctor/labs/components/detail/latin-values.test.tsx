import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MOCK_LAB_TESTS } from '@/features/shared-domain/lab-studies';

import { LabResultsSection } from './LabResultsSection';
import { LabSpecimenSection } from './LabSpecimenSection';
import { LabTestInfoCard } from './LabTestInfoCard';

/**
 * A lab value and its unit, and a reference range and its unit, are each one
 * Latin-only run. On an RTL page the bidi algorithm otherwise splits them:
 * "0.5 10³/µL" read "µL/0.510³" and the range "12.0–17.0 g/dL" read
 * "17.0g/dL –12.0" — a range printed backwards (NEW-32, pass 8). jsdom has no
 * bidi layout; what is asserted is the isolation the browser acts on.
 */

const TEST = MOCK_LAB_TESTS.find(
  (test) =>
    test.results.some((result) => result.unit && result.referenceRange.low !== null) &&
    test.specimen !== null &&
    test.completedDate !== null,
);
if (TEST === undefined) throw new Error('no completed lab test with units in the corpus');

describe('lab results in RTL', () => {
  it('pins each value with its unit, and each range with its unit, left-to-right', () => {
    render(<LabResultsSection test={TEST} />);

    for (const result of TEST.results.filter((r) => r.unit && r.referenceRange.low !== null)) {
      const row = screen.getByRole('row', { name: new RegExp(`^${result.analyte}\\b`) });
      const pinned = within(row)
        .getAllByText((_, element) => element?.getAttribute('dir') === 'ltr')
        .map((element) => element.textContent?.replace(/\s+/g, ''));

      // The gap before the unit is a margin, not a space, so compare without one.
      expect(pinned, result.analyte).toContain(`${result.value}${result.unit}`.replace(/\s+/g, ''));
      expect(pinned, result.analyte).toContain(
        `${result.referenceRange.text}${result.unit}`.replace(/\s+/g, ''),
      );
    }
  });

  it('pins the turnaround and the specimen volume left-to-right', () => {
    const { container: info } = render(<LabTestInfoCard test={TEST} />);
    expect(info.querySelector('[dir="ltr"]')?.textContent).toMatch(/^\d+ (h|d)( \d+ h)?$/);

    const { container: specimen } = render(<LabSpecimenSection test={TEST} />);
    expect(specimen.querySelector('[dir="ltr"]')?.textContent).toBe(TEST.specimen?.volume);
  });
});
