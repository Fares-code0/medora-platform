import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { ConfigService } from '../../config';

import type { Mailer, MailMessage, MailResult } from './mail.types';

/**
 * SMTP delivery (RM M6.1).
 *
 * Points at mailhog in development (`SMTP_HOST=localhost`, `SMTP_PORT=1025`,
 * no authentication; `SMTP_HOST=mailhog` when the API itself runs inside
 * the compose network) and at a real relay everywhere else. The distinction is
 * entirely in configuration: `secure` follows the port and credentials are
 * sent only when both are present, so the same class serves both without a
 * branch on `APP_ENV`.
 *
 * ## Failure is logged, not thrown
 *
 * See the port's own comment. The one thing this class must never do is
 * log the message body: a reset link in a log file is a password reset
 * anyone with log access can complete. `logFailure` records the
 * recipient's domain and the subject, and nothing else.
 */
/** How long the reachability probe waits on the relay at each stage (ms). */
const PROBE_TIMEOUT_MS = 3_000;

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly logger = new Logger(SmtpMailer.name);
  private readonly transporter: Transporter;
  private readonly probe: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const { env } = config;
    const user = env.SMTP_USER ?? '';
    const password = env.SMTP_PASSWORD ?? '';

    this.from = env.SMTP_FROM;
    const options = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 is implicit TLS; everything else negotiates STARTTLS if the
      // server offers it. mailhog offers neither, which is why this is
      // driven by the port rather than hard-coded to true.
      secure: env.SMTP_PORT === 465,
      ...(user.length > 0 && password.length > 0 ? { auth: { user, pass: password } } : {}),
    };

    this.transporter = createTransport(options);
    // The same relay with short timeouts, for `verify` only. nodemailer's
    // defaults wait minutes for a greeting, which is right for delivering
    // a message and wrong for a probe that load balancers poll; changing
    // them on the delivery transport would fail slow-but-working relays.
    this.probe = createTransport({
      ...options,
      connectionTimeout: PROBE_TIMEOUT_MS,
      greetingTimeout: PROBE_TIMEOUT_MS,
      socketTimeout: PROBE_TIMEOUT_MS,
    });
  }

  /** Connects, greets and (when configured) authenticates; sends nothing. */
  async verify(): Promise<void> {
    await this.probe.verify();
  }

  async send(message: MailMessage): Promise<void> {
    await this.trySend(message);
  }

  /**
   * One transport call, two callers.
   *
   * `send` discards the result and `trySend` returns it, so auth mail
   * keeps its fire-and-forget contract while M19.5 can write an honest
   * `sent`/`failed` into `notification_deliveries`. Writing them as two
   * methods over two `sendMail` calls would let the headers, the `from`
   * and the TLS decision drift apart.
   */
  async trySend(message: MailMessage): Promise<MailResult> {
    try {
      const info: unknown = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      });

      const providerRef =
        typeof info === 'object' && info !== null && 'messageId' in info
          ? String(info.messageId)
          : undefined;

      return providerRef === undefined ? { ok: true } : { ok: true, providerRef };
    } catch (error) {
      this.logFailure(message, error);

      // The *reason* travels no further than the class that logged it:
      // an SMTP rejection can quote the recipient back, and
      // `notification_deliveries.error` is read by an administrator, not
      // by the addressee. A stable string is what the column needs.
      return { ok: false, error: 'smtp-delivery-failed' };
    }
  }

  /**
   * The recipient's **domain**, never the address, and never the body.
   * MG §11.6 keeps identifiers out of logs; the domain is enough to tell
   * "our relay is down" from "that one tenant's server is rejecting us".
   *
   * Nor the error itself: a refused recipient comes back in nodemailer's
   * `message` ("all recipients were rejected: 550 5.1.1 <addr>…"), its
   * `response` and its `rejected[]`. The error's code, the server's reply
   * code and the SMTP verb are the diagnostic part, and none quotes data.
   */
  private logFailure(message: MailMessage, error: unknown): void {
    const domain = message.to.split('@')[1] ?? 'unknown';
    this.logger.error(
      { smtp: smtpDiagnostics(error), domain, subject: message.subject },
      'Mail delivery failed',
    );
  }
}

/**
 * The fields of a nodemailer error that identify a failure without quoting it.
 *
 * Spelled `type` and `errorCode`, not `name` and `code`: `redaction.ts`
 * censors those two keys one level down in every logged object, so under
 * `smtp.name` and `smtp.code` the line reached the log store as
 * `[redacted]` — the same trap `error-description.ts` records for `err`.
 */
export function smtpDiagnostics(error: unknown): Record<string, string | number> {
  if (!(error instanceof Error)) return { thrown: typeof error };

  const { code, responseCode, command } = error as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };

  return {
    type: error.name,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    ...(typeof responseCode === 'number' ? { responseCode } : {}),
    ...(typeof command === 'string' ? { command } : {}),
  };
}
