import { EndpointNotImplementedError } from '@/api/seam';
import { useT, type MessageKey, type MessageParams } from '@/i18n';
import { isApiError } from '@/types/api';

/**
 * Turns a failed auth call into one sentence for the form.
 *
 * ── Why this branches on `code` and not on status ────────────────────
 * This is the defect the audit tells this client not to inherit
 * (§5, checklist D-02, D-06). A wrong password and an expired session are
 * both `401`. A client that reads only the status treats a typo as a dead
 * session, bounces the patient to a "please sign in again" screen they
 * were already on, and — in the web app's case — triggers a refresh that
 * can revoke the token family.
 *
 * So the mapping is on `code` first, `kind` second.
 *
 * ── Why it returns a KEY and not a sentence (C-09) ───────────────────
 * The same reason `ErrorState`'s `present()` does. This stays a pure
 * function of the error, so it is testable without a render and its
 * tests can assert that two *distinct* failures map to two *distinct*
 * entries — a claim about the catalogue that comparing two identical
 * sentences typed out twice would not catch. `useAuthError()` below is
 * the hook that turns the key into words, and it is what a screen uses.
 *
 * ── Anti-enumeration ─────────────────────────────────────────────────
 * `user_not_found` is deliberately absent. The backend answers a wrong
 * password and an unknown address identically, with identical timing, and
 * a client that renders "no account with that email" would hand back the
 * distinction the server went to trouble to hide.
 *
 * ── Only codes the backend sends (A1) ────────────────────────────────
 * Every `case` below is a code in `AUTH_ERROR_CODES` or
 * `COMMON_ERROR_CODES` (`backend/src/common/errors/error-codes.ts`), and
 * `auth-error-parity.test.ts` fails on one that is not. `account_locked`,
 * `otp_expired` and `token_expired` were mapped here and never sent:
 * lockout is `429 rate_limited` (with `Retry-After`, handled by `kind`),
 * an expired step-up challenge is `401 otp_invalid` (the OTP screen names
 * expiry from its own clock), and an expired reset or verification link
 * is `token_invalid`. A branch for a code that never arrives is copy no
 * patient can read and a test that proves nothing, so they were removed.
 */
/** A catalogue entry, with whatever it needs interpolated into it. */
export interface AuthErrorMessage {
  readonly key: MessageKey;
  readonly params?: MessageParams;
  /**
   * Params whose value is itself a catalogue key — the same arrangement
   * `ErrorState` uses, and for the same reason: this stays a pure
   * function of the error, so it cannot call `t`, and an unbuilt
   * endpoint's `capability` is a key rather than a sentence.
   */
  readonly paramKeys?: Readonly<Record<string, MessageKey>>;
}

export function authErrorKey(error: unknown): AuthErrorMessage {
  if (error instanceof EndpointNotImplementedError) {
    return { key: 'auth.error.unavailable', paramKeys: { capability: error.capability } };
  }
  if (!isApiError(error)) {
    return { key: 'auth.error.unknown' };
  }

  switch (error.code) {
    case 'invalid_credentials':
      return { key: 'auth.error.invalidCredentials' };
    case 'email_unverified':
      return { key: 'auth.error.emailUnverified' };
    case 'account_inactive':
      // 403 from `login.service.ts`: the password was right and the
      // account is not ACTIVE. Without this it read as `forbidden` —
      // "cannot sign in to the patient app" — which names the wrong cause.
      return { key: 'auth.error.accountInactive' };
    case 'otp_invalid':
      return { key: 'auth.error.otpInvalid' };
    case 'token_invalid':
      return { key: 'auth.error.tokenInvalid' };
    case 'email_taken':
      return { key: 'auth.error.emailTaken' };
    case 'weak_password':
      return { key: 'auth.error.weakPassword' };
    default:
      break;
  }

  switch (error.kind) {
    case 'rate_limited':
      return { key: 'auth.error.rateLimited', params: { seconds: error.retryAfterSeconds } };
    case 'validation':
      return { key: 'auth.error.validation' };
    case 'network':
      return { key: 'auth.error.network' };
    case 'timeout':
      return { key: 'auth.error.timeout' };
    case 'auth':
      return { key: 'auth.error.invalidCredentials' };
    case 'forbidden':
      return { key: 'auth.error.forbidden' };
    case 'conflict':
      return { key: 'auth.error.conflict' };
    case 'server':
      return { key: 'auth.error.server', params: { ref: error.ref } };
    case 'not_found':
    case 'cancelled':
      return { key: 'auth.error.unknown' };
  }
}

/**
 * The hook a screen uses: one call, one sentence, in the patient's
 * language. The module was already named for a hook it did not yet
 * export — C-09 makes the name true.
 */
/**
 * Turns one `AuthErrorMessage` into a sentence.
 *
 * Shared rather than inlined at each caller, because there are two and
 * the second one forgot `paramKeys` the moment it existed:
 * `ChangePasswordForm` resolved `params` only, so a banner for an unbuilt
 * endpoint would have rendered the literal `{capability}`. One
 * implementation is the fix — and `resolveAuthMessage` is exported so the
 * form uses this and not a second reading of the same shape.
 */
export function resolveAuthMessage(
  t: ReturnType<typeof useT>,
  message: AuthErrorMessage,
): string {
  return t(message.key, {
    ...message.params,
    ...Object.fromEntries(
      Object.entries(message.paramKeys ?? {}).map(([name, nested]) => [name, t(nested)]),
    ),
  });
}

export function useAuthError(): (error: unknown) => string {
  const t = useT();
  return (error: unknown) => resolveAuthMessage(t, authErrorKey(error));
}

/** Where a failed password change belongs on the form. */
export interface ChangePasswordErrors {
  /** Form-level message, or `null` when every message reached a field. */
  readonly banner: AuthErrorMessage | null;
  readonly fields: {
    /**
     * A catalogue key when this client decided the message, and a plain
     * string when the SERVER did — a `422` carries its own wording, and
     * the backend deliberately words its password policy identically to
     * this client's so the two read as one rule rather than two
     * spellings of it. Translating it here would break that.
     */
    readonly currentPassword?: AuthErrorMessage | string;
    readonly newPassword?: AuthErrorMessage | string;
  };
}

/**
 * Places a failed `POST /me/password` where the patient can act on it.
 *
 * ── Why this is not just `authErrorMessage` ──────────────────────────
 * The two failures this route actually produces are both about a field,
 * and a banner is the wrong place for either. A patient told "that email
 * and password do not match" — `authErrorMessage`'s reading of
 * `invalid_credentials`, correct on the login screen — has no email on
 * this form and would look for a fault that is not there.
 *
 * ── The one that matters ─────────────────────────────────────────────
 * `401 invalid_credentials` here means "the current password you typed is
 * wrong". It does NOT mean the session ended, and nothing in this path
 * may treat it as though it did: `ApiClient` already refuses to refresh
 * on it (`isTokenExpiryError`), and this function is the other half of
 * that promise — it keeps the patient on the form, with the wrong field
 * marked, rather than bouncing them to a sign-in screen they do not need
 * (checklist D-02, T-05).
 *
 * `422 weak_password` arrives with `fieldErrors.newPassword` and is
 * rendered verbatim: the backend deliberately words its policy messages
 * identically to the client's, so the server's answer and the form's own
 * checklist read as one rule rather than two spellings of it.
 */
export function changePasswordErrors(error: unknown): ChangePasswordErrors {
  if (isApiError(error)) {
    if (error.kind === 'auth' && error.code === 'invalid_credentials') {
      return {
        banner: null,
        fields: { currentPassword: { key: 'auth.error.currentPasswordWrong' } },
      };
    }

    if (error.kind === 'validation') {
      const current = error.fieldErrors.currentPassword?.[0];
      const next = error.fieldErrors.newPassword?.[0];
      if (current !== undefined || next !== undefined) {
        return {
          banner: null,
          fields: {
            ...(current === undefined ? {} : { currentPassword: current }),
            ...(next === undefined ? {} : { newPassword: next }),
          },
        };
      }
      // A 422 with no field the form owns — the policy failed somewhere
      // this form cannot point at. Say so rather than marking a guess.
      return { banner: authErrorKey(error), fields: {} };
    }
  }

  return { banner: authErrorKey(error), fields: {} };
}
