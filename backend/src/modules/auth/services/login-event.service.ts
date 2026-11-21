import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import { LoginResult } from '../../../generated/prisma/enums';

/**
 * The sign-in trail (RM M6.2, DB §A9, API §2.5).
 *
 * **Every attempt writes a row**, successful or not — API §1.2 says so,
 * and M8.5's login-history page reads them. The failures are the
 * valuable half: a burst of them against one address is the signal UX
 * §3.3's anomaly rule looks for, and it exists nowhere else.
 *
 * ## An attempt against an unknown address is still recorded
 *
 * `user_id` is nullable and `attempted_email` is a separate column for
 * exactly this (see `03-identity.prisma`). Someone working through a
 * list of addresses produces no `users` rows at all, and dropping those
 * attempts would hide the one pattern most worth seeing.
 *
 * ## Writing the trail never fails the request
 *
 * The same reasoning as the audit dispatcher's: sign-in must not depend
 * on the history table being writable. A failure is logged and the login
 * proceeds — a login that 500s because a history insert failed has made
 * an observability dependency into an availability one.
 */
export interface LoginAttempt {
  readonly attemptedEmail: string;
  readonly userId?: string | undefined;
  readonly result: LoginResult;
  /** One of the eight `MockAuthErrorCode` values when the result is failed. */
  readonly failureCode?: string | undefined;
  readonly device?: string | undefined;
  readonly ipAddress?: string | undefined;
}

@Injectable()
export class LoginEventService {
  private readonly logger = new Logger(LoginEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(attempt: LoginAttempt): Promise<void> {
    try {
      await this.prisma.db.loginEvent.create({
        data: {
          attemptedEmail: attempt.attemptedEmail,
          result: attempt.result,
          ...(attempt.userId === undefined ? {} : { userId: attempt.userId }),
          ...(attempt.failureCode === undefined ? {} : { failureCode: attempt.failureCode }),
          ...(attempt.device === undefined ? {} : { device: attempt.device }),
          ...(attempt.ipAddress === undefined ? {} : { ipAddress: attempt.ipAddress }),
          // `location` stays null: no source names a geo-IP provider, and
          // a guessed city on a security page is worse than a blank one.
          // ADR-025 carries it; M19's provider decision is where it lands.
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Could not record a login attempt');
    }
  }
}
