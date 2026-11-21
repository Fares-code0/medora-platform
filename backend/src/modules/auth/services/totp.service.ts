import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';

/**
 * Time-based one-time passwords (RM M6.4, API §2.9).
 *
 * RFC 6238 with the parameters every authenticator app assumes: SHA-1,
 * six digits, a thirty-second step. They are stated rather than left to
 * the library's defaults because changing any of them silently
 * invalidates every already-enrolled device — the app computes a code
 * from parameters baked into the QR it scanned months ago.
 *
 * ## The validation window
 *
 * ±1 step. A user reads a code as it is about to roll over and types it
 * for several seconds; a server clock a few seconds off does the rest.
 * One step either side is the usual compromise: it accepts a 90-second
 * span instead of 30, which multiplies an online guessing attack's odds
 * by three — against a bound of five attempts and a one-in-a-million
 * space, that is a rounding error. Wider windows are where TOTP starts
 * being worth attacking.
 */
const TOTP_CONFIG = {
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
} as const;

const VALIDATION_WINDOW = 1;

/** How many recovery codes an enrolment issues, and how long each is. */
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5;

export interface TotpEnrolment {
  /** base32, shown to a user who cannot scan a QR. */
  readonly secret: string;
  /** `otpauth://totp/…` — what the client renders as a QR (API §2.9). */
  readonly otpauthUrl: string;
  readonly recoveryCodes: readonly string[];
}

@Injectable()
export class TotpService {
  /**
   * A new enrolment.
   *
   * `issuer` and `label` both appear in the authenticator's list, so the
   * account's email goes in the label — a doctor with a personal and a
   * clinic account needs to tell two "Medora" entries apart, and the
   * URI is the only place that distinction can come from.
   */
  enrol(accountEmail: string): TotpEnrolment {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ ...TOTP_CONFIG, issuer: 'Medora', label: accountEmail, secret });

    return {
      secret: secret.base32,
      otpauthUrl: totp.toString(),
      recoveryCodes: generateRecoveryCodes(),
    };
  }

  /**
   * A fresh set of recovery codes, for re-enrollment (owner decision Q7 / R4),
   * which replaces the codes only after the new factor is proved.
   */
  newRecoveryCodes(): string[] {
    return generateRecoveryCodes();
  }

  /**
   * `true` when the code is valid for the secret right now.
   *
   * `otpauth`'s `validate` returns the matching time-step delta or
   * `null`; the delta is deliberately discarded. Acting on it — logging
   * "your clock is 30 seconds slow", say — would leak the server's view
   * of time to an unauthenticated caller.
   */
  verify(secretBase32: string, code: string): boolean {
    let totp: TOTP;
    try {
      totp = new TOTP({ ...TOTP_CONFIG, secret: Secret.fromBase32(secretBase32) });
    } catch {
      // An unparseable stored secret is a corrupt row, not a wrong code.
      // Answered as a failed verification for the same reason
      // `PasswordService` answers false: the endpoint's contract is that
      // every failure looks identical.
      return false;
    }

    return totp.validate({ token: code, window: VALIDATION_WINDOW }) !== null;
  }
}

/**
 * Recovery codes: ten, each ten hex characters split by a dash.
 *
 * The grouping is for the human copying them off a screen. 40 bits each
 * is far beyond guessable and short enough to be transcribed without
 * error, which is the actual constraint — a code nobody can read off a
 * printout is a code nobody keeps.
 */
function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const hex = randomBytes(RECOVERY_CODE_BYTES).toString('hex');
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });
}
