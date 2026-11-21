import { beforeEach, describe, expect, it } from 'vitest';

import { __resetPharmacyStore, mockPrescriptionService } from '../mock/mock-prescription-service';

import { MEDICATION_CATALOGUE } from './catalogue';
import { MOCK_PRESCRIPTIONS, PENDING_APPROVAL_FIXTURE_SPEC } from './mock-data';
import { endActFor } from './selectors';

/**
 * NEW-10 — the demo's one prescription awaiting approval.
 *
 * DEC-002 offers "Cancel prescription" only on `pending-approval`, which the
 * server sets only when the signed medication is controlled; no demo
 * formulary entry is, so the Cancel path could not be reached in a browser.
 * The seed now holds one such prescription. These pin that it is the only
 * one, that it is coherent with how the server produces the status, that it
 * cannot leak into prescribing, and that the guards around it are the
 * normal ones — the fixture adds a state, not a shortcut.
 */

const END = { details: '', actor: 'Dr. Amelia Chen' } as const;

beforeEach(() => __resetPharmacyStore());

function fixture() {
  const pending = MOCK_PRESCRIPTIONS.filter((rx) => rx.status === 'pending-approval');
  expect(pending).toHaveLength(1);
  return pending[0]!;
}

describe('the pending-approval fixture', () => {
  it('is the only prescription awaiting approval, and the seed grew by exactly one', () => {
    expect(MOCK_PRESCRIPTIONS).toHaveLength(6);
    expect(fixture().id).toBe('RX-200006');
  });

  it('carries a controlled medication — the only way the server produces the status', () => {
    const rx = fixture();
    expect(rx.medication.isControlled).toBe(true);
    expect(rx.medication.genericName).toBe('Tramadol');
    // Controlled → no refills, and nothing has been dispensed yet.
    expect(rx.refillsAllowed).toBe(0);
    expect(rx.timeline.map((event) => event.kind)).toEqual(['prescribed']);
  });

  it('invents no prescribing prose for the drug', () => {
    expect(PENDING_APPROVAL_FIXTURE_SPEC.interactionNote).toBeNull();
    expect(PENDING_APPROVAL_FIXTURE_SPEC.allergyClass).toBeNull();
  });

  it('is not on the formulary, so the authoring flow cannot offer it', async () => {
    expect(MEDICATION_CATALOGUE).not.toContain(PENDING_APPROVAL_FIXTURE_SPEC);
    expect(MEDICATION_CATALOGUE.some((spec) => spec.isControlled)).toBe(false);
    const offered = await mockPrescriptionService.listMedications();
    expect(offered.some((spec) => spec.genericName === 'Tramadol')).toBe(false);
  });

  it('belongs to Amira, not Layla — the authoring tests’ patient with nothing running', () => {
    expect(fixture().patient.id).toBe('PT-1003');
    const layla = MOCK_PRESCRIPTIONS.filter((rx) => rx.patient.id === 'PT-1005');
    expect(layla.every((rx) => rx.status === 'expired')).toBe(true);
  });

  it('is offered Cancel, and only Cancel (DEC-002)', () => {
    expect(endActFor(fixture())).toBe('cancel');
  });

  it('leaves every other seeded prescription offering what it did before', () => {
    const others = MOCK_PRESCRIPTIONS.filter((rx) => rx.id !== fixture().id);
    expect(others.map((rx) => [rx.id, rx.status, endActFor(rx)])).toEqual([
      ['RX-200001', 'active', 'discontinue'],
      ['RX-200002', 'active', 'discontinue'],
      ['RX-200003', 'active', 'discontinue'],
      ['RX-200004', 'active', 'discontinue'],
      ['RX-200005', 'expired', null],
    ]);
  });
});

describe('cancelling the fixture', () => {
  it('cancels it, recorded as a cancellation, and offers no further end act', async () => {
    const ended = await mockPrescriptionService.cancel({
      prescriptionId: fixture().id,
      reason: 'Prescribed in error',
      ...END,
    });

    expect(ended.status).toBe('discontinued');
    expect(ended.timeline.at(-1)?.detail).toBe('cancel: Prescribed in error');
    expect(endActFor(ended)).toBeNull();
    expect((await mockPrescriptionService.getPrescription(fixture().id)).status).toBe(
      'discontinued',
    );
  });

  it('refuses a second cancel once it has ended, and changes nothing', async () => {
    const id = fixture().id;
    await mockPrescriptionService.cancel({
      prescriptionId: id,
      reason: 'Prescribed in error',
      ...END,
    });
    const before = await mockPrescriptionService.getPrescription(id);

    await expect(
      mockPrescriptionService.cancel({ prescriptionId: id, reason: 'Prescribed in error', ...END }),
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect(await mockPrescriptionService.getPrescription(id)).toEqual(before);
  });

  it('touches no other prescription', async () => {
    const othersBefore = (await mockPrescriptionService.listPrescriptions()).filter(
      (rx) => rx.id !== fixture().id,
    );
    await mockPrescriptionService.cancel({
      prescriptionId: fixture().id,
      reason: 'Prescribed in error',
      ...END,
    });
    const othersAfter = (await mockPrescriptionService.listPrescriptions()).filter(
      (rx) => rx.id !== fixture().id,
    );
    expect(othersAfter).toEqual(othersBefore);
  });

  it('is reset with the store, so suites do not inherit a cancelled fixture', async () => {
    await mockPrescriptionService.cancel({
      prescriptionId: fixture().id,
      reason: 'Prescribed in error',
      ...END,
    });
    __resetPharmacyStore();
    expect((await mockPrescriptionService.getPrescription(fixture().id)).status).toBe(
      'pending-approval',
    );
  });
});
