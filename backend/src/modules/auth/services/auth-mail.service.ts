import { Inject, Injectable } from '@nestjs/common';

import { ConfigService } from '../../../config';
import { MAILER, type Mailer } from '../../../shared/mail';

/**
 * The messages the auth lifecycle sends (RM M6.1, M6.5, ADR-035, owner decision R3).
 *
 * ## The links point at the frontend, not the API
 *
 * `/verify-email?token=…`, `/reset-password?token=…` and
 * `/accept-invitation?token=…` are React routes
 * (`frontend/src/routes/index.ts`); the pages read `token` from the
 * query string and POST it back. So the base is `APP_PUBLIC_URL` — the
 * API cannot build these links from its own address, which is why that
 * variable exists.
 *
 * ## Composition lives here rather than in the flows
 *
 * Both flows would otherwise assemble a URL from a token and a base,
 * and the day M19 introduces real templates there would be two places
 * to change. This is also the one file that must never log its own
 * arguments: a reset link in a log file is a password reset anyone with
 * log access can complete.
 */
@Injectable()
export class AuthMailService {
  constructor(
    private readonly config: ConfigService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  sendEmailVerification(to: string, rawToken: string, displayName: string): Promise<void> {
    const link = this.link('/verify-email', rawToken);

    return this.mailer.send({
      to,
      subject: 'Verify your Medora account',
      text: [
        `Hello ${displayName},`,
        '',
        'Confirm this address to finish setting up your Medora account:',
        link,
        '',
        'The link is good for 24 hours and can be used once.',
        'If you did not create an account, you can ignore this message.',
      ].join('\n'),
    });
  }

  sendPasswordReset(to: string, rawToken: string, displayName: string): Promise<void> {
    const link = this.link('/reset-password', rawToken);

    return this.mailer.send({
      to,
      subject: 'Reset your Medora password',
      text: [
        `Hello ${displayName},`,
        '',
        'Use this link to choose a new password:',
        link,
        '',
        'The link is good for one hour and can be used once.',
        // The anti-enumeration contract (API §1.7) means this mail is
        // only ever sent to an address that *does* have an account — so
        // "did not request this" is a real signal, and worth saying.
        'If you did not ask to reset your password, tell your administrator:',
        'someone else knows this address is registered.',
      ].join('\n'),
    });
  }

  /**
   * The administrator invitation (ADR-035 §5).
   *
   * Names the role, because "you have been invited to Medora" without
   * saying as what is not enough for the recipient to judge whether they
   * expected it — and an unexpected invitation to an administrator
   * account is exactly the thing they should query rather than accept.
   *
   * States the expiry as a date rather than "7 days", since the mail may
   * sit unread. It carries no password and no capability list: the link
   * is the only credential, and what the account may do is a question for
   * the person who sent it.
   */
  sendAdminInvitation(
    to: string,
    rawToken: string,
    roleLabel: string,
    expiresAt: Date,
  ): Promise<void> {
    const link = this.adminInvitationLink(rawToken);

    return this.mailer.send({
      to,
      subject: 'You have been invited to Medora',
      text: [
        'Hello,',
        '',
        `An administrator has invited you to Medora as ${roleLabel}.`,
        '',
        'Use this link to set your password and configure two-factor',
        'authentication, which this account requires:',
        link,
        '',
        `The invitation expires on ${expiresAt.toISOString().slice(0, 10)} and can be used once.`,
        '',
        'If you were not expecting this, do not use the link — tell the',
        'administrator who runs your Medora clinic.',
      ].join('\n'),
    });
  }

  /**
   * A recovery code was used to sign in (owner decision R3).
   *
   * Sent on every use. It carries no link and no code, and deliberately not
   * the number of codes left: owner decision R2 keeps that count inside the
   * 2FA settings. An unexpected one of these is the signal that someone
   * holds both the password and a printed code.
   */
  sendRecoveryCodeUsed(to: string, displayName: string, usedAt: Date): Promise<void> {
    return this.mailer.send({
      to,
      subject: 'A recovery code was used on your Medora account',
      text: [
        `Hello ${displayName},`,
        '',
        `A recovery code was used to sign in to your Medora account at ${usedAt.toISOString()}.`,
        'Each recovery code works once; that one can no longer be used.',
        '',
        'You can see how many codes you have left in your two-factor settings.',
        '',
        'If this was not you, change your password and contact your',
        'administrator immediately.',
      ].join('\n'),
    });
  }

  /**
   * `URL` rather than string concatenation, so a base with or without a
   * trailing slash produces the same link and the token is percent-
   * encoded. The token is base64url and needs no escaping today; relying
   * on that would be relying on a property of a different file.
   */
  /**
   * The acceptance link, without sending it. The bootstrap command prints
   * it when the operator asks for that rather than for mail
   * (`admin-bootstrap.service.ts`) — the same link the mail carries.
   */
  adminInvitationLink(rawToken: string): string {
    return this.link('/accept-invitation', rawToken);
  }

  private link(path: string, rawToken: string): string {
    const url = new URL(path, this.config.env.APP_PUBLIC_URL);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }
}
