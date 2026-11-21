import { describe, expect, it, vi } from 'vitest';

import { findMedicationSpec, type CompleteDraft } from './authoring';
import { MEDICATION_CATALOGUE } from './catalogue';
import {
  NotSignableError,
  SAFETY_CHECK_TIMEOUT_MS,
  acknowledgmentApplies,
  reasonRequired,
  assertSignable,
  assessSignability,
  blockingWarnings,
  runSafetyCheck,
  screenPrescription,
  subjectFromDraft,
  subjectKey,
  warningsNeedingAcknowledgment,
  type AuthoringSafetyWarning,
  type CompletedSafetyVerdict,
  type CurrentMedication,
  type SafetyAcknowledgment,
  type SafetyCheckSubject,
  type SignablePrescription,
} from './safety-check';
import type { PrescriptionPatientSnapshot } from './types';

/**
 * The safety screen, and the property the whole feature is built around:
 * **a signature is obtainable only from a completed verdict.**
 *
 * The fail-closed tests are the reason this file exists. They do not assert
 * that a button is disabled — they assert that `assessSignability` yields no
 * `SignablePrescription`, which is the only thing the sign mutation accepts,
 * and that a forged one is refused at runtime too.
 */

const PATIENT: PrescriptionPatientSnapshot = {
  id: 'PT-1002',
  name: 'Mona Adel',
  mrn: '4436-58',
  age: 29,
  gender: 'female',
  bloodType: 'A+',
  phone: '+20 111 830 2245',
  allergies: ['Penicillin'],
  hasSevereAllergy: true,
};

const NO_ALLERGY_PATIENT: PrescriptionPatientSnapshot = {
  ...PATIENT,
  id: 'PT-1001',
  name: 'Khaled Nassar',
  allergies: [],
  hasSevereAllergy: false,
};

function draftFor(
  generic: string,
  patient: PrescriptionPatientSnapshot = NO_ALLERGY_PATIENT,
): CompleteDraft {
  const spec = findMedicationSpec(generic, MEDICATION_CATALOGUE);
  if (spec === null) throw new Error(`Test fixture drift: ${generic} left the catalogue`);
  return {
    id: 'draft-1',
    patient,
    spec,
    strength: spec.strengths[0] ?? '',
    frequency: spec.frequencies[0] ?? '',
    durationDays: spec.durationsDays[0] ?? 7,
    quantity: 14,
    refillsAllowed: 0,
    instructions: 'Take as directed.',
    renewedFrom: null,
  };
}

function medication(
  overrides: Partial<CurrentMedication> & Pick<CurrentMedication, 'genericName'>,
): CurrentMedication {
  const spec = findMedicationSpec(overrides.genericName, MEDICATION_CATALOGUE);
  return {
    prescriptionId: `RX-${overrides.genericName}`,
    name: spec?.name ?? overrides.genericName,
    category: spec?.category ?? 'Antibiotics',
    isHighRisk: spec?.isHighRisk ?? false,
    ...overrides,
  };
}

function subjectFor(generic: string, current: readonly CurrentMedication[] = [], patient = NO_ALLERGY_PATIENT) {
  return subjectFromDraft(draftFor(generic, patient), current);
}

/* ── The three specified categories ─────────────────────────────── */

describe('screenPrescription — allergy conflicts', () => {
  it('raises a blocking critical conflict when the drug class matches a recorded allergy', () => {
    const warnings = screenPrescription(subjectFor('Amoxicillin', [], PATIENT));
    const allergy = warnings.find((warning) => warning.kind === 'allergy');

    expect(allergy).toBeDefined();
    expect(allergy?.severity).toBe('critical');
    expect(allergy?.blocking).toBe(true);
    // It states what it found and against what.
    expect(allergy?.title).toContain('Penicillin');
    expect(allergy?.against).toEqual(['Recorded allergy: Penicillin']);
  });

  it('downgrades to warning severity when the allergy is not flagged severe', () => {
    const warnings = screenPrescription(
      subjectFor('Amoxicillin', [], { ...PATIENT, hasSevereAllergy: false }),
    );
    expect(warnings.find((warning) => warning.kind === 'allergy')?.severity).toBe('warning');
  });

  it('raises nothing when the patient has no matching allergy', () => {
    expect(screenPrescription(subjectFor('Amoxicillin'))).toHaveLength(0);
  });
});

describe('screenPrescription — drug–drug interactions', () => {
  it('raises nothing when the patient is on no other medication', () => {
    expect(screenPrescription(subjectFor('Atorvastatin'))).toHaveLength(0);
  });

  it('names the current medication it was found against', () => {
    const warnings = screenPrescription(
      subjectFor('Atorvastatin', [medication({ genericName: 'Metformin' })]),
    );
    const interaction = warnings.find((warning) => warning.kind === 'interaction');

    expect(interaction?.severity).toBe('warning');
    expect(interaction?.against).toEqual(['Glucophage (Metformin)']);
    expect(interaction?.detail).toContain('Myopathy risk');
  });

  it('escalates to critical against a high-alert medication', () => {
    const warnings = screenPrescription(
      subjectFor('Atorvastatin', [medication({ genericName: 'Warfarin' })]),
    );
    const interaction = warnings.find((warning) => warning.kind === 'interaction');

    expect(interaction?.severity).toBe('critical');
    expect(interaction?.against).toEqual(['Coumadin (Warfarin)']);
    // Interactions are never blocking — they are acknowledgeable (UX §2.7).
    expect(interaction?.blocking).toBe(false);
  });
});

describe('screenPrescription — duplicate therapy', () => {
  it('raises a critical duplicate when the same generic is already active', () => {
    const warnings = screenPrescription(
      subjectFor('Metformin', [medication({ genericName: 'Metformin', prescriptionId: 'RX-200001' })]),
    );
    const duplicate = warnings.find((warning) => warning.kind === 'duplicate');

    expect(duplicate?.severity).toBe('critical');
    expect(duplicate?.against).toEqual(['Glucophage · RX-200001']);
  });

  it('raises a warning-level duplicate for a different drug in the same class', () => {
    const warnings = screenPrescription(
      subjectFor('Metformin', [
        medication({
          genericName: 'Sitagliptin',
          name: 'Januvia',
          category: 'Antidiabetics',
          prescriptionId: 'RX-200099',
        }),
      ]),
    );
    const duplicate = warnings.find((warning) => warning.kind === 'duplicate');

    expect(duplicate?.severity).toBe('warning');
    expect(duplicate?.against).toEqual(['Januvia (Sitagliptin)']);
  });
});

describe('screenPrescription — presentation invariants', () => {
  it('sorts the most severe finding first, so the alert stack leads with it', () => {
    const warnings = screenPrescription(
      subjectFor(
        'Amoxicillin',
        [medication({ genericName: 'Amoxicillin', prescriptionId: 'RX-200002' })],
        PATIENT,
      ),
    );
    expect(warnings.length).toBeGreaterThan(1);
    expect(warnings[0]?.severity).toBe('critical');
  });

  it('labels every finding with its evidence source, so the demo marker is data', () => {
    const warnings = screenPrescription(subjectFor('Amoxicillin', [], PATIENT));
    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) expect(warning.source).toBe('demo-formulary');
  });
});

/* ── Fail closed ────────────────────────────────────────────────── */

describe('runSafetyCheck — fail closed', () => {
  const subject = subjectFor('Metformin');

  it('stamps the verdict with the source the port declares — a clear result included', async () => {
    const clinical = await runSafetyCheck(subject, {
      run: () => Promise.resolve([]),
      source: 'clinical-service',
    });
    const demo = await runSafetyCheck(subject, { run: () => Promise.resolve([]) });

    expect(clinical.status === 'completed' && clinical.source).toBe('clinical-service');
    expect(demo.status === 'completed' && demo.source).toBe('demo-formulary');
  });

  it('resolves to a failed verdict rather than throwing when the check errors', async () => {
    const verdict = await runSafetyCheck(subject, {
      run: () => Promise.reject(new Error('interaction service down')),
    });

    expect(verdict.status).toBe('failed');
    expect(verdict.status === 'failed' && verdict.reason).toBe('error');
  });

  it('A THROWN CHECK LEAVES SIGNING IMPOSSIBLE', async () => {
    const verdict = await runSafetyCheck(subject, {
      run: () => {
        throw new Error('interaction service down');
      },
    });

    const result = assessSignability({
      draft: draftFor('Metformin'),
      verdict,
      subject,
      acknowledgment: null,
    });

    expect(result.signable).toBeNull();
    expect(result.blockedBy).toBe('check-failed');
  });

  it('A TIMED-OUT CHECK LEAVES SIGNING IMPOSSIBLE', async () => {
    vi.useFakeTimers();
    try {
      const pending = runSafetyCheck(subject, {
        // Never settles on its own — only the timeout can decide this.
        run: () => new Promise(() => undefined),
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(60);
      const verdict = await pending;

      expect(verdict.status).toBe('failed');
      expect(verdict.status === 'failed' && verdict.reason).toBe('timeout');

      const result = assessSignability({
        draft: draftFor('Metformin'),
        verdict,
        subject,
        acknowledgment: null,
      });
      expect(result.signable).toBeNull();
      expect(result.blockedBy).toBe('check-failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the in-flight check when it times out', async () => {
    vi.useFakeTimers();
    try {
      const aborted = vi.fn();
      const pending = runSafetyCheck(subject, {
        run: (_subject, signal) =>
          new Promise(() => {
            signal.addEventListener('abort', aborted);
          }),
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(60);
      await pending;
      expect(aborted).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a result it cannot positively read as a warning list', async () => {
    for (const shape of [null, undefined, { ok: true }, 'clear', [{ nope: true }]]) {
      const verdict = await runSafetyCheck(subject, { run: () => Promise.resolve(shape) });
      expect(verdict.status, `shape ${JSON.stringify(shape)}`).toBe('failed');
      expect(verdict.status === 'failed' && verdict.reason).toBe('unreadable');
    }
  });

  it('does not treat a late rejection as an unhandled error once it has timed out', async () => {
    vi.useFakeTimers();
    try {
      const pending = runSafetyCheck(subject, {
        run: () =>
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late')), 500)),
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(600);
      await expect(pending).resolves.toMatchObject({ status: 'failed', reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes with the screened warnings on the happy path', async () => {
    const verdict = await runSafetyCheck(subjectFor('Amoxicillin', [], PATIENT), {
      run: (candidate) => Promise.resolve(screenPrescription(candidate)),
    });

    expect(verdict.status).toBe('completed');
    expect(verdict.status === 'completed' && verdict.warnings).toHaveLength(1);
  });

  it('defaults to an eight-second budget', () => {
    expect(SAFETY_CHECK_TIMEOUT_MS).toBe(8_000);
  });
});

/* ── Signability ────────────────────────────────────────────────── */

function completedVerdict(
  subject: SafetyCheckSubject,
  warnings: readonly AuthoringSafetyWarning[],
  id = 'chk-1',
): CompletedSafetyVerdict {
  return {
    status: 'completed',
    id,
    subjectKey: subjectKey(subject),
    checkedAt: '2026-08-30T09:00:00.000Z',
    source: 'demo-formulary',
    warnings,
  };
}

describe('assessSignability', () => {
  it('refuses an incomplete draft', () => {
    expect(
      assessSignability({ draft: null, verdict: null, subject: null, acknowledgment: null }),
    ).toEqual({ signable: null, blockedBy: 'incomplete-draft' });
  });

  it('refuses a draft that has never been screened', () => {
    const subject = subjectFor('Metformin');
    expect(
      assessSignability({
        draft: draftFor('Metformin'),
        verdict: null,
        subject,
        acknowledgment: null,
      }),
    ).toEqual({ signable: null, blockedBy: 'not-checked' });
  });

  it('signs a clear verdict with no acknowledgment', () => {
    const subject = subjectFor('Metformin');
    const result = assessSignability({
      draft: draftFor('Metformin'),
      verdict: completedVerdict(subject, []),
      subject,
      acknowledgment: null,
    });
    expect(result.signable).not.toBeNull();
  });

  /**
   * Regression: the reason requirement used to be enforced upstream in the
   * hook, ahead of the blocking check, so this case reported
   * "unacknowledged" — telling the doctor to tick a box when the actual
   * remedy was to change the medication.
   */
  it('reports the blocking conflict, not the acknowledgment, when both apply', () => {
    const subject = subjectFor(
      'Amoxicillin',
      [medication({ genericName: 'Amoxicillin', prescriptionId: 'RX-200002' })],
      PATIENT,
    );
    const verdict = completedVerdict(subject, screenPrescription(subject));

    // Both an un-overridable allergy conflict and a critical duplicate.
    expect(blockingWarnings(verdict)).toHaveLength(1);
    expect(warningsNeedingAcknowledgment(verdict).some((w) => w.severity === 'critical')).toBe(true);

    expect(
      assessSignability({
        draft: draftFor('Amoxicillin', PATIENT),
        verdict,
        subject,
        acknowledgment: null,
      }),
    ).toEqual({ signable: null, blockedBy: 'blocking-warning' });
  });

  it('refuses to sign past a blocking allergy conflict, acknowledged or not', () => {
    const subject = subjectFor('Amoxicillin', [], PATIENT);
    const warnings = screenPrescription(subject);
    const verdict = completedVerdict(subject, warnings);
    expect(blockingWarnings(verdict)).toHaveLength(1);

    const acknowledgment: SafetyAcknowledgment = {
      verdictId: verdict.id,
      warningIds: warnings.map((warning) => warning.id),
      reason: 'Accepted the risk',
      acknowledgedAt: '2026-08-30T09:01:00.000Z',
    };

    expect(
      assessSignability({
        draft: draftFor('Amoxicillin', PATIENT),
        verdict,
        subject,
        acknowledgment,
      }),
    ).toEqual({ signable: null, blockedBy: 'blocking-warning' });
  });

  it('requires every non-info warning to be acknowledged', () => {
    const current = [medication({ genericName: 'Warfarin' })];
    const subject = subjectFor('Atorvastatin', current);
    const warnings = screenPrescription(subject);
    const verdict = completedVerdict(subject, warnings);

    expect(warningsNeedingAcknowledgment(verdict)).toHaveLength(warnings.length);

    const unacknowledged = assessSignability({
      draft: draftFor('Atorvastatin'),
      verdict,
      subject,
      acknowledgment: null,
    });
    expect(unacknowledged).toEqual({ signable: null, blockedBy: 'unacknowledged' });

    const acknowledged = assessSignability({
      draft: draftFor('Atorvastatin'),
      verdict,
      subject,
      acknowledgment: {
        verdictId: verdict.id,
        warningIds: warnings.map((warning) => warning.id),
        reason: 'INR monitoring arranged.',
        acknowledgedAt: '2026-08-30T09:01:00.000Z',
      },
    });
    expect(acknowledged.signable).not.toBeNull();
  });

  it('refuses a verdict screened against a different subject', () => {
    const subject = subjectFor('Metformin');
    const otherSubject = subjectFor('Atorvastatin');

    expect(
      assessSignability({
        draft: draftFor('Metformin'),
        verdict: completedVerdict(otherSubject, []),
        subject,
        acknowledgment: null,
      }),
    ).toEqual({ signable: null, blockedBy: 'stale-check' });
  });
});

describe('acknowledgment invalidation', () => {
  it('does not carry an acknowledgment over to a re-run of the check', () => {
    const current = [medication({ genericName: 'Warfarin' })];
    const subject = subjectFor('Atorvastatin', current);
    const warnings = screenPrescription(subject);

    const first = completedVerdict(subject, warnings, 'chk-1');
    const acknowledgment: SafetyAcknowledgment = {
      verdictId: 'chk-1',
      warningIds: warnings.map((warning) => warning.id),
      reason: 'Accepted.',
      acknowledgedAt: '2026-08-30T09:01:00.000Z',
    };
    expect(acknowledgmentApplies(acknowledgment, first)).toBe(true);

    // Same finding, new run: the tick was given against a verdict that no
    // longer exists, so it stops counting.
    const second = completedVerdict(subject, warnings, 'chk-2');
    expect(acknowledgmentApplies(acknowledgment, second)).toBe(false);
    expect(
      assessSignability({
        draft: draftFor('Atorvastatin'),
        verdict: second,
        subject,
        acknowledgment,
      }),
    ).toEqual({ signable: null, blockedBy: 'unacknowledged' });
  });

  it('changing the dosage changes the subject key, so the old verdict is stale', () => {
    const base = draftFor('Metformin');
    const before = subjectFromDraft(base, []);
    const after = subjectFromDraft({ ...base, durationDays: base.durationDays + 30 }, []);
    expect(subjectKey(before)).not.toBe(subjectKey(after));
  });

  it('rejects a critical acknowledgment with no stated reason (UX §2.7)', () => {
    const current = [medication({ genericName: 'Warfarin' })];
    const subject = subjectFor('Atorvastatin', current);
    const warnings = screenPrescription(subject);
    const verdict = completedVerdict(subject, warnings);
    expect(warnings.some((warning) => warning.severity === 'critical')).toBe(true);

    const ticked = (reason: string): SafetyAcknowledgment => ({
      verdictId: verdict.id,
      warningIds: warnings.map((warning) => warning.id),
      reason,
      acknowledgedAt: '2026-08-30T09:01:00.000Z',
    });

    expect(acknowledgmentApplies(ticked(''), verdict)).toBe(false);
    expect(acknowledgmentApplies(ticked('   '), verdict)).toBe(false);
    expect(acknowledgmentApplies(ticked('INR monitoring arranged.'), verdict)).toBe(true);
  });

  it('does not demand a reason when no warning is critical', () => {
    const subject = subjectFor('Metformin', [
      medication({
        genericName: 'Sitagliptin',
        name: 'Januvia',
        category: 'Antidiabetics',
        prescriptionId: 'RX-200099',
      }),
    ]);
    const warnings = screenPrescription(subject);
    const verdict = completedVerdict(subject, warnings);
    expect(warnings.every((warning) => warning.severity !== 'critical')).toBe(true);

    expect(
      acknowledgmentApplies(
        {
          verdictId: verdict.id,
          warningIds: warnings.map((warning) => warning.id),
          reason: '',
          acknowledgedAt: '2026-08-30T09:01:00.000Z',
        },
        verdict,
      ),
    ).toBe(true);
  });

  it('demands a reason for any acknowledgment on the clinical service’s verdict (API §7.7)', () => {
    const subject = subjectFor('Metformin', [
      medication({
        genericName: 'Sitagliptin',
        name: 'Januvia',
        category: 'Antidiabetics',
        prescriptionId: 'RX-200099',
      }),
    ]);
    const warnings = screenPrescription(subject);
    const verdict = { ...completedVerdict(subject, warnings), source: 'clinical-service' as const };
    expect(warnings.every((warning) => warning.severity !== 'critical')).toBe(true);
    expect(reasonRequired(verdict)).toBe(true);

    const ticked = (reason: string): SafetyAcknowledgment => ({
      verdictId: verdict.id,
      warningIds: warnings.map((warning) => warning.id),
      reason,
      acknowledgedAt: '2026-08-30T09:01:00.000Z',
    });
    // The server refuses an acknowledgment with no reason; so does the form.
    expect(acknowledgmentApplies(ticked(''), verdict)).toBe(false);
    expect(acknowledgmentApplies(ticked('Both intended.'), verdict)).toBe(true);
  });

  it('needs no reason when nothing needs acknowledging, whatever the source', () => {
    const subject = subjectFor('Metformin');
    expect(reasonRequired({ ...completedVerdict(subject, []), source: 'clinical-service' })).toBe(
      false,
    );
  });

  it('rejects an acknowledgment that misses one of the warnings raised', () => {
    const current = [medication({ genericName: 'Warfarin' })];
    const subject = subjectFor('Atorvastatin', current);
    const verdict = completedVerdict(subject, screenPrescription(subject));

    expect(
      acknowledgmentApplies(
        {
          verdictId: verdict.id,
          warningIds: [],
          reason: 'Accepted.',
          acknowledgedAt: '2026-08-30T09:01:00.000Z',
        },
        verdict,
      ),
    ).toBe(false);
  });
});

describe('assertSignable — the runtime half of the guarantee', () => {
  it('accepts what assessSignability produced', () => {
    const subject = subjectFor('Metformin');
    const result = assessSignability({
      draft: draftFor('Metformin'),
      verdict: completedVerdict(subject, []),
      subject,
      acknowledgment: null,
    });
    expect(result.signable).not.toBeNull();
    expect(() => {
      assertSignable(result.signable as SignablePrescription);
    }).not.toThrow();
  });

  it('refuses a hand-built object cast into the type', () => {
    const subject = subjectFor('Metformin');
    const forged = {
      draft: draftFor('Metformin'),
      verdict: completedVerdict(subject, []),
      acknowledgment: null,
    } as unknown as SignablePrescription;

    expect(() => {
      assertSignable(forged);
    }).toThrow(NotSignableError);
  });

  it('refuses a signable revived from JSON — the symbol does not survive', () => {
    const subject = subjectFor('Metformin');
    const { signable } = assessSignability({
      draft: draftFor('Metformin'),
      verdict: completedVerdict(subject, []),
      subject,
      acknowledgment: null,
    });
    const revived = JSON.parse(JSON.stringify(signable)) as SignablePrescription;

    expect(() => {
      assertSignable(revived);
    }).toThrow(NotSignableError);
  });
});
