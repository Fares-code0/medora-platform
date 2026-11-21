/**
 * Public API — outbound mail (RM M6.1, ADR-025).
 *
 * `SmtpMailer` is deliberately not exported: modules inject `MAILER` and
 * depend on the interface, so M19 can replace the transport without
 * touching a call site.
 */
export { MAILER, type Mailer, type MailMessage, type MailResult } from './mail.types';
export { MailKernelModule } from './mail.module';
