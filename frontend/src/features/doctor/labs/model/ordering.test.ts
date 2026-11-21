import { describe, expect, it } from 'vitest';

import { TEST_CATALOGUE } from '@/features/shared-domain/lab-studies';
import type { Patient } from '@/features/shared-domain/patient-identity';

import {
  EMPTY_LAB_ORDER,
  NotOrderableError,
  assertOrderable,
  assessOrder,
  isOrderStepReachable,
  isOrderStepValid,
  toOrderedTests,
  type LabOrderDraft,
  type OrderableLabRequest,
} from './ordering';

/**
 * DX-23's ordering rules. The flow is lighter than D-17's — ordering a test
 * carries none of signing's irreversibility — but it keeps the same shape:
 * one producer of the value the service accepts, so an order without a
 * patient, a test or an indication cannot be constructed.
 */

const PATIENT = {
  id: 'PT-1001',
  name: 'Khaled Nassar',
  mrn: '4411-27',
  age: 52,
  gender: 'male',
  bloodType: 'O+',
  phone: '+20 100 000 0000',
} as unknown as Patient;

const CODE_A = TEST_CATALOGUE[0]?.code ?? '';
const CODE_B = TEST_CATALOGUE[1]?.code ?? '';

const complete: LabOrderDraft = {
  ...EMPTY_LAB_ORDER,
  patient: PATIENT,
  testCodes: [CODE_A],
  clinicalIndication: 'Fatigue, rule out anaemia',
};

const assess = (draft: LabOrderDraft, orderedBy = 'Dr. Amelia Chen') =>
  assessOrder({ draft, orderedBy, catalogue: TEST_CATALOGUE });

describe('step validity and reachability', () => {
  it('cannot skip forward past an incomplete step', () => {
    expect(isOrderStepReachable(EMPTY_LAB_ORDER, 'patient')).toBe(true);
    expect(isOrderStepReachable(EMPTY_LAB_ORDER, 'tests')).toBe(false);
    expect(isOrderStepReachable(EMPTY_LAB_ORDER, 'details')).toBe(false);
  });

  it('opens each step as the one before it validates', () => {
    const withPatient = { ...EMPTY_LAB_ORDER, patient: PATIENT };
    expect(isOrderStepReachable(withPatient, 'tests')).toBe(true);
    expect(isOrderStepReachable(withPatient, 'details')).toBe(false);

    const withTests = { ...withPatient, testCodes: [CODE_A] };
    expect(isOrderStepReachable(withTests, 'details')).toBe(true);
  });

  it('treats a whitespace-only indication as absent', () => {
    expect(isOrderStepValid({ ...complete, clinicalIndication: '   ' }, 'details')).toBe(false);
  });
});

describe('assessOrder', () => {
  it('produces an orderable request when every step is satisfied', () => {
    const { orderable, blockedBy } = assess(complete);
    expect(blockedBy).toBeNull();
    expect(orderable?.specs).toHaveLength(1);
    expect(orderable?.clinicalIndication).toBe('Fatigue, rule out anaemia');
  });

  it('refuses each missing piece by name', () => {
    expect(assess({ ...complete, patient: null }).blockedBy).toBe('no-patient');
    expect(assess({ ...complete, testCodes: [] }).blockedBy).toBe('no-tests');
    expect(assess({ ...complete, clinicalIndication: ' ' }).blockedBy).toBe('no-indication');
    expect(assess(complete, '  ').blockedBy).toBe('no-orderer');
  });

  it('refuses a code the catalogue does not carry rather than dropping it', () => {
    /*
     * Silently filtering it would place an order for fewer tests than the
     * doctor selected, and nothing on screen would say so.
     */
    const { orderable, blockedBy } = assess({ ...complete, testCodes: [CODE_A, 'not-a-code'] });
    expect(orderable).toBeNull();
    expect(blockedBy).toBe('unknown-test');
  });

  it('trims the indication it stores', () => {
    expect(assess({ ...complete, clinicalIndication: '  anaemia  ' }).orderable?.clinicalIndication).toBe(
      'anaemia',
    );
  });
});

describe('assertOrderable', () => {
  it('refuses a forged request at runtime', () => {
    const forged = { patient: PATIENT, specs: [], priority: 'routine' } as unknown as OrderableLabRequest;
    expect(() => {
      assertOrderable(forged);
    }).toThrow(NotOrderableError);
  });
});

describe('toOrderedTests', () => {
  const now = new Date('2026-09-01T09:00:00Z');

  it('creates one order per test, not one per request', () => {
    const { orderable } = assess({ ...complete, testCodes: [CODE_A, CODE_B] });
    const created = toOrderedTests(orderable as OrderableLabRequest, now);
    expect(created).toHaveLength(2);
    expect(new Set(created.map((t) => t.id)).size).toBe(2);
  });

  it('orders arrive unresulted, so they cannot enter the review Inbox', () => {
    const { orderable } = assess(complete);
    const [created] = toOrderedTests(orderable as OrderableLabRequest, now);
    expect(created?.status).toBe('ordered');
    expect(created?.results).toEqual([]);
    expect(created?.review).toBeNull();
    expect(created?.hasCriticalResult).toBe(false);
    expect(created?.completedDate).toBeNull();
  });

  it('carries the patient, the indication and the orderer onto every test', () => {
    const { orderable } = assess({ ...complete, testCodes: [CODE_A, CODE_B] });
    for (const test of toOrderedTests(orderable as OrderableLabRequest, now)) {
      expect(test.patient.id).toBe('PT-1001');
      expect(test.clinicalIndication).toBe('Fatigue, rule out anaemia');
      expect(test.orderedBy).toBe('Dr. Amelia Chen');
    }
  });

  it('opens a timeline that says nothing was transmitted', () => {
    const { orderable } = assess(complete);
    const [created] = toOrderedTests(orderable as OrderableLabRequest, now);
    expect(created?.timeline).toHaveLength(1);
    expect(created?.timeline[0]?.kind).toBe('ordered');
    expect(created?.timeline[0]?.detail).toContain('no laboratory system is connected');
  });
});
