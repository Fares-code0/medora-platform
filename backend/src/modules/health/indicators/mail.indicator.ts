import { Inject, Injectable, Logger } from '@nestjs/common';

import { MAILER, type Mailer } from '../../../shared/mail';
import type { HealthIndicator, ServiceKey, ServiceStatus } from '../health.types';

import { CachedProbe } from './cached-probe';

/**
 * `mail` — the SMTP relay behind `MAILER` (ADR-016 §4, M19).
 *
 * `up` when the relay greets (and accepts the credentials, where set);
 * `down` when it does not; `unconfigured` when the bound mailer has no
 * `verify`. Nothing is sent. Cached for `REMOTE_PROBE_TTL_MS`, because
 * each probe is an SMTP session.
 *
 * `down` is meaningful here even though a delivery failure never fails a
 * request (auth mail is fire-and-forget): it is the only place an
 * operator can see that verification and reset emails are not leaving,
 * which is the silent failure commit 031948c was about.
 */
@Injectable()
export class MailHealthIndicator implements HealthIndicator {
  readonly key: ServiceKey = 'mail';

  private readonly logger = new Logger(MailHealthIndicator.name);
  private readonly cache = new CachedProbe(() => this.probe());

  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  check(): Promise<ServiceStatus> {
    if (this.mailer.verify === undefined) return Promise.resolve('unconfigured');

    return this.cache.check();
  }

  private async probe(): Promise<ServiceStatus> {
    try {
      await this.mailer.verify?.();
      return 'up';
    } catch (error) {
      // Class and code only; a relay's refusal text is not logged, for
      // the reason `SmtpMailer.logFailure` gives.
      this.logger.warn(
        { smtp: { type: error instanceof Error ? error.name : typeof error } },
        'Mail relay health check failed',
      );
      return 'down';
    }
  }
}
