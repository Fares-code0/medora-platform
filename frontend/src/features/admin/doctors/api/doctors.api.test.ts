import { beforeEach, describe, expect, it } from 'vitest';

import type { DoctorRecord } from '../doctors.types';

import { DEFAULT_DOCTORS, doctorsApi, DoctorsError, type DoctorsDocument } from './doctors.api';

/**
 * The doctor-lifecycle service (ADM-02 / ADM-03).
 *
 * These tests exist because the verification rules are the kind a UI can
 * appear to enforce while the service quietly does not. Every refusal is
 * asserted at the service boundary: approving a document without its
 * checks, verifying a doctor whose file is incomplete, rejecting someone
 * already verified. And every decision must leave an attributed audit
 * entry — an administrative action nobody signed is not an action.
 */

const STORAGE_KEY = 'medora.admin.doctors.v1';
const ACTOR = 'Marcus Reed';

/** Pending, with the degree certificate unapproved. */
const BLOCKED = 'doc-nabil';
/** Pending, with everything approved — the one ready to verify. */
const READY = 'doc-farouk';
const VERIFIED = 'doc-chen';
const SUSPENDED = 'doc-said';
const REJECTED = 'doc-reyes';

function find(document: DoctorsDocument, id: string): DoctorRecord {
  const doctor = document.doctors.find((entry) => entry.id === id);
  if (doctor === undefined) throw new Error(`Fixture ${id} is missing from the seed.`);
  return doctor;
}

function documentOf(doctor: DoctorRecord, kind: string) {
  const found = doctor.documents.find((entry) => entry.kind === kind);
  if (found === undefined) throw new Error(`No ${kind} on ${doctor.id}.`);
  return found;
}

/** Ticks all three checks on one of Dr. Nabil's documents. */
async function tickEveryCheck(documentId: string) {
  for (const field of ['authentic', 'current', 'matchesIdentity'] as const) {
    await doctorsApi.setCheck({ doctorId: BLOCKED, documentId, field, value: true });
  }
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('reads', () => {
  it('serves the seeded baseline when nothing is stored', async () => {
    await expect(doctorsApi.list()).resolves.toEqual(DEFAULT_DOCTORS);
  });

  it('falls back to the baseline when storage holds junk', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json');

    await expect(doctorsApi.list()).resolves.toEqual(DEFAULT_DOCTORS);
  });
});

describe('document decisions', () => {
  it('refuses to approve a document whose checks are not all ticked', async () => {
    const degree = documentOf(find(DEFAULT_DOCTORS, BLOCKED), 'degree');

    await expect(
      doctorsApi.approveDocument({ doctorId: BLOCKED, documentId: degree.id, actor: ACTOR }),
    ).rejects.toBeInstanceOf(DoctorsError);

    // Nothing was written on the way out.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('approves once the checklist is complete, and says who did it', async () => {
    const degree = documentOf(find(DEFAULT_DOCTORS, BLOCKED), 'degree');

    await tickEveryCheck(degree.id);
    const next = await doctorsApi.approveDocument({
      doctorId: BLOCKED,
      documentId: degree.id,
      actor: ACTOR,
    });

    const approved = documentOf(find(next, BLOCKED), 'degree');
    expect(approved.decision).toBe('approved');
    expect(approved.reviewedBy).toBe(ACTOR);
    expect(find(next, BLOCKED).audit[0]).toMatchObject({
      actor: ACTOR,
      action: 'Document approved',
    });
  });

  it('keeps all three checks when they are ticked faster than a round trip', async () => {
    const degree = documentOf(find(DEFAULT_DOCTORS, BLOCKED), 'degree');

    // An administrator ticking three boxes in a second. Each write carries
    // one field and is applied to freshly loaded state, so none of them can
    // undo the others — the reason `setCheck` takes a field, not a checklist.
    await Promise.all(
      (['authentic', 'current', 'matchesIdentity'] as const).map((field) =>
        doctorsApi.setCheck({ doctorId: BLOCKED, documentId: degree.id, field, value: true }),
      ),
    );

    const stored = documentOf(find(await doctorsApi.list(), BLOCKED), 'degree');
    expect(stored.checklist).toEqual({ authentic: true, current: true, matchesIdentity: true });
  });

  it('requires a reason to reject a document, and shows it to the doctor', async () => {
    const degree = documentOf(find(DEFAULT_DOCTORS, BLOCKED), 'degree');

    await expect(
      doctorsApi.rejectDocument({
        doctorId: BLOCKED,
        documentId: degree.id,
        actor: ACTOR,
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(DoctorsError);

    const next = await doctorsApi.rejectDocument({
      doctorId: BLOCKED,
      documentId: degree.id,
      actor: ACTOR,
      reason: 'Page two of the certificate is missing.',
    });

    const rejected = documentOf(find(next, BLOCKED), 'degree');
    expect(rejected.decision).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Page two of the certificate is missing.');
  });
});

describe('completing verification', () => {
  it('refuses while any required document is outstanding', async () => {
    await expect(
      doctorsApi.completeVerification({ doctorId: BLOCKED, actor: ACTOR }),
    ).rejects.toThrow(/approved and unexpired/);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('verifies a doctor whose file is complete, with attribution', async () => {
    const next = await doctorsApi.completeVerification({ doctorId: READY, actor: ACTOR });
    const doctor = find(next, READY);

    expect(doctor.verification).toBe('verified');
    expect(doctor.verificationNote).toBeNull();
    expect(doctor.audit[0]).toMatchObject({ actor: ACTOR, action: 'Verification completed' });
  });

  it('survives a reload', async () => {
    await doctorsApi.completeVerification({ doctorId: READY, actor: ACTOR });

    const reloaded = await doctorsApi.list();

    expect(find(reloaded, READY).verification).toBe('verified');
  });

  it('refuses to verify someone already verified', async () => {
    await expect(
      doctorsApi.completeVerification({ doctorId: VERIFIED, actor: ACTOR }),
    ).rejects.toThrow(/already verified/);
  });

  it('becomes possible once the blocking document is approved', async () => {
    const degree = documentOf(find(DEFAULT_DOCTORS, BLOCKED), 'degree');
    await tickEveryCheck(degree.id);
    await doctorsApi.approveDocument({ doctorId: BLOCKED, documentId: degree.id, actor: ACTOR });

    const next = await doctorsApi.completeVerification({ doctorId: BLOCKED, actor: ACTOR });

    expect(find(next, BLOCKED).verification).toBe('verified');
  });
});

describe('requesting documents and rejecting applications', () => {
  it('moves the doctor out of the queue and tells them what is needed', async () => {
    const next = await doctorsApi.requestDocuments({
      doctorId: BLOCKED,
      actor: ACTOR,
      reason: 'A clear scan of both pages of the degree certificate.',
    });
    const doctor = find(next, BLOCKED);

    expect(doctor.verification).toBe('docs-requested');
    expect(doctor.verificationNote).toContain('both pages');
  });

  it('suspends the account when an application is rejected', async () => {
    const next = await doctorsApi.rejectApplication({
      doctorId: BLOCKED,
      actor: ACTOR,
      reason: 'The licence number does not match the national register.',
    });
    const doctor = find(next, BLOCKED);

    expect(doctor.verification).toBe('rejected');
    // A rejected application must not leave a usable account behind.
    expect(doctor.account).toBe('suspended');
  });

  it('will not reject a verified doctor — that is a suspension, not a rejection', async () => {
    await expect(
      doctorsApi.rejectApplication({
        doctorId: VERIFIED,
        actor: ACTOR,
        reason: 'Trying to reject someone already practising.',
      }),
    ).rejects.toThrow(/Suspend the account/);
  });

  it('returns a rejected application to the queue rather than re-deciding it', async () => {
    const next = await doctorsApi.returnToReview({ doctorId: REJECTED, actor: ACTOR });

    expect(find(next, REJECTED).verification).toBe('pending');
    await expect(
      doctorsApi.returnToReview({ doctorId: READY, actor: ACTOR }),
    ).rejects.toThrow(/Only a rejected application/);
  });
});

describe('account controls', () => {
  it('requires a reason to suspend and records it', async () => {
    await expect(
      doctorsApi.suspend({ doctorId: VERIFIED, actor: ACTOR, reason: '' }),
    ).rejects.toBeInstanceOf(DoctorsError);

    const next = await doctorsApi.suspend({
      doctorId: VERIFIED,
      actor: ACTOR,
      reason: 'Prescribing audit opened following a pharmacy report.',
    });
    const doctor = find(next, VERIFIED);

    expect(doctor.account).toBe('suspended');
    expect(doctor.suspensionReason).toContain('pharmacy report');
    expect(doctor.audit[0]).toMatchObject({ actor: ACTOR, action: 'Account suspended' });
  });

  it('reactivates only what is suspended', async () => {
    const next = await doctorsApi.reactivate({ doctorId: SUSPENDED, actor: ACTOR });

    expect(find(next, SUSPENDED).account).toBe('active');
    expect(find(next, SUSPENDED).suspensionReason).toBeNull();
    await expect(
      doctorsApi.reactivate({ doctorId: VERIFIED, actor: ACTOR }),
    ).rejects.toThrow(/not suspended/);
  });

  it('sends a reset link and never sets a credential itself', async () => {
    const before = find(DEFAULT_DOCTORS, VERIFIED);
    const next = await doctorsApi.resetAccess({ doctorId: VERIFIED, actor: ACTOR });
    const after = find(next, VERIFIED);

    expect(after.audit[0]).toMatchObject({ actor: ACTOR, action: 'Access reset sent' });
    expect(after.audit[0]?.detail).toContain(before.email);
    // Nothing about the account itself changed.
    expect(after.account).toBe(before.account);
    expect(after.verification).toBe(before.verification);
  });
});

describe('administrative fields', () => {
  it('records what changed, from and to', async () => {
    const next = await doctorsApi.updateAdministrative({
      doctorId: VERIFIED,
      actor: ACTOR,
      fields: { roleTemplate: 'Locum', clinic: 'Medora North' },
    });
    const doctor = find(next, VERIFIED);

    expect(doctor.administrative).toEqual({ roleTemplate: 'Locum', clinic: 'Medora North' });
    expect(doctor.audit[0]?.detail).toContain('Attending physician → Locum');
    expect(doctor.audit[0]?.detail).toContain('Medora Central → Medora North');
  });

  it('refuses a no-op rather than writing an empty audit line', async () => {
    const current = find(DEFAULT_DOCTORS, VERIFIED).administrative;
    if (current === null) throw new Error('seeded doctors carry administrative fields');

    await expect(
      doctorsApi.updateAdministrative({ doctorId: VERIFIED, actor: ACTOR, fields: current }),
    ).rejects.toThrow(/Nothing changed/);
  });
});

describe('invitations', () => {
  it('rejects a malformed address, a known doctor and a duplicate invite', async () => {
    await expect(
      doctorsApi.invite({
        email: 'not-an-address',
        specialty: 'Radiology',
        roleTemplate: 'Consultant',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/valid email/);

    const existing = find(DEFAULT_DOCTORS, VERIFIED).email;
    await expect(
      doctorsApi.invite({
        email: existing,
        specialty: 'Radiology',
        roleTemplate: 'Consultant',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/already belongs/);

    const first = await doctorsApi.invite({
      email: 'new.doctor@medora.health',
      specialty: 'Radiology',
      roleTemplate: 'Consultant',
      actor: ACTOR,
    });
    expect(first.invites[0]?.email).toBe('new.doctor@medora.health');

    await expect(
      doctorsApi.invite({
        email: 'NEW.DOCTOR@medora.health',
        specialty: 'Radiology',
        roleTemplate: 'Consultant',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/already been sent/);
  });
});

describe('missing records', () => {
  it('refuses every write against a doctor who is not there', async () => {
    await expect(
      doctorsApi.suspend({ doctorId: 'doc-nobody', actor: ACTOR, reason: 'A reason that is long enough.' }),
    ).rejects.toThrow(/no longer on the platform/);
  });
});

describe('reset', () => {
  it('restores the seeded baseline', async () => {
    await doctorsApi.completeVerification({ doctorId: READY, actor: ACTOR });

    await doctorsApi.reset();

    await expect(doctorsApi.list()).resolves.toEqual(DEFAULT_DOCTORS);
  });
});
