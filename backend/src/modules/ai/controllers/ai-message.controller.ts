import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import { sendMessageSchema, type SendMessageInput } from '../dto/ai.schema';
import { AiMessageService, type AiStreamEvent } from '../services/ai-message.service';

/**
 * Streaming a turn — API §11.3 (RM M16.4).
 *
 * > "`text/event-stream`: token deltas, final `done` with message
 * > id/status … the 30 s client timeout is never hit because the
 * > response streams."
 *
 * ## Why `@Res()` and not Nest's `@Sse()`
 *
 * `@Sse()` adapts an `Observable` and owns the response. Three things
 * this route needs are outside what it offers:
 *
 * · **The refusal has to be an ordinary HTTP status.** A context that
 *   cannot be resolved is a 409 with the standard error envelope
 *   (M16.3's "409, no generation"), and a 409 can only be sent before
 *   the stream's headers go out. Under `@Sse()` the headers are written
 *   when the observable is subscribed, so the refusal would arrive as a
 *   200 carrying an error-shaped event — which no client error handler
 *   would catch and the frontend's `AI_GENERATION_FAILED` path would
 *   never see.
 * · **Disconnect has to reach the generator.** M16.4 requires a
 *   client that goes away mid-stream to persist `stopped`, and the only
 *   notification of that is the **response**'s `close` event (see the
 *   note in the handler — the request's fires on every call and means
 *   something else entirely). Aborting a signal the service is already
 *   holding is what turns that into a `finally` in
 *   `AiMessageService.send`.
 * · **Flushing has to be immediate.** The point of streaming is the
 *   first token arriving before the last one exists.
 *
 * So the route writes the stream itself. Everything about *what* is
 * streamed stays in the service; this file is transport.
 *
 * ## The headers, and why each one is there
 *
 * `Content-Type: text/event-stream` is the contract's. `Cache-Control:
 * no-cache, no-transform` and `X-Accel-Buffering: no` are for what sits
 * between the API and the browser: a proxy that buffers a response until
 * it is complete turns a stream back into a single slow reply, which is
 * exactly the 30-second timeout the verify step says must never be hit.
 * `Connection: keep-alive` for HTTP/1.1 clients.
 */
@Can('ai.use')
@Controller('ai/conversations')
export class AiMessageController {
  constructor(private readonly messages: AiMessageService) {}

  /** API §11.3 — send a turn; the answer streams back. */
  @Post(':conversationId/messages')
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body(zodBody(sendMessageSchema)) body: SendMessageInput,
    @Res() response: Response,
  ): Promise<void> {
    const controller = new AbortController();

    // **`response`, not `request`.** `request.on('close')` fires when the
    // request *body* has been fully read — about a millisecond in, on
    // every single call — so wiring the abort to it cancels every
    // generation the instant it starts, and persists every answer as
    // `stopped`. It reads like the right event and is not.
    //
    // `response.on('close')` is the socket going away. It also fires on
    // a normal `end()`, which is what `completed` distinguishes: without
    // the flag, every successful stream would abort itself one moment
    // after finishing.
    let completed = false;
    response.on('close', () => {
      if (!completed) controller.abort();
    });

    const stream = this.messages.send(user, conversationId, body, controller.signal);

    // The first pull is what runs everything before the provider call:
    // the ownership check, the re-resolution, the persisted question.
    // Doing it *before* any header is written is what lets a refusal be
    // a real 404/409 rather than an error event inside a 200.
    let first: IteratorResult<AiStreamEvent>;
    try {
      first = await stream.next();
    } catch (cause) {
      // Re-thrown for the global filter, which renders the envelope of
      // API §0.3. Nothing has been written to the response yet.
      throw cause instanceof AppException
        ? cause
        : AppException.conflict('The assistant could not start', 'context_unresolved');
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx not to buffer. Without it a proxied deployment
      // streams perfectly in development and arrives all at once in
      // production, which is the failure this header exists for.
      'X-Accel-Buffering': 'no',
    });

    try {
      for (let step = first; step.done !== true; step = await stream.next()) {
        write(response, step.value);
      }

      // The stream ran to its end under its own power. Set before the
      // `finally` closes the response, so the handler above does not
      // read our own `end()` as the client hanging up.
      completed = true;
    } finally {
      // `return()` runs the service generator's `finally`, which is
      // what persists `stopped` when the client vanished. Awaited so
      // the write lands before the socket is released.
      await stream.return(undefined as never).catch(() => undefined);
      response.end();
    }
  }
}

/**
 * One SSE frame.
 *
 * Named events (`event: delta`, `event: done`) rather than one stream of
 * anonymous `data:` lines, so a browser `EventSource` can attach a
 * listener per kind instead of parsing a discriminator out of every
 * payload. The blank line terminates the frame — an SSE frame without
 * it is buffered by the client forever, which looks exactly like a
 * server that stopped responding.
 */
function write(response: Response, event: AiStreamEvent): void {
  const { type, ...payload } = event;

  response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}
