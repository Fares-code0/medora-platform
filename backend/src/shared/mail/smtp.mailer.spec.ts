import { once } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { Writable } from 'node:stream';

import pinoHttp, { type Options } from 'pino-http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildLoggerOptions } from '../../common/logging/logger.config';

import { SmtpMailer, smtpDiagnostics } from './smtp.mailer';

/** One line, as pino configured for production would write it. */
function throughProductionLogger(payload: object): Record<string, unknown> {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  const options = buildLoggerOptions({ appEnv: 'production' }).pinoHttp as Options;
  pinoHttp(options, sink).logger.error(payload, 'Mail delivery failed');
  return JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
}

/**
 * A refused recipient never reaches the log (MG §11.6, RM M37.3).
 *
 * nodemailer reports a refused `RCPT TO` with the address in three
 * places — `message`, `response` and `rejected[]` — so logging the error
 * object logged the address `logFailure` says it never records. The
 * relay here is a real socket that answers `RCPT TO` with the 550 a real
 * server sends, quoting the address back, so the error under test is
 * nodemailer's own rather than a hand-built imitation of it.
 */
const ADDRESS = 'khaled.nassar@example.com';

/** EHLO, MAIL FROM, then a 550 for every recipient. */
function refusingRelay(): Server {
  return createServer((socket) => {
    socket.write('220 refusing-relay ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\r\n').filter(Boolean)) {
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250 refusing-relay\r\n');
        else if (verb === 'MAIL') socket.write('250 OK\r\n');
        else if (verb === 'RCPT') {
          const recipient = /<([^>]*)>/.exec(line)?.[1] ?? '';
          socket.write(`550 5.1.1 <${recipient}>: Recipient address rejected\r\n`);
        } else if (verb === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
}

describe('SmtpMailer failure log', () => {
  let relay: Server;
  let port: number;

  beforeAll(async () => {
    relay = refusingRelay();
    relay.listen(0, '127.0.0.1');
    await once(relay, 'listening');
    port = (relay.address() as AddressInfo).port;
  });

  afterAll(async () => {
    relay.close();
    await once(relay, 'close');
  });

  it('records the domain and the SMTP reply code, never the refused address', async () => {
    const mailer = new SmtpMailer({
      env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: port, SMTP_FROM: 'no-reply@medora.test' },
    } as never);

    const logged: unknown[] = [];
    // The logger is private; replacing it is the only way to read what it
    // was given without asserting against a real log stream.
    Object.defineProperty(mailer, 'logger', {
      value: { error: (payload: unknown) => logged.push(payload) },
    });

    const result = await mailer.trySend({ to: ADDRESS, subject: 'Reset', text: 'link' });

    expect(result).toEqual({ ok: false, error: 'smtp-delivery-failed' });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      domain: 'example.com',
      smtp: { errorCode: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' },
    });
    expect(JSON.stringify(logged[0])).not.toContain('khaled');

    // What the log store receives, not what the call site passed: the
    // redaction list censors `name` and `code` one level down, and the
    // first version of this line used both keys.
    const written = JSON.stringify(throughProductionLogger(logged[0] as object));
    expect(written).not.toContain('[redacted]');
    expect(written).toContain('"errorCode":"EENVELOPE"');
    expect(written).not.toContain('khaled');
  });
});

describe('smtpDiagnostics', () => {
  it('keeps only the code, reply code and verb of an error', () => {
    const error = Object.assign(new Error(`rejected: 550 <${ADDRESS}>`), {
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
      response: `550 5.1.1 <${ADDRESS}>`,
      rejected: [ADDRESS],
    });

    expect(smtpDiagnostics(error)).toEqual({
      type: 'Error',
      errorCode: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
    });
  });

  it('names the type of something that is not an Error', () => {
    expect(smtpDiagnostics('boom')).toEqual({ thrown: 'string' });
  });
});
