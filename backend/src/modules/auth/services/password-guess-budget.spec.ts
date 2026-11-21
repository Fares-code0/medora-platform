import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { setupTwoFactorSchema } from '../dto/two-factor.schema';

import { CredentialLockoutService } from './credential-lockout.service';
import { PasswordRecoveryService } from './password-recovery.service';
import { ReauthenticationService } from './reauthentication.service';
import { TwoFactorService } from './two-factor.service';

/**
 * Owner decisions D1 and D2 of 2026-11-14
 * (`docs/mfa-recovery/addenda/2026-11-14_OWNER_DECISION_ADDENDUM_D1_D2.md`).
 *
 * D1: a wrong current password at `POST /me/password` or
 * `POST /me/2fa/disable` spends from the account's one guess budget.
 * D2: `POST /me/2fa/setup` checks the current password, against that same
 * budget, before any secret or recovery code exists.
 *
 * No database. The lockout and re-authentication services are the real
 * ones; only the row they count on is held in memory, so "the same
 * counter" is asserted on one object rather than inferred.
 */

const LIMIT = 3;
const LOCKOUT_MINUTES = 15;
const RIGHT = 'correct horse';
const WRONG = 'not the password';

interface Row {
  failedAttempts: number;
  lockedUntil: Date | null;
  passwordHash: string;
  twoFactorEnabled: boolean;
  totpSecretEnc: Uint8Array | null;
  recoveryCodesEnc: Uint8Array | null;
  role: string;
}

let row: Row;

const principal: AuthenticatedUser = {
  id: 'user-1',
  publicId: 'usr_1',
  role: 'doctor',
  permissions: [],
  sessionId: 'session-1',
};

function credentialUpdate({ data }: { data: Record<string, unknown> }): Promise<unknown> {
  for (const [key, value] of Object.entries(data)) {
    if (key === 'failedAttempts' && typeof value === 'object' && value !== null) {
      row.failedAttempts += (value as { increment: number }).increment;
    } else {
      (row as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return Promise.resolve({ failedAttempts: row.failedAttempts });
}

const prisma = {
  db: {
    userCredential: {
      update: vi.fn(credentialUpdate),
      updateMany: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        credentialUpdate({ data }),
      ),
    },
    session: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
  },
  user: {
    update: vi.fn(({ data }: { data: { twoFactorEnabled: boolean } }) => {
      row.twoFactorEnabled = data.twoFactorEnabled;
      return Promise.resolve({});
    }),
  },
  userCredential: { update: vi.fn(credentialUpdate) },
  $transaction: vi.fn((steps: Promise<unknown>[]) => Promise.all(steps)),
};

const identity = {
  findById: vi.fn(() =>
    Promise.resolve({
      id: principal.id,
      publicId: principal.publicId,
      email: 'someone@example.test',
      role: { code: row.role },
      twoFactorEnabled: row.twoFactorEnabled,
      credentials: {
        passwordHash: row.passwordHash,
        lockedUntil: row.lockedUntil,
        totpSecretEnc: row.totpSecretEnc,
        recoveryCodesEnc: row.recoveryCodesEnc,
      },
    }),
  ),
};

// The "hash" is the password itself: what is under test is who checks it
// and what that check spends, not Argon2id.
const passwords = {
  verify: vi.fn((hash: string, candidate: string) => Promise.resolve(hash === candidate)),
  hash: vi.fn((plaintext: string) => Promise.resolve(plaintext)),
};
const sessions = { revoke: vi.fn(), revokeAllFor: vi.fn() };
const audit = { record: vi.fn() };
const activity = { record: vi.fn() };
const policy = {
  current: () => Promise.resolve({ loginAttemptLimit: LIMIT, lockoutMinutes: LOCKOUT_MINUTES }),
};
const ENROLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/Medora:someone?secret=JBSWY3DPEHPK3PXP',
  recoveryCodes: ['aaaaa-bbbbb'],
};
const totp = { enrol: vi.fn(() => ENROLMENT), verify: vi.fn(() => false) };
const envelope = { encrypt: vi.fn((plaintext: string) => Buffer.from(plaintext)) };
const recoveryCodes = { seal: vi.fn(() => Buffer.from('sealed')) };

let lockout: CredentialLockoutService;
let twoFactor: TwoFactorService;
let account: PasswordRecoveryService;
let lockScreen: ReauthenticationService;

beforeEach(() => {
  vi.clearAllMocks();
  row = {
    failedAttempts: 0,
    lockedUntil: null,
    passwordHash: RIGHT,
    twoFactorEnabled: true,
    totpSecretEnc: Buffer.from('enrolled'),
    recoveryCodesEnc: Buffer.from('codes'),
    role: 'doctor',
  };

  lockout = new CredentialLockoutService(prisma as never, policy as never);
  lockScreen = new ReauthenticationService(
    identity as never,
    passwords as never,
    sessions as never,
    lockout,
    audit,
  );
  twoFactor = new TwoFactorService(
    prisma as never,
    identity as never,
    totp as never,
    envelope as never,
    sessions as never,
    recoveryCodes as never,
    lockScreen,
    lockout,
    {} as never,
    audit,
    activity,
  );
  account = new PasswordRecoveryService(
    identity as never,
    {} as never,
    {} as never,
    passwords as never,
    sessions as never,
    lockScreen,
    prisma as never,
    audit,
    activity,
  );
});

/** Status, machine code and every field the error envelope is built from. */
async function refusal(
  attempt: Promise<unknown>,
): Promise<{ status: number; code: string; body: Record<string, unknown> }> {
  try {
    await attempt;
  } catch (error) {
    if (!(error instanceof AppException)) throw error;
    const body = Object.fromEntries(
      Object.entries({
        code: error.code,
        message: error.message,
        detail: error.detail,
        fieldErrors: error.fieldErrors,
        retryAfterSeconds: error.retryAfterSeconds,
      }).filter(([, value]) => value !== undefined),
    );
    return { status: error.getStatus(), code: error.code, body };
  }
  throw new Error('expected a refusal');
}

const changePassword = (current: string) => account.change(principal, current, 'brand new one 9!');
const disable = (password: string) => twoFactor.disable(principal, password);
const setup = (password: string) => twoFactor.setup(principal, password);

function auditActions(): string[] {
  return audit.record.mock.calls.map(([entry]) => (entry as { action: string }).action);
}

describe('D1 — POST /me/password spends from the shared guess budget', () => {
  it('counts a wrong current password and answers 401 invalid_credentials', async () => {
    const answer = await refusal(changePassword(WRONG));

    expect(answer).toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(row.failedAttempts).toBe(1);
    expect(row.passwordHash).toBe(RIGHT);
    expect(auditActions()).toEqual(['auth.reauthenticate_failed']);
  });

  it('locks the account at the limit, ends this session and changes nothing', async () => {
    for (let i = 1; i < LIMIT; i += 1) await refusal(changePassword(WRONG));
    const answer = await refusal(changePassword(WRONG));

    expect(answer).toMatchObject({ status: 429, code: 'rate_limited' });
    expect(answer.body['retryAfterSeconds']).toBe(LOCKOUT_MINUTES * 60);
    expect(row.lockedUntil).not.toBeNull();
    expect(sessions.revoke).toHaveBeenCalledWith(principal.sessionId);
    expect(row.passwordHash).toBe(RIGHT);
  });

  it('clears the counter on a right password, then changes it as before', async () => {
    await refusal(changePassword(WRONG));
    await refusal(changePassword(WRONG));

    await changePassword(RIGHT);

    expect(row.failedAttempts).toBe(0);
    expect(row.passwordHash).toBe('brand new one 9!');
    // Every other session, as before D1; this one is kept.
    const [revokeOthers] = prisma.db.session.updateMany.mock.calls[0] as unknown as [
      { where: { id: unknown } },
    ];
    expect(revokeOthers.where.id).toEqual({ not: 'session-1' });
    expect(sessions.revoke).not.toHaveBeenCalled();
  });

  it('refuses while the account is locked, without checking the password', async () => {
    row.lockedUntil = new Date(Date.now() + 60_000);

    const answer = await refusal(changePassword(RIGHT));

    expect(answer.status).toBe(429);
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(sessions.revoke).toHaveBeenCalledWith(principal.sessionId);
  });
});

describe('D1 — POST /me/2fa/disable spends from the same budget', () => {
  it('counts a wrong password and leaves the factor on', async () => {
    const answer = await refusal(disable(WRONG));

    expect(answer).toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(row.failedAttempts).toBe(1);
    expect(row.twoFactorEnabled).toBe(true);
    expect(sessions.revokeAllFor).not.toHaveBeenCalled();
  });

  it('is one counter with /me/password and the lock screen, not three', async () => {
    await refusal(changePassword(WRONG));
    await refusal(lockScreen.verify(principal, WRONG));
    const answer = await refusal(disable(WRONG));

    expect(row.failedAttempts).toBe(LIMIT);
    expect(answer.status).toBe(429);
    expect(row.lockedUntil).not.toBeNull();
    expect(row.twoFactorEnabled).toBe(true);
  });

  it('on a right password clears the counter and still ends every session (F31 unchanged)', async () => {
    await refusal(disable(WRONG));

    await disable(RIGHT);

    expect(row.failedAttempts).toBe(0);
    expect(row.twoFactorEnabled).toBe(false);
    expect(row.totpSecretEnc).toBeNull();
    expect(sessions.revokeAllFor).toHaveBeenCalledWith(principal.id);
  });

  it('refuses an administrator before the password, spending nothing (ADR-035 §7)', async () => {
    row.role = 'admin';

    const answer = await refusal(disable(WRONG));

    expect(answer.status).toBe(403);
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(row.failedAttempts).toBe(0);
  });

  it('tells the caller nothing beyond the code and a fixed sentence', async () => {
    const answer = await refusal(disable(WRONG));

    expect(Object.keys(answer.body).sort()).toEqual(['code', 'message']);
    expect(JSON.stringify(answer.body)).not.toContain(WRONG);
    expect(JSON.stringify(answer.body)).not.toContain(RIGHT);
  });
});

describe('D2 — POST /me/2fa/setup needs the current password first', () => {
  beforeEach(() => {
    row.twoFactorEnabled = false;
    row.totpSecretEnc = null;
    row.recoveryCodesEnc = null;
  });

  it('refuses a wrong password and generates, stores and returns nothing', async () => {
    const answer = await refusal(setup(WRONG));

    expect(answer).toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(totp.enrol).not.toHaveBeenCalled();
    expect(recoveryCodes.seal).not.toHaveBeenCalled();
    expect(row.totpSecretEnc).toBeNull();
    expect(row.recoveryCodesEnc).toBeNull();
    expect(auditActions()).not.toContain('auth.two_factor_setup');
    expect(row.failedAttempts).toBe(1);
  });

  it('issues the enrolment once the password checks out, and clears the counter', async () => {
    await refusal(setup(WRONG));

    await expect(setup(RIGHT)).resolves.toEqual(ENROLMENT);

    expect(row.failedAttempts).toBe(0);
    expect(row.totpSecretEnc).not.toBeNull();
    expect(row.twoFactorEnabled).toBe(false); // still only `enable` turns it on
    expect(auditActions()).toEqual([
      'auth.reauthenticate_failed',
      'auth.reauthenticate',
      'auth.two_factor_setup',
    ]);
  });

  it('shares the budget with /me/password: the limit locks, ends the session, issues nothing', async () => {
    await refusal(changePassword(WRONG));
    await refusal(changePassword(WRONG));
    const answer = await refusal(setup(WRONG));

    expect(answer.status).toBe(429);
    expect(sessions.revoke).toHaveBeenCalledWith(principal.sessionId);
    expect(totp.enrol).not.toHaveBeenCalled();
  });

  it('refuses while locked, even with the right password', async () => {
    row.lockedUntil = new Date(Date.now() + 60_000);

    expect((await refusal(setup(RIGHT))).status).toBe(429);
    expect(totp.enrol).not.toHaveBeenCalled();
  });

  it('answers 409 for an enrolled account before the password (Q7 / R4 unchanged)', async () => {
    row.twoFactorEnabled = true;
    row.totpSecretEnc = Buffer.from('enrolled');

    const answer = await refusal(setup(WRONG));

    expect(answer.status).toBe(409);
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(row.failedAttempts).toBe(0);
  });

  it.each(['patient', 'doctor', 'admin', 'pharmacy', 'reception', 'laboratory'])(
    'applies to the %s role',
    async (role) => {
      row.role = role;

      expect((await refusal(setup(WRONG))).status).toBe(401);
      expect(totp.enrol).not.toHaveBeenCalled();
      await expect(setup(RIGHT)).resolves.toEqual(ENROLMENT);
    },
  );

  it('the request body must carry a non-empty password', () => {
    expect(setupTwoFactorSchema.safeParse({}).success).toBe(false);
    expect(setupTwoFactorSchema.safeParse({ password: '' }).success).toBe(false);
    expect(setupTwoFactorSchema.safeParse({ password: 'x' }).success).toBe(true);
  });
});

describe('re-enrolment is unchanged (Q7 / R4)', () => {
  it('still needs the password, through the same check, before the current code', async () => {
    const answer = await refusal(twoFactor.startReenrollment(principal, WRONG, '123456'));

    expect(answer).toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(totp.verify).not.toHaveBeenCalled();
    expect(totp.enrol).not.toHaveBeenCalled();
  });
});
