import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { toLabTest } from '../../http/http-lab-service';

import { LabAnnotationsSection } from './LabAnnotationsSection';
import { LabReviewSection } from './LabReviewSection';

/**
 * What the detail sections say when the laboratory API is the source
 * (FE-10.7): no annotation store means no "Add note" and no claim of "no
 * notes", and a review whose acknowledgment the server does not echo is
 * still reported truthfully.
 */

const TEST = toLabTest({
  id: 'LAB-100000',
  patient: {
    id: 'PT-1004',
    name: 'Omar Farouk',
    mrn: '4472-90',
    age: 60,
    gender: 'male',
    bloodType: 'AB+',
    phone: '+20 101 662 7408',
  },
  testName: 'Complete Blood Count (CBC)',
  testCode: '58410-2',
  category: 'Hematology',
  department: 'Internal Medicine',
  orderedBy: 'Dr. Amelia Chen',
  clinicalIndication: 'Fatigue',
  status: 'completed',
  priority: 'urgent',
  requestedDate: '2026-10-04T18:11:25.552Z',
  collectedDate: null,
  completedDate: '2026-10-04T18:11:35.906Z',
  hasCriticalResult: true,
  review: { reviewedAt: '2026-10-04T19:00:00.000Z', reviewedBy: 'Dr. Amelia Chen' },
  createdAt: '2026-10-04T18:11:25.552Z',
  updatedAt: '2026-10-04T19:00:00.000Z',
  specimen: null,
  results: [
    {
      id: 'r-1',
      analyte: 'Hemoglobin',
      value: '6.4',
      numericValue: 6.4,
      unit: 'g/dL',
      referenceRange: { low: 12, high: 17, text: '12.0–17.0' },
      flag: 'critical-low',
    },
  ],
  interpretation: null,
  attachments: [],
  timeline: [],
});

describe('LabAnnotationsSection', () => {
  it('offers no note and claims no absence when the service keeps none', () => {
    render(<LabAnnotationsSection test={TEST} onAnnotate={null} />);
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No notes on this result yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/not available from the laboratory service yet/)).toBeInTheDocument();
  });

  it('offers a note where the service keeps them', () => {
    render(<LabAnnotationsSection test={TEST} onAnnotate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
  });
});

describe('LabReviewSection', () => {
  it('reports every critical value acknowledged when the server holds the review but not the ticks', () => {
    render(
      <AppProviders>
        <LabReviewSection test={TEST} onAttach={undefined} />
      </AppProviders>,
    );
    expect(screen.getByText('All 1')).toBeInTheDocument();
    expect(screen.queryByText('What was done')).not.toBeInTheDocument();
  });
});
