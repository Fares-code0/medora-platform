import { createServer, type Server, type Socket } from 'node:net';
import { once } from 'node:events';

/**
 * A minimal in-process SMTP server that captures what was sent.
 *
 * The roadmap's M6.1 verification is "mailhog shows the email". Mailhog
 * needs Docker, and this environment has no daemon (see the M1 gate
 * note) — so rather than record the check as unverifiable, the same
 * property is proven against a real SMTP conversation held over a real
 * socket. `SmtpMailer` cannot tell this apart from mailhog: it speaks
 * ESMTP on a port and gets the same replies.
 *
 * What that buys over a mocked transport is the part most likely to be
 * wrong — that the message is actually handed to a relay, with the
 * recipient and subject the flow intended, rather than constructed and
 * dropped.
 *
 * Only the subset of RFC 5321 nodemailer uses on a plain connection is
 * implemented: EHLO, MAIL FROM, RCPT TO, DATA, QUIT. No AUTH and no
 * STARTTLS are advertised, which is exactly mailhog's default posture.
 */
export interface CapturedMail {
  readonly from: string;
  readonly recipients: readonly string[];
  /** The raw DATA payload — headers and body, CRLF line endings. */
  readonly raw: string;
}

export class SmtpSink {
  private readonly server: Server;
  private readonly captured: CapturedMail[] = [];
  private readonly sockets = new Set<Socket>();

  private constructor() {
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      this.handle(socket);
    });
  }

  static async start(): Promise<SmtpSink> {
    const sink = new SmtpSink();
    sink.server.listen(0, '127.0.0.1');
    await once(sink.server, 'listening');
    return sink;
  }

  get port(): number {
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('SMTP sink is not listening on a TCP port');
    }
    return address.port;
  }

  get messages(): readonly CapturedMail[] {
    return this.captured;
  }

  /** The most recent message to an address, or `undefined`. */
  lastTo(address: string): CapturedMail | undefined {
    return [...this.captured].reverse().find((mail) => mail.recipients.includes(address));
  }

  clear(): void {
    this.captured.length = 0;
  }

  async stop(): Promise<void> {
    // Sockets kept alive by nodemailer's connection pool would hold the
    // server open past `close()`, and Vitest would hang on teardown
    // rather than fail.
    for (const socket of this.sockets) socket.destroy();
    this.server.close();
    await once(this.server, 'close');
  }

  private handle(socket: Socket): void {
    let buffer = '';
    let inData = false;
    let from = '';
    let recipients: string[] = [];
    let data = '';

    socket.setEncoding('utf8');
    socket.write('220 smtp-sink ESMTP ready\r\n');

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      for (;;) {
        const index = buffer.indexOf('\r\n');
        if (index === -1) break;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            this.captured.push({ from, recipients, raw: data });
            from = '';
            recipients = [];
            data = '';
            socket.write('250 2.0.0 Ok: queued\r\n');
          } else {
            // Dot-stuffing: a line that began with '.' was doubled.
            data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          }
          continue;
        }

        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO') {
          // No AUTH, no STARTTLS — mailhog's default, and what keeps
          // nodemailer from trying to authenticate.
          socket.write('250-smtp-sink\r\n250 8BITMIME\r\n');
        } else if (command === 'HELO') {
          socket.write('250 smtp-sink\r\n');
        } else if (command === 'MAIL') {
          from = extractAddress(line);
          socket.write('250 2.1.0 Ok\r\n');
        } else if (command === 'RCPT') {
          recipients.push(extractAddress(line));
          socket.write('250 2.1.5 Ok\r\n');
        } else if (command === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else if (command === 'RSET') {
          from = '';
          recipients = [];
          socket.write('250 2.0.0 Ok\r\n');
        } else {
          socket.write('250 2.0.0 Ok\r\n');
        }
      }
    });

    socket.on('error', () => {
      // A client that disconnects mid-conversation is not a test failure;
      // the assertions are about what was captured, not about the socket.
      socket.destroy();
    });
  }
}

/** `MAIL FROM:<a@b>` → `a@b`. */
function extractAddress(line: string): string {
  const match = /<([^>]*)>/.exec(line);
  return match?.[1] ?? '';
}

/** Reads a header out of a captured message's raw payload. */
export function header(mail: CapturedMail, name: string): string | undefined {
  const pattern = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  return pattern.exec(mail.raw)?.[1]?.trim();
}

/**
 * The body, decoded the way a mail client would.
 *
 * Quoted-printable is not an optional nicety here. Nodemailer encodes
 * text parts that way by default, and its **soft line breaks** wrap at
 * 76 characters — which lands in the middle of an auth link, because
 * `http://localhost:5173/reset-password?token=` plus a 43-character
 * base64url token is longer than that. A test that read the raw payload
 * would extract a truncated token and then assert, quite happily, that
 * it does not match the stored hash.
 */
export function body(mail: CapturedMail): string {
  const separator = mail.raw.indexOf('\r\n\r\n');
  const raw = separator === -1 ? mail.raw : mail.raw.slice(separator + 4);

  if ((header(mail, 'Content-Transfer-Encoding') ?? '').toLowerCase() !== 'quoted-printable') {
    return raw;
  }

  return decodeQuotedPrintable(raw);
}

/** RFC 2045 §6.7 — soft line breaks, then `=XX` escapes. */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}
