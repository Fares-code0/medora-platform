import {
  AuthError,
  type InvitationActivated,
  type InvitationEnrolment,
  type InvitationService,
} from '@/types/auth';

import { withLatency } from './delay';

/**
 * The mock invitation adapter (ADR-035 §5).
 *
 * ## What it does and does not pretend
 *
 * It accepts **one** token, `DEMO_INVITATION_TOKEN`, and refuses every
 * other value with `token_invalid` — the same convention
 * `mockAuthService` uses for reset links, inverted (there the one special
 * value is the *invalid* one, because every other token is expected to
 * work; here the one special value is the only valid one, because an
 * invitation is issued rather than requested).
 *
 * The enrolment it returns carries a **fixed, published secret**. That is
 * safe precisely because it is fixed and published: it protects nothing,
 * grants nothing, and exists so a developer running with
 * `VITE_ENABLE_MOCKS=true` can point a real authenticator at the QR and
 * see the two-phase flow work end to end. A randomly generated one would
 * be no more secure and would make the mock impossible to complete
 * without a phone.
 *
 * `activate` accepts any six digits. The mock has no clock-synchronised
 * TOTP implementation and inventing one would be building the server's
 * job into the fake; the real adapter verifies against the real secret.
 * A developer who wants a genuine round trip runs against the API.
 */

/** The one token this adapter honours. Not a credential — see the header. */
export const DEMO_INVITATION_TOKEN = 'demo-invitation';

/** RFC 4648 base32. Published on purpose; it unlocks nothing. */
const DEMO_SECRET = 'JBSWY3DPEHPK3PXP';

const DEMO_EMAIL = 'invited.admin@medora.health';

export const mockInvitationService: InvitationService = {
  async accept(token: string, password: string): Promise<InvitationEnrolment> {
    void password;
    await withLatency(null);
    if (token !== DEMO_INVITATION_TOKEN) throw new AuthError('token_invalid');

    return {
      nextStep: 'configure-mfa',
      email: DEMO_EMAIL,
      secret: DEMO_SECRET,
      otpauthUrl: `otpauth://totp/Medora:${DEMO_EMAIL}?secret=${DEMO_SECRET}&issuer=Medora`,
      // Ten, matching the server's count, so a page that renders them
      // does not lay out differently against the two adapters.
      recoveryCodes: [
        'a1b2c-3d4e5',
        'f6g7h-8i9j0',
        'k1l2m-3n4o5',
        'p6q7r-8s9t0',
        'u1v2w-3x4y5',
        'z6a7b-8c9d0',
        'e1f2g-3h4i5',
        'j6k7l-8m9n0',
        'o1p2q-3r4s5',
        't6u7v-8w9x0',
      ],
    };
  },

  async activate(token: string, code: string): Promise<InvitationActivated> {
    await withLatency(null);
    if (token !== DEMO_INVITATION_TOKEN) throw new AuthError('token_invalid');
    // Shape only. The real check is RFC 6238 against the stored secret,
    // server-side, and it is not this adapter's to imitate.
    if (!/^\d{6}$/.test(code)) throw new AuthError('otp_invalid');

    return { nextStep: 'login', email: DEMO_EMAIL };
  },
};
