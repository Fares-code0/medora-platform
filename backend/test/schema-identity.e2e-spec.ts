import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

/**
 * Asserts that a write failed on a specific unique index.
 *
 * Prisma reports a unique violation as P2002 and does not put the
 * constraint name in the message, so `rejects.toThrow(/users_email_key/)`
 * would pass for *any* failure. The name is in the driver's original
 * message, and naming it is what makes these tests specific: "the insert
 * failed" is not the claim — "it failed on this index" is.
 */
async function expectUniqueViolation(work: Promise<unknown>, constraint: string): Promise<void> {
  const error = await work.then(
    () => {
      throw new Error(`Expected a unique violation on ${constraint}, but the write succeeded.`);
    },
    (caught: unknown) => caught,
  );

  const known = error as { code?: string; meta?: Record<string, unknown> };
  expect(known.code).toBe('P2002');
  expect(JSON.stringify(known.meta)).toContain(constraint);
}

/**
 * The M5.2 verification — the identity domain (DB §A4–A12).
 *
 * The verify step asks for the unique constraints to be "proven by
 * failing-insert tests", and that phrasing is doing real work: a unique
 * index is trivially present in `information_schema` while being wrong
 * about the thing that matters. `users.email` is `citext`, so the
 * question is not whether an index exists but whether `Doctor@…` and
 * `doctor@…` are the same account. Only an insert answers that.
 *
 * The same reasoning covers the CHECK constraints, which the drift check
 * cannot see at all (ADR-023 §4).
 */
describe('identity domain (RM M5.2)', () => {
  let prisma: PrismaService;
  let roleId: string;

  /** Everything this suite creates lives under one address domain. */
  const DOMAIN = 'identity-spec.test';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Hard delete: this is test cleanup, not application behaviour.
    // `login_events` is SET NULL rather than CASCADE, so it survives the
    // user on purpose and has to be cleared separately.
    await prisma.loginEvent.deleteMany({ where: { attemptedEmail: { endsWith: DOMAIN } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  });

  let counter = 0;
  function newUser(overrides: Record<string, unknown> = {}) {
    counter += 1;
    const n = String(counter);
    return {
      publicId: `usr_spec_${n}`,
      firstName: 'Test',
      lastName: 'Account',
      displayName: 'Dr. Test Account',
      email: `spec-${n}@${DOMAIN}`,
      phone: '+1 555 000 0000',
      roleId,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      ...overrides,
    };
  }

  describe('unique constraints (DB §8)', () => {
    it('treats two spellings of one email as one account (citext)', async () => {
      await prisma.user.create({ data: newUser({ email: `dr.chen@${DOMAIN}` }) });

      // The whole point of citext: without it this insert succeeds and
      // the clinic has two accounts one shift key apart.
      await expectUniqueViolation(
        prisma.user.create({ data: newUser({ email: `Dr.Chen@${DOMAIN}` }) }),
        'users_email_key',
      );
    });

    it('rejects a duplicate username', async () => {
      await prisma.user.create({ data: newUser({ username: 'amelia.chen' }) });

      await expectUniqueViolation(
        prisma.user.create({ data: newUser({ username: 'amelia.chen' }) }),
        'users_username_key',
      );
    });

    it('allows many users with no username at all', async () => {
      // A unique index treats NULLs as distinct; the settings screen
      // makes username optional, so this has to hold.
      await prisma.user.create({ data: newUser() });
      await prisma.user.create({ data: newUser() });

      expect(await prisma.user.count({ where: { email: { endsWith: DOMAIN } } })).toBe(2);
    });

    it('rejects a duplicate public_id', async () => {
      await prisma.user.create({ data: newUser({ publicId: 'usr_fixed' }) });

      await expectUniqueViolation(
        prisma.user.create({ data: newUser({ publicId: 'usr_fixed' }) }),
        'users_public_id_key',
      );
    });

    it('allows only one credential row per user', async () => {
      const user = await prisma.user.create({ data: newUser() });
      await prisma.userCredential.create({
        data: { userId: user.id, passwordHash: '$argon2id$v=19$fake' },
      });

      await expectUniqueViolation(
        prisma.userCredential.create({
          data: { userId: user.id, passwordHash: '$argon2id$v=19$other' },
        }),
        'user_credentials_pkey',
      );
    });

    it('rejects a reused refresh-token hash across users', async () => {
      const a = await prisma.user.create({ data: newUser() });
      const b = await prisma.user.create({ data: newUser() });
      const expiresAt = new Date(Date.now() + 60_000);

      await prisma.session.create({
        data: { userId: a.id, refreshTokenHash: 'shared-hash', expiresAt },
      });

      await expectUniqueViolation(
        prisma.session.create({
          data: { userId: b.id, refreshTokenHash: 'shared-hash', expiresAt },
        }),
        'sessions_refresh_token_hash_key',
      );
    });
  });

  describe('CHECK constraints (DB §9)', () => {
    it('requires the usr_ prefix on public_id', async () => {
      await expect(
        prisma.user.create({ data: newUser({ publicId: 'doctor_amelia' }) }),
      ).rejects.toThrow(/users_public_id_prefix/);
    });

    it('rejects a username the account schema would reject', async () => {
      await expect(prisma.user.create({ data: newUser({ username: 'ab' }) })).rejects.toThrow(
        /users_username_shape/,
      );
      await expect(
        prisma.user.create({ data: newUser({ username: 'has spaces' }) }),
      ).rejects.toThrow(/users_username_shape/);
    });

    it('rejects an OTP channel outside app/sms/email', async () => {
      const user = await prisma.user.create({ data: newUser() });

      await expect(
        prisma.otpCode.create({
          data: {
            userId: user.id,
            codeHash: 'hash',
            channel: 'pigeon',
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toThrow(/otp_codes_channel_check/);
    });

    it('refuses to drive a lockout counter negative', async () => {
      const user = await prisma.user.create({ data: newUser() });
      await prisma.userCredential.create({
        data: { userId: user.id, passwordHash: '$argon2id$v=19$fake' },
      });

      await expect(
        prisma.userCredential.update({
          where: { userId: user.id },
          data: { failedAttempts: { decrement: 1 } },
        }),
      ).rejects.toThrow(/user_credentials_failed_attempts_non_negative/);
    });

    it('refuses a session that expires before it starts', async () => {
      const user = await prisma.user.create({ data: newUser() });

      await expect(
        prisma.session.create({
          data: {
            userId: user.id,
            refreshTokenHash: `hash-${String(counter)}`,
            startedAt: new Date(Date.now() + 60_000),
            expiresAt: new Date(),
          },
        }),
      ).rejects.toThrow(/sessions_expires_after_start/);
    });

    it('refuses a verification token that is already expired', async () => {
      const user = await prisma.user.create({ data: newUser() });

      await expect(
        prisma.verificationToken.create({
          data: {
            userId: user.id,
            kind: 'PASSWORD_RESET',
            tokenHash: `token-${String(counter)}`,
            expiresAt: new Date(Date.now() - 60_000),
          },
        }),
      ).rejects.toThrow(/verification_tokens_expires_after_creation/);
    });
  });

  describe('deletion policy (DB §7, §9)', () => {
    it('takes secrets with the account — sessions and tokens CASCADE', async () => {
      const user = await prisma.user.create({ data: newUser() });
      await prisma.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: `cascade-${String(counter)}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await prisma.verificationToken.create({
        data: {
          userId: user.id,
          kind: 'EMAIL_VERIFICATION',
          tokenHash: `cascade-token-${String(counter)}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.verificationToken.count({ where: { userId: user.id } })).toBe(0);
    });

    it('keeps the login history when the account goes — SET NULL', async () => {
      const user = await prisma.user.create({ data: newUser() });
      const email = user.email;
      await prisma.loginEvent.create({
        data: {
          userId: user.id,
          attemptedEmail: email,
          result: 'FAILED',
          failureCode: 'invalid_credentials',
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      // The trail of a compromised account is worth more than the FK.
      const events = await prisma.loginEvent.findMany({ where: { attemptedEmail: email } });
      expect(events).toHaveLength(1);
      expect(events[0]?.userId).toBeNull();
      expect(events[0]?.failureCode).toBe('invalid_credentials');
    });

    it('records a failed attempt for an address that matches no user', async () => {
      // The event worth keeping most, and the one with no user_id to hang on.
      const event = await prisma.loginEvent.create({
        data: {
          attemptedEmail: `nobody@${DOMAIN}`,
          result: 'FAILED',
          failureCode: 'invalid_credentials',
        },
      });

      expect(event.userId).toBeNull();
    });

    it('hides a soft-deleted user from ordinary reads', async () => {
      const user = await prisma.user.create({ data: newUser() });
      await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

      expect(await prisma.db.user.findFirst({ where: { id: user.id } })).toBeNull();
      expect(await prisma.user.findFirst({ where: { id: user.id } })).not.toBeNull();
    });
  });

  describe('column semantics', () => {
    it('will not create an account without both consent timestamps', async () => {
      // Raw SQL on purpose. Through the client this is a *type* error —
      // `termsAcceptedAt` is required — and a type error proves only that
      // this codebase cannot write such a row. The claim worth making is
      // that the database refuses it, so a migration, a psql session or a
      // future service cannot produce a consent-less account either.
      const user = newUser();

      await expect(
        prisma.$executeRaw`
          INSERT INTO users (public_id, first_name, last_name, display_name, email, phone, role_id)
          VALUES (${user.publicId}, 'Test', 'Account', 'Dr. Test Account',
                  ${user.email}::citext, '+1 555 000 0000', ${roleId}::uuid)
        `,
      ).rejects.toThrow(/terms_accepted_at/);
    });

    it('stores an IP as inet, not as text', async () => {
      const user = await prisma.user.create({ data: newUser() });
      await prisma.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: `inet-${String(counter)}`,
          expiresAt: new Date(Date.now() + 60_000),
          ipAddress: '84.12.9.31',
        },
      });

      const [row] = await prisma.$queryRaw<Array<{ data_type: string }>>`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'ip_address'
      `;

      expect(row?.data_type).toBe('inet');
    });

    it('defaults a new account to active and unverified', async () => {
      const user = await prisma.user.create({ data: newUser() });

      expect(user.status).toBe('ACTIVE');
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.twoFactorEnabled).toBe(false);
    });
  });
});
