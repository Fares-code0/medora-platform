import 'dotenv/config';

import { Secret, TOTP } from 'otpauth';

import { demoCredentialSettings, demoCredentialsPermitted } from './seed/demo-accounts';

/**
 * `npm run demo:totp` — the demo administrator's current six-digit code.
 *
 * ADR-035 §7 makes `admin@medora.health` sign in with a second factor, and
 * the seed enrols it with a known secret (`seed/demo-accounts.ts`). This
 * prints the code that secret yields now, so a developer can finish the
 * sign-in without an authenticator app. It reads the same
 * `DEMO_ADMIN_TOTP_SECRET` the seed does and knows nothing else: it cannot
 * produce a code for any account whose factor was enrolled through the app.
 *
 * Refuses outside an explicit development environment, for the
 * same reason the seed does.
 *
 * The parameters are `TotpService`'s — SHA-1, six digits, thirty seconds —
 * written out because that service exposes verification, not generation.
 */
if (!demoCredentialsPermitted(process.env['APP_ENV'])) {
  console.error(
    `Refusing: demo credentials exist only with APP_ENV=development (APP_ENV=${process.env['APP_ENV'] ?? 'unset'}).`,
  );
  process.exit(1);
}

const { adminTotpSecret } = demoCredentialSettings(process.env);
const totp = new TOTP({
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  secret: Secret.fromBase32(adminTotpSecret),
});

const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(
  `${totp.generate()}  (admin@medora.health — valid for about ${String(remaining)}s more)`,
);
