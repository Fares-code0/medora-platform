import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConfigService, type Env } from '../src/config';
import { SmtpMailer } from '../src/shared/mail/smtp.mailer';

import { body, header, SmtpSink } from './support/smtp-sink';

/**
 * Outbound mail over a real SMTP conversation (RM M6.1, ADR-025).
 *
 * The roadmap asks for "mailhog shows the email". Mailhog needs Docker,
 * which this environment does not have; `SmtpSink` is a real SMTP server
 * on a real socket instead, and `SmtpMailer` cannot tell the difference.
 * What is proven here is the part a mocked transport would not prove —
 * that a message is handed to a relay, with the envelope the caller
 * intended.
 */
let sink: SmtpSink;

function mailerFor(port: number, overrides: Partial<Env> = {}): SmtpMailer {
  return new SmtpMailer(
    new ConfigService({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: port,
      SMTP_FROM: 'Medora <no-reply@medora.health>',
      ...overrides,
    } as Env),
  );
}

describe('SMTP delivery', () => {
  beforeAll(async () => {
    sink = await SmtpSink.start();
  });

  afterAll(async () => {
    await sink.stop();
  });

  beforeEach(() => {
    sink.clear();
  });

  it('delivers a message a relay actually receives', async () => {
    await mailerFor(sink.port).send({
      to: 'priya@medora.health',
      subject: 'Verify your Medora account',
      text: 'Open the link to finish signing up.',
    });

    const mail = sink.lastTo('priya@medora.health');
    expect(mail).toBeDefined();
    expect(mail?.from).toBe('no-reply@medora.health');
    expect(header(mail!, 'Subject')).toBe('Verify your Medora account');
    expect(body(mail!)).toContain('Open the link to finish signing up.');
  });

  it('sends the configured From, not the recipient module\'s guess', () => {
    // `SMTP_FROM` is the one address a relay will accept for this domain;
    // a per-call override is how mail starts landing in spam.
    return mailerFor(sink.port, { SMTP_FROM: 'Clinic <clinic@medora.health>' })
      .send({ to: 'a@b.test', subject: 's', text: 't' })
      .then(() => {
        expect(sink.lastTo('a@b.test')?.from).toBe('clinic@medora.health');
      });
  });

  it('sends both parts when an HTML alternative is supplied', async () => {
    await mailerFor(sink.port).send({
      to: 'julian@medora.health',
      subject: 'Reset your password',
      text: 'plain-text-version',
      html: '<p>html-version</p>',
    });

    const raw: string = sink.lastTo('julian@medora.health')?.raw ?? '';
    // Some clients never render the HTML part, so the text one is not optional.
    expect(raw).toContain('multipart/alternative');
    expect(raw).toContain('plain-text-version');
    expect(raw).toContain('html-version');
  });

  it('resolves rather than throwing when the relay is unreachable', async () => {
    // The port is closed. A registration must still succeed: the account
    // was created, and API §1.10's resend is the user's recovery path.
    // See `shared/mail/mail.types.ts` for why this is not fail-loud.
    const closedPort = sink.port + 1;
    await expect(
      mailerFor(closedPort).send({ to: 'nobody@medora.health', subject: 's', text: 't' }),
    ).resolves.toBeUndefined();
  });
});
