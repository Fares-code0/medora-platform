import type {
  InvitationActivated,
  InvitationEnrolment,
  InvitationService,
} from '@/types/auth';

import { apiClient } from '../client';

import { toAuthError } from './auth';

/**
 * The HTTP invitation adapter (ADR-035 §5).
 *
 * Its own module rather than more exports on `endpoints/auth.ts`, matching
 * the port's own split: these two routes mint no session, touch no refresh
 * cookie, and are not part of `AuthService`.
 *
 * Both are unauthenticated. The invitation token *is* the credential —
 * the same arrangement `reset-password` has, and safe for the same
 * reason: the raw token exists in one inbox, the server stores a digest,
 * and every failure answers `token_invalid` identically.
 *
 * `toAuthError` is shared with the auth adapter so a `token_invalid` from
 * either surfaces as the same `AuthError` the pages already branch on.
 */

interface Envelope<T> {
  readonly data: T;
}

/** `AdminInvitationService.AcceptedInvitation`, transcribed. */
interface EnrolmentDto {
  readonly nextStep: 'configure-mfa';
  readonly email: string;
  readonly secret: string;
  readonly otpauthUrl: string;
  readonly recoveryCodes: readonly string[];
}

/** `AdminInvitationService.ActivatedInvitation`, transcribed. */
interface ActivatedDto {
  readonly nextStep: 'login';
  readonly email: string;
}

async function mapErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toAuthError(error);
  }
}

export const httpInvitationService: InvitationService = {
  async accept(token: string, password: string): Promise<InvitationEnrolment> {
    return mapErrors(async () => {
      const body = await apiClient.post<Envelope<EnrolmentDto>>(
        '/auth/admin-invitations/accept',
        { token, password },
      );
      return body.data;
    });
  },

  async activate(token: string, code: string): Promise<InvitationActivated> {
    return mapErrors(async () => {
      const body = await apiClient.post<Envelope<ActivatedDto>>(
        '/auth/admin-invitations/activate',
        { token, code },
      );
      return body.data;
    });
  },
};
