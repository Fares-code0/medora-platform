/**
 * Server-sent events, parsed by hand.
 *
 * ── Why this exists, and why it is not `EventSource` ─────────────────
 *
 * React Native has no `EventSource`, and the assistant's reply arrives as
 * `text/event-stream` (API §11.3). So the stream is read over `fetch`
 * and parsed here. Nothing in this file knows what an event MEANS — that
 * is `endpoints/patient-ai.ts`'s job — it only turns bytes into
 * `{ event, data }` frames, following the WHATWG framing rules:
 *
 *  - lines end with `\n`, `\r\n` or `\r`;
 *  - `event:` names the frame (default `message`), `data:` lines are
 *    joined with `\n`, a line starting `:` is a comment (a keep-alive);
 *  - a blank line dispatches the frame; a frame still open when the
 *    stream ends is dropped, because a half-written frame is not a
 *    message the server finished sending.
 *
 * The parser is a plain class with a `push(chunk)` so a test can feed it
 * the awkward cases directly: a frame split mid-line, mid-field and
 * between the `\r` and `\n` of one terminator.
 */

export interface SseFrame {
  readonly event: string;
  readonly data: string;
}

export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  /** A chunk ended on `\r`: a following `\n` belongs to the same terminator. */
  private pendingCr = false;

  /** Feeds decoded text and returns every frame it completed. */
  push(chunk: string): SseFrame[] {
    let text = chunk;
    if (this.pendingCr && text.startsWith('\n')) text = text.slice(1);
    if (text.length > 0) this.pendingCr = false;
    this.buffer += text;

    const frames: SseFrame[] = [];
    for (;;) {
      const match = /\r\n|\n|\r/.exec(this.buffer);
      if (match === null) break;
      // A lone `\r` at the very end might be the first half of `\r\n`.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) {
        this.pendingCr = true;
      }
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const frame = this.line(line);
      if (frame !== null) frames.push(frame);
    }
    return frames;
  }

  private line(line: string): SseFrame | null {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = '';
        return null;
      }
      const frame = { event: this.event === '' ? 'message' : this.event, data: this.data.join('\n') };
      this.event = '';
      this.data = [];
      return frame;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return null;
  }
}

/** The part of a `Response` this reader needs, so a test can hand in less. */
interface StreamableResponse {
  readonly body?: { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | null;
  text(): Promise<string>;
}

/**
 * Every frame of a response, as it arrives.
 *
 * **Streaming is used only where the runtime supports it.** `expo/fetch`
 * (what `ApiClient.openStream` uses) exposes `response.body` as a
 * `ReadableStream`; the stock React Native `fetch` does not. When there
 * is no readable body the whole response text is awaited and parsed
 * after it completes — the reply then appears all at once instead of
 * word by word, which is slower to look at and no less correct.
 *
 * Cancellation: aborting the request's signal rejects the read, and the
 * reader is cancelled in `finally` so the connection is released.
 */
export async function* readSseFrames(response: StreamableResponse): AsyncGenerator<SseFrame> {
  const parser = new SseParser();
  const reader = response.body?.getReader?.();

  if (reader === undefined) {
    for (const frame of parser.push(await response.text())) yield frame;
    // A final frame with no closing blank line is dropped, per the spec.
    return;
  }

  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) yield frame;
    }
    for (const frame of parser.push(decoder.decode())) yield frame;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
