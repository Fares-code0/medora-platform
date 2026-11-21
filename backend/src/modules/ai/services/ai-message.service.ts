/**
 * Sending a turn, and streaming the answer (RM M16.4, API §11.3).
 *
 * > "`POST /ai/conversations/{id}/messages` streaming over SSE
 * > (`text/event-stream`: token deltas, final `done` with message
 * > id/status); cancellable → status `stopped`; errors → status
 * > `error`."
 *
 * ## The three outcomes, and why each is persisted where it is
 *
 * An answer ends in exactly one of three states, and the distinction is
 * the whole point of the sub-item:
 *
 * · **`complete`** — the stream ran to its end.
 * · **`stopped`** — the client disconnected mid-stream. The partial
 *   answer is **kept**, not discarded: a doctor who stopped a long
 *   answer having read enough should find what they read still there,
 *   and a thread that silently dropped it would look like the question
 *   was never asked.
 * · **`error`** — the provider failed. The row is kept too, carrying the
 *   message, because an empty thread after a failed send is
 *   indistinguishable from a send that never happened.
 *
 * All three write a row. The assistant's turn is created **before** the
 * first token, empty and `complete`-pending, so there is a row to
 * finish in every branch — including the one where the client vanishes
 * and no code of ours runs again except the `finally`.
 *
 * ## Why the generation is not inside a transaction
 *
 * A provider call takes seconds. Holding a database transaction open
 * across it would pin a connection for the length of a network round
 * trip to a third party, and a slow provider would exhaust the pool —
 * taking down the clinical endpoints, which is a far worse failure than
 * a lost assistant answer. The two writes that bracket the stream are
 * each atomic on their own, and neither leaves a state a reader would
 * misread: an unfinished row reads as an empty answer.
 *
 * ## Fail closed, at send time and not only at creation
 *
 * `reresolve` runs before every generation. A care assignment revoked
 * after the thread was opened, or a record deleted since, refuses the
 * send — because an authorization check that only ran at creation is one
 * that expires silently.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import {
  AI_GATEWAY,
  AiTranscriptLog,
  type AiGatewayPort,
  type AiTurn,
} from '../../../shared/ai';
import { aiContextModeToWire } from '../dto/ai-enums';
import type { AiMessageView } from '../dto/ai.dto';
import type { SendMessageInput } from '../dto/ai.schema';
import { AiConversationRepository } from '../repositories/ai-conversation.repository';
import { AiContextService } from './ai-context.service';
import { buildSystemPrompt, outputTokensFor, titleFromMessage } from './ai-prompt.builder';
import { toMessageView } from './ai-projection';
import { AiSettingsService } from './ai-settings.service';

/**
 * How many past turns are sent to the model.
 *
 * A window rather than the whole thread: a long conversation would
 * otherwise grow the prompt without bound, and the cost of a send would
 * climb with every turn until the provider refused it. Twenty turns is
 * roughly ten exchanges, which is more context than a clinical question
 * usually needs and far short of any provider's window.
 */
const TURN_WINDOW = 20;

/** One SSE frame, as the service emits them. */
export type AiStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | {
      readonly type: 'done';
      readonly messageId: string;
      readonly status: string;
      readonly error: string | null;
    };

@Injectable()
export class AiMessageService {
  constructor(
    private readonly conversations: AiConversationRepository,
    private readonly context: AiContextService,
    private readonly settings: AiSettingsService,
    private readonly transcript: AiTranscriptLog,
    @Inject(AI_GATEWAY) private readonly gateway: AiGatewayPort,
  ) {}

  /**
   * Streams one exchange.
   *
   * An async generator rather than a callback or an `Observable`: the
   * controller has to be able to stop pulling when the client goes away,
   * and `for await … of` with a `return()` on the iterator is what
   * propagates that back through the `finally` below. Nest's own `@Sse`
   * takes an Observable, which is why the controller adapts rather than
   * this returning one — see `ai-message.controller.ts`.
   */
  async *send(
    user: AuthenticatedUser,
    conversationId: string,
    input: SendMessageInput,
    signal: AbortSignal,
  ): AsyncGenerator<AiStreamEvent> {
    const header = await this.conversations.header(user.id, conversationId);
    if (header === null) throw AppException.notFound('Conversation not found');

    // Fail closed, now rather than only at creation — see the header.
    // The stored binding is replayed through the same resolver a fresh
    // one goes through, so a revoked assignment or a deleted entity
    // refuses the send with the same 404/409 it would have refused the
    // creation with.
    const resolved = await this.context.reresolve(user, {
      mode: aiContextModeToWire(header.contextMode),
      patientPublicId: header.patient?.publicId ?? null,
      refId: header.refPublicId,
    });

    const settings = await this.settings.effective(user.id);

    // The doctor's turn, persisted before anything is generated: a
    // question that reached the server is a question that was asked,
    // whatever the provider then does.
    await this.conversations.appendMessage({
      conversationId,
      role: 'USER',
      content: input.content,
      status: 'COMPLETE',
      error: null,
    });

    // The thread's first question names it. `New conversation` is the
    // placeholder `create` wrote; anything else is the doctor's own
    // title and is never overwritten.
    if (header.title === 'New conversation') {
      await this.conversations.update(user.id, conversationId, {
        title: titleFromMessage(input.content, header.title),
      });
    }

    const turns = await this.conversations.turnsFor(conversationId, TURN_WINDOW);

    // The assistant's row, created empty so every branch below has
    // something to finish — including the one where the client vanishes.
    const answer = await this.conversations.appendMessage({
      conversationId,
      role: 'ASSISTANT',
      content: '',
      status: 'COMPLETE',
      error: null,
    });

    const startedAt = Date.now();
    let text = '';
    let status: 'COMPLETE' | 'STOPPED' | 'ERROR' = 'COMPLETE';
    let error: string | null = null;

    try {
      const stream = this.gateway.generate(
        {
          system: buildSystemPrompt(resolved, {
            responseLength: settings.responseLength,
            language: settings.language,
          }),
          turns: turns.map(toGatewayTurn),
          temperature: settings.temperature,
          maxOutputTokens: outputTokensFor(settings.responseLength),
          language: settings.language,
        },
        signal,
      );

      for await (const delta of stream) {
        text += delta.text;
        yield { type: 'delta', text: delta.text };
      }
    } catch (cause) {
      if (signal.aborted) {
        status = 'STOPPED';
      } else {
        status = 'ERROR';
        error = messageOf(cause);
      }
    } finally {
      // The client went away mid-stream. Recognised **here** and not
      // after the loop, which is the subtlety this cost a test to find:
      // when the controller sees a disconnect it calls `return()` on
      // this generator, and a generator returned at a suspended `yield`
      // resumes only its `finally` — never the statement following the
      // loop. Deciding `stopped` out there persisted every interrupted
      // stream as `complete`.
      //
      // The partial answer is kept either way: a doctor who stopped a
      // long answer having read enough should find what they read still
      // there.
      if (signal.aborted && status === 'COMPLETE') status = 'STOPPED';

      // Runs on every path, including the generator being `return()`ed
      // by a controller whose client disconnected — which is the only
      // notification we get in that case.
      const finished = await this.conversations.finishMessage({
        messageId: answer.id,
        content: text,
        status,
        error,
      });

      this.transcript.record({
        conversationId,
        userId: user.id,
        patientBound: resolved.patient !== null,
        contextMode: resolved.mode,
        promptChars: input.content.length,
        completionChars: text.length,
        durationMs: Date.now() - startedAt,
        outcome: finished.status.toLowerCase(),
        ...(error === null ? {} : { errorCode: 'generation_failed' }),
      });
    }

    yield {
      type: 'done',
      messageId: answer.id,
      status: status.toLowerCase(),
      error,
    };
  }

  /** API §11.7's sibling read — the turn as stored, after a stream. */
  async message(user: AuthenticatedUser, conversationId: string, messageId: string): Promise<AiMessageView> {
    const row = await this.conversations.detail(user.id, conversationId);
    if (row === null) throw AppException.notFound('Conversation not found');

    const message = row.messages.find((entry) => entry.id === messageId);
    if (message === undefined) throw AppException.notFound('Message not found');

    return toMessageView(message);
  }
}

function toGatewayTurn(row: { role: string; content: string }): AiTurn {
  return {
    role: row.role === 'ASSISTANT' ? 'assistant' : 'user',
    content: row.content,
  };
}

/**
 * A line the chat can render, from whatever the provider threw.
 *
 * `AppException`'s own message when it is one — the 503 the unconfigured
 * gateway raises says exactly what is wrong — and a generic line
 * otherwise, because a raw provider error can carry request ids, model
 * names and occasionally the prompt back into a surface a patient's
 * doctor is reading.
 */
function messageOf(cause: unknown): string {
  if (cause instanceof AppException) return cause.message;

  return 'The assistant could not answer. Try again.';
}
