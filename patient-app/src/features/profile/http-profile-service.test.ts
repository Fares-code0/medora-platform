import { EndpointNotImplementedError } from '@/api/seam';
import { ResponseContractError } from '@/schemas/envelope';
import { isApiError } from '@/types/api';

import { httpProfileService } from './http-profile-service';

/**
 * The live profile adapter — checklist P-01.
 *
 * The test that matters most is `patient: null`. It is the state every
 * newly registered account is in, it is a **success**, and a client that
 * treated it as an error would log a patient out of an account that is
 * working perfectly.
 */

function stubFetch(responses: readonly Response[]): { calls: { url: string }[] } {
  const calls: { url: string }[] = [];
  let index = 0;
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response as Response);
  });
  return { calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ACCOUNT = {
  id: 'usr_1',
  firstName: 'Sara',
  lastName: 'Al-Amin',
  displayName: 'Sara Al-Amin',
  email: 'sara@example.com',
  phone: '+966501234567',
  emailVerified: true,
  twoFactorEnabled: false,
  avatarUrl: null,
};

const PATIENT = {
  id: 'PT-1042',
  fullName: 'Sara Al-Amin',
  dateOfBirth: '1994-03-11',
  age: 31,
  gender: 'female',
  bloodType: 'O+',
  phone: '+966501234567',
  email: 'sara@example.com',
  address: '22 Rainbow Street, Amman',
  photoUrl: null,
  registeredAt: '2026-01-08T09:12:00.000Z',
  lastVisitAt: '2026-08-02T10:00:00.000Z',
};

const field = (profile: { fields: readonly { id: string; value: string | null }[] }, id: string) =>
  profile.fields.find((entry) => entry.id === id);

describe('a linked account', () => {
  it('reads the clinical record onto the profile', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: PATIENT } })]);

    const profile = await httpProfileService.get();

    expect(profile.displayName).toBe('Sara Al-Amin');
    expect(profile.linkedToClinicalRecord).toBe(true);
    expect(field(profile, 'dateOfBirth')?.value).toBe('1994-03-11');
    expect(field(profile, 'bloodType')?.value).toBe('O+');
    expect(field(profile, 'address')?.value).toBe('22 Rainbow Street, Amman');
  });

  it('reads the wire vocabulary, not the Prisma member names', async () => {
    // ADR-023 §2 makes the mapping the API layer's job and it is done
    // server-side, so this client holds no second mapping table to drift.
    stubFetch([json(200, { data: { account: ACCOUNT, patient: PATIENT } })]);

    const profile = await httpProfileService.get();

    expect(field(profile, 'bloodType')?.value).not.toBe('O_POSITIVE');
  });

  it('calls /me/profile and takes the subject from the token', async () => {
    const { calls } = stubFetch([json(200, { data: { account: ACCOUNT, patient: PATIENT } })]);

    await httpProfileService.get();

    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toMatch(/\/me\/profile$/);
    expect(url.searchParams.has('patientId')).toBe(false);
    expect(url.searchParams.has('userId')).toBe(false);
  });
});

describe('an account with no clinical record', () => {
  it('treats patient: null as a success', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: null } })]);

    // The normal state right after signup (ADR-030 §4). A 404 on one's
    // own profile is indistinguishable from a broken session, and a
    // mobile client's natural response to that is a logout — so the
    // server does not send one and this client does not manufacture one.
    await expect(httpProfileService.get()).resolves.toBeDefined();
  });

  it('reports the link as absent rather than assuming one', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: null } })]);

    const profile = await httpProfileService.get();

    expect(profile.linkedToClinicalRecord).toBe(false);
  });

  it('leaves the clinical fields empty instead of inventing them', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: null } })]);

    const profile = await httpProfileService.get();

    expect(field(profile, 'dateOfBirth')?.value).toBeNull();
    expect(field(profile, 'bloodType')?.value).toBeNull();
    expect(field(profile, 'address')?.value).toBeNull();
  });

  it('still shows the account details, which do exist', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: null } })]);

    const profile = await httpProfileService.get();

    expect(profile.displayName).toBe('Sara Al-Amin');
    expect(field(profile, 'email')?.value).toBe('sara@example.com');
    expect(field(profile, 'phone')?.value).toBe('+966501234567');
  });
});

describe('what the projection must not carry', () => {
  it('strips the clinician-facing fields if a response ever regressed', async () => {
    stubFetch([
      json(200, {
        data: {
          account: ACCOUNT,
          patient: {
            ...PATIENT,
            mrn: 'MRN-9',
            riskLevel: 'high',
            medicalNotes: 'Suspected angina',
            status: 'active',
            assignedDoctorId: 'doc-1',
          },
        },
      }),
    ]);

    const profile = await httpProfileService.get();
    const serialized = JSON.stringify(profile);

    // `medicalNotes` is a clinician's working note; `riskLevel` and
    // `status` are triage classifications whose disclosure without
    // clinical context is a patient-safety question, not a UI decision.
    expect(serialized).not.toContain('Suspected angina');
    expect(serialized).not.toContain('MRN-9');
    expect(serialized).not.toContain('riskLevel');
    expect(serialized).not.toContain('assignedDoctorId');
  });

  it('does not compute an age from the date of birth', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: PATIENT } })]);

    const profile = await httpProfileService.get();

    // `age` is derived server-side and never stored (DB §14.5-6). A
    // client that computed its own could disagree with every clinical
    // screen.
    expect(JSON.stringify(profile)).not.toContain('"age"');
  });
});

describe('editability', () => {
  it('marks the account phone editable and nothing else (P-03)', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: PATIENT } })]);

    const profile = await httpProfileService.get();

    // The split is drawn along which TABLE the field lives in, not along
    // a list this client thinks a patient should own. `users.phone` has
    // a route (`PATCH /me/account`); the clinical fields are RA-030.2's
    // and `email` is excluded from the schema on purpose.
    expect(profile.fields.filter((entry) => entry.editable).map((entry) => entry.id)).toEqual([
      'phone',
    ]);
  });

  it('keeps the sign-in address read-only, whatever the account says', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: PATIENT } })]);

    const profile = await httpProfileService.get();

    // Moving a sign-in address needs a verify-and-notify flow nobody has
    // built; offering the field would be offering the takeover.
    expect(field(profile, 'email')).toMatchObject({ editable: false });
  });

  it('says who owns each field so a read-only row is not a dead end', async () => {
    stubFetch([json(200, { data: { account: ACCOUNT, patient: PATIENT } })]);

    const profile = await httpProfileService.get();

    expect(field(profile, 'bloodType')).toMatchObject({ ownedBy: 'Your clinic' });
    expect(field(profile, 'email')).toMatchObject({ ownedBy: 'Your account' });
  });
});

describe('editing the account phone (P-03)', () => {
  it('PATCHes /me/account and re-reads the profile rather than patching it', async () => {
    const { calls } = stubFetch([
      json(200, { data: { ...ACCOUNT, phone: '+966555000111' } }),
      json(200, {
        data: { account: { ...ACCOUNT, phone: '+966555000111' }, patient: PATIENT },
      }),
    ]);

    const profile = await httpProfileService.update({ phone: '+966555000111' });

    expect(calls[0]?.url).toContain('/me/account');
    // `AccountView` carries neither `displayName` nor the clinical half,
    // so it cannot rebuild this document — and re-reading is the tree's
    // standing rule for a write anyway.
    expect(calls[1]?.url).toContain('/me/profile');
    expect(field(profile, 'phone')?.value).toBe('+966555000111');
  });

  it('refuses a clinical field by name instead of sending it somewhere', async () => {
    const { calls } = stubFetch([json(200, { data: {} })]);

    const error: unknown = await httpProfileService
      .update({ address: '1 New Street' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EndpointNotImplementedError);
    expect((error as EndpointNotImplementedError).dependency).toBe('RA-030.2');
    expect(calls).toHaveLength(0);
  });

  it('refuses a mixed save rather than half-applying it', async () => {
    // Sending the phone and dropping the address would report success
    // for a save the patient watched them type both halves of.
    const { calls } = stubFetch([json(200, { data: {} })]);

    const error: unknown = await httpProfileService
      .update({ phone: '+966555000111', address: '1 New Street' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EndpointNotImplementedError);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a rejected phone as a validation error, not a success', async () => {
    stubFetch([
      json(422, {
        message: 'Validation failed',
        code: 'validation_error',
        fieldErrors: { phone: ['Use at least 7 characters'] },
      }),
    ]);

    const error: unknown = await httpProfileService.update({ phone: '12' }).catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(isApiError(error) && error.kind).toBe('validation');
  });
});

describe('the blocked operations', () => {
  it('refuses an empty save rather than reporting one that sent nothing', async () => {
    // A save that resolves having made no request is how a patient comes
    // to believe a correction was recorded.
    const error: unknown = await httpProfileService.update({}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EndpointNotImplementedError);
    expect((error as EndpointNotImplementedError).dependency).toBe('RA-030.2');
  });

  /**
   * These three used to name `BE-10 / M8` alongside the sessions pair.
   * M8 landed and shipped neither, so the attribution was corrected
   * rather than the assertion deleted: the requirement did not change,
   * the reason it is unmet did. A `BE-nn` code is deliberately not
   * minted — §15.3 runs to BE-17 and defines none of this work.
   */
  it.each([
    ['getPrivacyState', () => httpProfileService.getPrivacyState()],
    ['requestDataExport', () => httpProfileService.requestDataExport()],
    ['requestDeactivation', () => httpProfileService.requestDeactivation()],
  ])('%s refuses without naming a register row that does not cover it', async (_n, call) => {
    const { calls } = stubFetch([json(200, { data: {} })]);

    const error: unknown = await call().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EndpointNotImplementedError);
    const { dependency } = error as EndpointNotImplementedError;
    expect(dependency).toBe('unspecified (API §2)');
    // BE-10 is `/me/profile` and is live; BE-14 is the patient AI
    // surface. Citing either here would point a reader at a row that is
    // not this work.
    expect(dependency).not.toMatch(/BE-\d+/);
    expect(calls).toHaveLength(0);
  });
});

/**
 * Sessions — checklist P-06, live since M8.
 *
 * `GET /me/sessions` and `DELETE /me/sessions/{id}` refused by name
 * until the users-and-account milestone landed. What is asserted here is
 * the mapping and the request, because the screen above them was already
 * built and tested against the port.
 */
describe('the session list', () => {
  const WIRE_SESSION = {
    id: 'ses_1',
    device: 'Pixel 7',
    browser: 'Chrome',
    location: 'Amman, JO',
    ipAddress: '192.0.2.11',
    startedAt: '2026-09-01T08:00:00.000Z',
    lastActiveAt: '2026-09-12T19:04:00.000Z',
    current: true,
  };

  it('reads the caller`s own sessions from /me/sessions', async () => {
    const { calls } = stubFetch([json(200, { data: [WIRE_SESSION] })]);

    const sessions = await httpProfileService.listSessions();

    // No id in the path: the subject is the token (API §2.4).
    expect(calls[0]?.url).toContain('/me/sessions');
    expect(calls[0]?.url).not.toContain('usr_');
    expect(sessions).toEqual([
      {
        id: 'ses_1',
        deviceLabel: 'Pixel 7',
        lastSeenAt: '2026-09-12T19:04:00.000Z',
        current: true,
      },
    ]);
  });

  it('never carries the IP address or the location off the wire', async () => {
    // The screen asks "do I recognise this device". Parsing two more
    // pieces of personal data to render neither would put them in a
    // query cache and one logger call from a crash report (T-04).
    stubFetch([json(200, { data: [WIRE_SESSION] })]);

    const [session] = await httpProfileService.listSessions();

    expect(JSON.stringify(session)).not.toContain('192.0.2.11');
    expect(JSON.stringify(session)).not.toContain('Amman');
  });

  it('falls back to the browser when the device has no name', async () => {
    stubFetch([json(200, { data: [{ ...WIRE_SESSION, device: null }] })]);

    const [session] = await httpProfileService.listSessions();

    expect(session?.deviceLabel).toBe('Chrome');
  });

  it('reports an unnamed session as null rather than inventing English', async () => {
    // Both columns are nullable. A label substituted here would be
    // untranslated copy written in the transport layer — C-09.
    stubFetch([json(200, { data: [{ ...WIRE_SESSION, device: null, browser: null }] })]);

    const [session] = await httpProfileService.listSessions();

    expect(session?.deviceLabel).toBeNull();
  });

  it('fails at the seam when a session is missing its last-active time', async () => {
    stubFetch([json(200, { data: [{ id: 'ses_1', device: null, browser: null, current: false }] })]);

    await expect(httpProfileService.listSessions()).rejects.toBeInstanceOf(ResponseContractError);
  });
});

describe('revoking a session', () => {
  it('DELETEs the one session and sends no body', async () => {
    const { calls } = stubFetch([new Response(null, { status: 204 })]);

    await expect(httpProfileService.revokeSession('ses_2')).resolves.toBeUndefined();

    expect(calls[0]?.url).toContain('/me/sessions/ses_2');
  });

  it('escapes an id rather than pasting it into the path', async () => {
    const { calls } = stubFetch([new Response(null, { status: 204 })]);

    await httpProfileService.revokeSession('a/../b');

    expect(calls[0]?.url).not.toContain('a/../b');
    expect(calls[0]?.url).toContain('a%2F..%2Fb');
  });

  it('surfaces a session that is not the caller`s as not_found, never as success', async () => {
    // The server answers 404 rather than 403: it does not confirm that
    // an id it refuses exists. The client must not swallow that.
    stubFetch([json(404, { message: 'Not found', code: 'not_found' })]);

    const error: unknown = await httpProfileService.revokeSession('ses_9').catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(isApiError(error) && error.kind).toBe('not_found');
  });
});

describe('failures', () => {
  it('fails at the seam when the account block is missing', async () => {
    stubFetch([json(200, { data: { patient: null } })]);

    await expect(httpProfileService.get()).rejects.toBeInstanceOf(ResponseContractError);
  });

  it('surfaces a deleted account as not_found rather than as a shape error', async () => {
    stubFetch([json(404, { message: 'Not found', code: 'not_found' })]);

    const error: unknown = await httpProfileService.get().catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(isApiError(error) && error.kind).toBe('not_found');
  });
});
