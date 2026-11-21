import { Module } from '@nestjs/common';

import { MAILER } from './mail.types';
import { SmtpMailer } from './smtp.mailer';

/**
 * Binds `MAILER` to the SMTP transport (RM M6.1).
 *
 * Unlike the other four kernels this ships a working implementation
 * rather than a stub, because M6.1's verification email is not optional
 * — an account that cannot be verified cannot log in. M19 replaces the
 * binding with the templated, outbox-backed sender.
 */
@Module({
  providers: [{ provide: MAILER, useClass: SmtpMailer }],
  exports: [MAILER],
})
export class MailKernelModule {}
