import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { findMedicationSpec } from '../model/authoring';
import { MEDICATION_CATALOGUE } from '../model/catalogue';
import {
  screenPrescription,
  type CurrentMedication,
  type SafetyCheckRunner,
} from '../model/safety-check';
import type { PrescriptionPatientSnapshot } from '../model/types';

import { usePrescriptionAuthoring, type AuthoringFlowOptions } from './usePrescriptionAuthoring';

/**
 * The flow as a state machine: what it lets a doctor do, and — the part that
 * matters — what it will not let them do after the safety screen fails or
 * after they change something the screen already ran against.
 */

const PATIENT: PrescriptionPatientSnapshot = {
  id: 'PT-1001',
  name: 'Khaled Nassar',
  mrn: '4411-27',
  age: 52,
  gender: 'male',
  bloodType: 'O+',
  phone: '+20 100 214 3387',
  allergies: [],
  hasSevereAllergy: false,
};

const WARFARIN: CurrentMedication = {
  prescriptionId: 'RX-200004',
  name: 'Coumadin',
  genericName: 'Warfarin',
  category: 'Anticoagulants',
  isHighRisk: true,
};

const cleanRunner: SafetyCheckRunner = (subject) => Promise.resolve(screenPrescription(subject));

function render(options: Partial<AuthoringFlowOptions> = {}) {
  return renderHook(() =>
    usePrescriptionAuthoring({
      initialPatient: PATIENT,
      currentMedications: [],
      formulary: MEDICATION_CATALOGUE,
      runner: cleanRunner,
      ...options,
    }),
  );
}

/** Walk a rendered flow to a complete, unscreened draft on the Dosage step. */
function fillDosage(result: { current: ReturnType<typeof usePrescriptionAuthoring> }) {
  const spec = findMedicationSpec('Metformin', MEDICATION_CATALOGUE);
  if (spec === null) throw new Error('Test fixture drift: Metformin left the catalogue');

  act(() => {
    result.current.setMedication('Metformin');
  });
  act(() => {
    result.current.setStrength('500 mg');
  });
  act(() => {
    result.current.advance();
  });
  act(() => {
    result.current.setDosage('frequency', spec.frequencies[0] ?? '');
  });
  act(() => {
    result.current.setDosage('durationDays', 30);
  });
}

describe('usePrescriptionAuthoring — entry points', () => {
  it('opens on the medication step when a patient is pre-selected', () => {
    const { result } = render();
    expect(result.current.step).toBe('medication');
    expect(result.current.draft.patient?.id).toBe('PT-1001');
  });

  it('opens on the patient step from a cold start', () => {
    const { result } = render({ initialPatient: null });
    expect(result.current.step).toBe('patient');
  });
});

describe('usePrescriptionAuthoring — the step machine', () => {
  it('will not advance past a step whose fields are invalid, and shows its issues', () => {
    const { result } = render();

    act(() => {
      result.current.advance();
    });

    expect(result.current.step).toBe('medication');
    expect(result.current.showIssuesFor.has('medication')).toBe(true);
    expect(result.current.blockedBy).toEqual({ kind: 'invalid-step', step: 'medication' });
  });

  it('sends a forward jump back to the earliest step that objects', () => {
    const { result } = render({ initialPatient: null });

    act(() => {
      result.current.goTo('review');
    });

    expect(result.current.step).toBe('patient');
    expect(result.current.blockedBy).toEqual({ kind: 'invalid-step', step: 'patient' });
  });

  it('preserves entered data across back navigation', () => {
    const { result } = render();
    fillDosage(result);

    act(() => {
      result.current.back();
    });
    expect(result.current.step).toBe('medication');
    expect(result.current.draft.medication).toEqual({
      genericName: 'Metformin',
      strength: '500 mg',
    });

    act(() => {
      result.current.goTo('dosage');
    });
    expect(result.current.draft.dosage.durationDays).toBe(30);
    expect(result.current.draft.dosage.quantity).toBe(60);
  });

  it('proposes a quantity and instructions from the schedule, both overridable', () => {
    const { result } = render();
    fillDosage(result);

    expect(result.current.draft.dosage.quantity).toBe(60);
    expect(result.current.draft.dosage.instructions).not.toBe('');

    act(() => {
      result.current.setDosage('quantity', 42);
    });
    expect(result.current.draft.dosage.quantity).toBe(42);
  });

  it('clears the schedule when the medication changes, so it cannot survive the drug', () => {
    const { result } = render();
    fillDosage(result);
    expect(result.current.draft.dosage.frequency).not.toBeNull();

    act(() => {
      result.current.setMedication('Atorvastatin');
    });
    expect(result.current.draft.dosage.frequency).toBeNull();
  });
});

describe('usePrescriptionAuthoring — the blocking safety screen', () => {
  it('will not reach Review before the screen completes', async () => {
    const { result } = render();
    fillDosage(result);

    act(() => {
      result.current.advance();
    });

    // Blocked, not merely busy: still on Dosage while the check runs.
    expect(result.current.safetyPhase).toBe('running');
    expect(result.current.step).toBe('dosage');
    expect(result.current.signability.signable).toBeNull();

    await waitFor(() => {
      expect(result.current.step).toBe('review');
    });
    expect(result.current.safetyPhase).toBe('settled');
  });

  it('a clear verdict is signable with no acknowledgment', async () => {
    const { result } = render();
    fillDosage(result);
    act(() => {
      result.current.advance();
    });

    await waitFor(() => {
      expect(result.current.signability.signable).not.toBeNull();
    });
  });

  it('A THROWN CHECK LEAVES SIGNING UNREACHABLE', async () => {
    const { result } = render({
      runner: () => Promise.reject(new Error('interaction service down')),
    });
    fillDosage(result);
    act(() => {
      result.current.advance();
    });

    await waitFor(() => {
      expect(result.current.safetyPhase).toBe('settled');
    });

    expect(result.current.verdict?.status).toBe('failed');
    // Review was never entered, and no signable value exists.
    expect(result.current.step).toBe('dosage');
    expect(result.current.signability.signable).toBeNull();
    expect(result.current.signability.blockedBy).toBe('check-failed');
  });

  it('A TIMED-OUT CHECK LEAVES SIGNING UNREACHABLE', async () => {
    vi.useFakeTimers();
    try {
      const { result } = render({
        runner: () => new Promise(() => undefined),
        timeoutMs: 50,
      });
      fillDosage(result);
      act(() => {
        result.current.advance();
      });
      expect(result.current.safetyPhase).toBe('running');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });

      expect(result.current.verdict).toMatchObject({ status: 'failed', reason: 'timeout' });
      expect(result.current.step).toBe('dosage');
      expect(result.current.signability.signable).toBeNull();
      expect(result.current.signability.blockedBy).toBe('check-failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('AN UNKNOWN CURRENT-MEDICATION LIST LEAVES SIGNING UNREACHABLE', async () => {
    // An empty list and an unloaded list are not the same fact. Screening
    // the second as the first reports "no interactions" for a patient who
    // may well have several.
    const runner = vi.fn(cleanRunner);
    const { result } = render({ currentMedications: [], medicationsKnown: false, runner });
    fillDosage(result);

    act(() => {
      result.current.advance();
    });

    await waitFor(() => {
      expect(result.current.safetyPhase).toBe('settled');
    });

    // It never even asked: there was nothing valid to ask about.
    expect(runner).not.toHaveBeenCalled();
    expect(result.current.verdict).toMatchObject({ status: 'failed', reason: 'error' });
    expect(result.current.verdict?.status === 'failed' && result.current.verdict.message).toContain(
      'current medications',
    );
    expect(result.current.step).toBe('dosage');
    expect(result.current.signability.signable).toBeNull();
    expect(result.current.signability.blockedBy).toBe('check-failed');
  });

  it('a retry after a failure can still reach Review', async () => {
    let failNext = true;
    const { result } = render({
      runner: (subject) =>
        failNext ? Promise.reject(new Error('down')) : Promise.resolve(screenPrescription(subject)),
    });
    fillDosage(result);
    act(() => {
      result.current.advance();
    });
    await waitFor(() => {
      expect(result.current.verdict?.status).toBe('failed');
    });

    failNext = false;
    act(() => {
      result.current.runCheck();
    });
    await waitFor(() => {
      expect(result.current.step).toBe('review');
    });
    expect(result.current.signability.signable).not.toBeNull();
  });
});

describe('usePrescriptionAuthoring — acknowledgment', () => {
  async function reachReviewWithWarnings() {
    const view = render({ currentMedications: [WARFARIN] });
    fillDosage(view.result);
    act(() => {
      view.result.current.setMedication('Atorvastatin');
    });
    act(() => {
      view.result.current.setDosage('frequency', 'Once daily at night');
    });
    act(() => {
      view.result.current.setDosage('durationDays', 30);
    });
    act(() => {
      view.result.current.advance();
    });
    await waitFor(() => {
      expect(view.result.current.step).toBe('review');
    });
    return view;
  }

  it('blocks signing until a critical warning is ticked AND a reason is given', async () => {
    const { result } = await reachReviewWithWarnings();

    const warnings =
      result.current.verdict?.status === 'completed' ? result.current.verdict.warnings : [];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.severity).toBe('critical');
    expect(result.current.signability.blockedBy).toBe('unacknowledged');

    act(() => {
      warnings.forEach((warning) => {
        result.current.toggleAcknowledged(warning.id);
      });
    });
    // Ticked, but a critical warning also needs a stated reason.
    expect(result.current.signability.signable).toBeNull();

    act(() => {
      result.current.setAcknowledgmentReason('INR monitoring arranged weekly.');
    });
    expect(result.current.signability.signable).not.toBeNull();
  });

  it('DROPS PRIOR ACKNOWLEDGMENTS WHEN THE DOSAGE CHANGES AND THE CHECK RE-RUNS', async () => {
    const { result } = await reachReviewWithWarnings();
    const warnings =
      result.current.verdict?.status === 'completed' ? result.current.verdict.warnings : [];

    act(() => {
      warnings.forEach((warning) => {
        result.current.toggleAcknowledged(warning.id);
      });
    });
    act(() => {
      result.current.setAcknowledgmentReason('Accepted.');
    });
    expect(result.current.signability.signable).not.toBeNull();

    // Change the dosage: the verdict and every tick on it go together, and
    // Review stops being reachable until the screen runs again.
    act(() => {
      result.current.setDosage('quantity', 90);
    });

    expect(result.current.verdict).toBeNull();
    expect(result.current.acknowledgedIds).toEqual([]);
    expect(result.current.acknowledgmentReason).toBe('');
    expect(result.current.signability.signable).toBeNull();
    expect(result.current.signability.blockedBy).toBe('not-checked');

    // Re-running produces a fresh verdict that is unacknowledged again.
    act(() => {
      result.current.runCheck();
    });
    await waitFor(() => {
      expect(result.current.step).toBe('review');
    });
    expect(result.current.signability.blockedBy).toBe('unacknowledged');
  });

  it('drops acknowledgments when the medication changes too', async () => {
    const { result } = await reachReviewWithWarnings();
    const warnings =
      result.current.verdict?.status === 'completed' ? result.current.verdict.warnings : [];
    act(() => {
      warnings.forEach((warning) => {
        result.current.toggleAcknowledged(warning.id);
      });
      result.current.setAcknowledgmentReason('Accepted.');
    });

    act(() => {
      result.current.setMedication('Metformin');
    });

    expect(result.current.verdict).toBeNull();
    expect(result.current.acknowledgedIds).toEqual([]);
    expect(result.current.signability.signable).toBeNull();
  });

  it('ignores a superseded check that lands after a newer one started', async () => {
    const resolvers: ((value: unknown) => void)[] = [];
    const { result } = render({
      runner: () => new Promise((resolve) => resolvers.push(resolve)),
    });
    fillDosage(result);

    act(() => {
      result.current.advance();
    });
    act(() => {
      result.current.runCheck();
    });
    expect(resolvers).toHaveLength(2);

    // The FIRST check answers last. Its verdict must not be installed.
    await act(async () => {
      resolvers[1]?.([]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.step).toBe('review');
    });

    const settledVerdictId = result.current.verdict?.id;
    await act(async () => {
      resolvers[0]?.([{ boom: true }]);
      await Promise.resolve();
    });
    expect(result.current.verdict?.id).toBe(settledVerdictId);
    expect(result.current.verdict?.status).toBe('completed');
  });
});

describe('usePrescriptionAuthoring — reset', () => {
  it('clears the draft, the verdict, and every acknowledgment', async () => {
    const { result } = render();
    fillDosage(result);
    act(() => {
      result.current.advance();
    });
    await waitFor(() => {
      expect(result.current.step).toBe('review');
    });

    act(() => {
      result.current.resetDraft();
    });

    expect(result.current.step).toBe('patient');
    expect(result.current.draft.patient).toBeNull();
    expect(result.current.verdict).toBeNull();
    expect(result.current.signability.signable).toBeNull();
  });
});
