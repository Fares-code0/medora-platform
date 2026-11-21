import { beforeEach, describe, expect, it } from 'vitest';

import { patientsApi, PatientsError } from './patients.api';

/**
 * The service's refusals (ADM-04 · UX §3.4).
 *
 * The point of these tests is not that the happy paths work — it is that
 * the guarantees hold when the UI is bypassed. Every rule here is
 * re-checked at write time precisely because a disabled button is a
 * courtesy and not a control.
 */

const ACTOR = 'Marcus Reed';

beforeEach(() => {
  window.localStorage.clear();
});

async function find(id: string) {
  const document = await patientsApi.list();
  const patient = document.patients.find((entry) => entry.id === id);
  if (patient === undefined) throw new Error(`fixture ${id} missing`);
  return patient;
}

describe('credentials', () => {
  /*
   * §3.4's "admin never sets a password directly" is enforced structurally:
   * `resetCredentials` takes `{ patientId, actor }` and there is no other
   * credential-bearing call on the service, so `tsc` rejects any attempt to
   * pass one. That is a compile-time guarantee and there is nothing honest
   * to assert about it at runtime — what these tests can prove is the
   * behaviour around it: a link is recorded as sent, and a deactivated
   * account is refused one.
   */
  it('records that a link was sent, against the account address', async () => {
    await patientsApi.resetCredentials({ patientId: 'PT-1001', actor: ACTOR });
    const patient = await find('PT-1001');

    const event = patient.events[0];
    expect(event?.kind).toBe('credential-reset');
    expect(event?.actor).toBe(ACTOR);
    expect(event?.detail).toContain('@example.test');
  });

  it('refuses to send a reset link to a deactivated account', async () => {
    await patientsApi.deactivate({
      patientId: 'PT-1001',
      actor: ACTOR,
      reason: 'Closure requested by the patient.',
    });

    await expect(
      patientsApi.resetCredentials({ patientId: 'PT-1001', actor: ACTOR }),
    ).rejects.toBeInstanceOf(PatientsError);
  });
});

describe('locking', () => {
  it('clears the cause when an administrator unlocks', async () => {
    const before = await find('PT-1002');
    expect(before.status).toBe('locked');
    expect(before.lockCause).toBe('failed-sign-ins');

    await patientsApi.unlock({ patientId: 'PT-1002', actor: ACTOR });
    const after = await find('PT-1002');

    expect(after.status).toBe('active');
    expect(after.lockCause).toBeNull();
    expect(after.events[0]?.kind).toBe('account-unlocked');
  });

  it('refuses to unlock an account that is not locked', async () => {
    await expect(
      patientsApi.unlock({ patientId: 'PT-1001', actor: ACTOR }),
    ).rejects.toBeInstanceOf(PatientsError);
  });
});

describe('deactivation', () => {
  it('re-checks the reason rather than trusting the dialog', async () => {
    await expect(
      patientsApi.deactivate({ patientId: 'PT-1001', actor: ACTOR, reason: 'no' }),
    ).rejects.toBeInstanceOf(PatientsError);

    // Nothing was written.
    expect(window.localStorage.getItem('medora.admin.patients.v1')).toBeNull();
  });

  it('keeps the reason on the account and in the timeline', async () => {
    const reason = 'Closure requested by the patient in ticket SUP-4471.';
    await patientsApi.deactivate({ patientId: 'PT-1001', actor: ACTOR, reason });
    const patient = await find('PT-1001');

    expect(patient.status).toBe('inactive');
    expect(patient.deactivationReason).toBe(reason);
    expect(patient.events[0]).toMatchObject({ kind: 'account-deactivated', actor: ACTOR });
  });
});

describe('access grants', () => {
  it('keeps a revoked grant as history rather than deleting it', async () => {
    const before = await find('PT-1004');
    const target = before.grants.find((entry) => entry.granteeName === 'Dr. Omar Khalil');
    expect(target).toBeDefined();

    await patientsApi.revokeAccess({
      patientId: 'PT-1004',
      grantId: target?.id ?? '',
      actor: ACTOR,
      reason: 'Transferred to another clinic; access no longer required.',
    });

    const after = await find('PT-1004');
    const revoked = after.grants.find((entry) => entry.id === target?.id);

    // Still on the record — with who, when and why.
    expect(revoked?.status).toBe('revoked');
    expect(revoked?.revokedBy).toBe(ACTOR);
    expect(revoked?.revocationReason).toContain('Transferred');
    expect(after.grants).toHaveLength(before.grants.length);
  });

  it('drops the revoked doctor out of the derived column', async () => {
    const before = await find('PT-1004');
    const target = before.grants.find((entry) => entry.granteeName === 'Dr. Omar Khalil');
    expect(before.assignedDoctors).toContain('Dr. Omar Khalil');

    await patientsApi.revokeAccess({
      patientId: 'PT-1004',
      grantId: target?.id ?? '',
      actor: ACTOR,
      reason: 'Transferred to another clinic; access no longer required.',
    });

    const after = await find('PT-1004');
    expect(after.assignedDoctors).not.toContain('Dr. Omar Khalil');
    expect(after.assignedDoctors).toContain('Dr. Amelia Chen');
  });

  it('refuses to revoke the same grant twice', async () => {
    const patient = await find('PT-1003');
    const alreadyRevoked = patient.grants.find((entry) => entry.status === 'revoked');
    expect(alreadyRevoked).toBeDefined();

    await expect(
      patientsApi.revokeAccess({
        patientId: 'PT-1003',
        grantId: alreadyRevoked?.id ?? '',
        actor: ACTOR,
        reason: 'Trying to revoke it a second time.',
      }),
    ).rejects.toBeInstanceOf(PatientsError);
  });

  it('requires a reason to revoke', async () => {
    const patient = await find('PT-1004');
    const target = patient.grants.find((entry) => entry.status === 'active');

    await expect(
      patientsApi.revokeAccess({
        patientId: 'PT-1004',
        grantId: target?.id ?? '',
        actor: ACTOR,
        reason: 'nope',
      }),
    ).rejects.toBeInstanceOf(PatientsError);
  });
});

describe('access requests', () => {
  it('turns an approval into a live grant attributed to the approver', async () => {
    const before = await find('PT-1004');
    const request = before.accessRequests[0];
    expect(request).toBeDefined();

    await patientsApi.approveRequest({
      patientId: 'PT-1004',
      requestId: request?.id ?? '',
      actor: ACTOR,
    });

    const after = await find('PT-1004');
    const created = after.grants.find((entry) => entry.granteeName === request?.requesterName);

    expect(after.accessRequests).toHaveLength(0);
    expect(created?.status).toBe('active');
    expect(created?.scope).toBe(request?.scope);
    // The approver owns the grant, not the requester.
    expect(created?.grantedBy).toBe(ACTOR);
    expect(after.events[0]?.kind).toBe('access-granted');
  });

  it('records a decline with its reason and grants nothing', async () => {
    const before = await find('PT-1002');
    const request = before.accessRequests[0];

    await patientsApi.denyRequest({
      patientId: 'PT-1002',
      requestId: request?.id ?? '',
      actor: ACTOR,
      reason: 'Not treating this patient; ask the responsible consultant.',
    });

    const after = await find('PT-1002');
    expect(after.accessRequests).toHaveLength(0);
    expect(after.grants).toHaveLength(before.grants.length);
    expect(after.events[0]?.detail).toContain('declined');
  });

  it('refuses to decide a request twice', async () => {
    const before = await find('PT-1004');
    const request = before.accessRequests[0];

    await patientsApi.approveRequest({
      patientId: 'PT-1004',
      requestId: request?.id ?? '',
      actor: ACTOR,
    });

    await expect(
      patientsApi.approveRequest({
        patientId: 'PT-1004',
        requestId: request?.id ?? '',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(PatientsError);
  });
});

describe('the seed', () => {
  it('reuses the canonical roster so both portals name the same people', async () => {
    const document = await patientsApi.list();
    expect(document.patients.map((patient) => patient.id)).toEqual([
      'PT-1001',
      'PT-1002',
      'PT-1003',
      'PT-1004',
      'PT-1005',
    ]);
  });

  it('never puts a fixture address on a real domain', async () => {
    const document = await patientsApi.list();
    for (const patient of document.patients) {
      expect(patient.email.endsWith('@example.test')).toBe(true);
    }
  });
});
