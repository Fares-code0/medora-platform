import { describe, expect, it } from 'vitest';

import { EMPTY_VITALS, toVitalsInput, vitalsIssues, type VitalsDraft } from './vitals';

/** The record-vitals form's rules are the API's `createVitalsSchema`, nothing looser or tighter. */

const READING: VitalsDraft = {
  systolic: 128,
  diastolic: 82,
  heartRate: 74,
  temperatureC: 36.8,
  respiratoryRate: 16,
  oxygenSaturation: 97,
  weightKg: 81.5,
  heightCm: 176,
};

describe('vitals validation', () => {
  it('accepts a complete, plausible reading and sends it unchanged', () => {
    expect(vitalsIssues(READING)).toEqual({});
    expect(toVitalsInput(READING)).toEqual(READING);
  });

  it('requires every field — the API stores a complete set or nothing', () => {
    const issues = vitalsIssues(EMPTY_VITALS);
    expect(Object.keys(issues)).toHaveLength(8);
    expect(toVitalsInput({ ...READING, heightCm: null })).toBeNull();
  });

  it('refuses a typo but lets an alarming reading through', () => {
    expect(vitalsIssues({ ...READING, heartRate: 720 }).heartRate).toBe('Between 20 and 300 bpm');
    // Fahrenheit typed into Celsius.
    expect(vitalsIssues({ ...READING, temperatureC: 98.6 }).temperatureC).toMatch(/Between 25/);
    // Critical, but real: the form is not the clinician.
    expect(vitalsIssues({ ...READING, oxygenSaturation: 82, systolic: 210 })).toEqual({});
  });

  it('wants whole numbers where the API does, decimals where it does not', () => {
    expect(vitalsIssues({ ...READING, heartRate: 74.5 }).heartRate).toBe('Use a whole number');
    expect(vitalsIssues({ ...READING, temperatureC: 37.2 }).temperatureC).toBeUndefined();
  });

  it('refuses a systolic that does not exceed the diastolic', () => {
    expect(vitalsIssues({ ...READING, systolic: 80, diastolic: 80 }).systolic).toBe(
      'Systolic must exceed diastolic',
    );
  });

  it('treats an unparseable entry as missing, not as zero', () => {
    expect(vitalsIssues({ ...READING, weightKg: Number.NaN }).weightKg).toBe('Required');
  });
});
