import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { buildPatientProfile } from '../../model/profile-mock-data';
import type { PatientProfile } from '../../model/profile-types';

import { OverviewTab } from './OverviewTab';

/**
 * The Overview with a chart the server holds little of (FE-10.2).
 *
 * A live chart can have no vitals taken, no emergency contact, no insurance
 * record and no written summary. Each must read as "not on file" — never as
 * a crash, and never as a plausible-looking value nobody recorded.
 */

const PATIENT = MOCK_PATIENTS[0];
if (PATIENT === undefined) throw new Error('roster is empty');

const SPARSE: PatientProfile = {
  ...buildPatientProfile(PATIENT),
  summary: '',
  vitals: null,
  emergencyContacts: [],
  insurance: null,
  appointments: [],
};

describe('OverviewTab on a sparse chart', () => {
  it('says what is not on file instead of showing a value', () => {
    render(
      <OverviewTab bundle={{ patient: PATIENT, profile: SPARSE }} onViewMedications={vi.fn()} />,
    );

    expect(screen.getByText('No vital signs recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('No emergency contact on file.')).toBeInTheDocument();
    expect(screen.getByText('No insurance details on file.')).toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled.')).toBeInTheDocument();
  });

  it('omits the summary card rather than rendering an empty one', () => {
    render(
      <OverviewTab bundle={{ patient: PATIENT, profile: SPARSE }} onViewMedications={vi.fn()} />,
    );

    expect(screen.queryByText('Patient summary')).not.toBeInTheDocument();
  });

  it('shows a BMI it cannot derive as a dash', () => {
    const vitals = buildPatientProfile(PATIENT).vitals;
    if (vitals === null) throw new Error('mock chart has vitals');
    render(
      <OverviewTab
        bundle={{ patient: PATIENT, profile: { ...SPARSE, vitals: { ...vitals, bmi: null } } }}
        onViewMedications={vi.fn()}
      />,
    );

    expect(screen.getByText('BMI').parentElement).toHaveTextContent('—');
  });
});

describe('OverviewTab provenance (WEB-8)', () => {
  it('says the summary is this hospital’s record, not a complete history', () => {
    render(
      <OverviewTab
        bundle={{ patient: PATIENT, profile: buildPatientProfile(PATIENT) }}
        onViewMedications={vi.fn()}
      />,
    );

    expect(screen.getByText(/this hospital's record of the patient/i)).toBeInTheDocument();
    expect(screen.getByText(/not their history at other providers/i)).toBeInTheDocument();
  });
});

describe('OverviewTab vital signs in RTL', () => {
  it('pins each measurement and its unit left-to-right', () => {
    /*
     * "68 bpm" starts with a digit, so an RTL page would render it "bpm 68"
     * and "13 /min" as "min/ 13" (`docs/handoff/i18n.md` §5).
     */
    const profile = buildPatientProfile(PATIENT);
    if (profile.vitals === null) throw new Error('mock chart has vitals');
    render(<OverviewTab bundle={{ patient: PATIENT, profile }} onViewMedications={vi.fn()} />);

    for (const text of [
      `${String(profile.vitals.heartRateBpm)} bpm`,
      `${String(profile.vitals.temperatureC)} °C`,
      `${String(profile.vitals.respiratoryRate)} /min`,
    ]) {
      expect(screen.getByText(text).closest('[dir="ltr"]'), text).not.toBeNull();
    }
  });
});
