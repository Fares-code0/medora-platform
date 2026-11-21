/**
 * Prompt and completion logging, under PHI rules (RM M16.1).
 *
 * > "Prompt/completion logging under PHI rules with retention limits."
 *
 * ## What this logs, and what it refuses to
 *
 * **It never logs the prompt or the completion.** That reads like a
 * contradiction with the sub-item until the two constraints are put
 * side by side:
 *
 * · A patient-bound conversation's prompt *is* PHI — M16.3 resolves the
 *   chart into the system prompt, which is the whole point of binding.
 * · MG §11.6 and DB §10 forbid clinical content in application logs,
 *   and `AuditMetadata` says the same in its own type: "field names
 *   belong here; field values do not".
 * · ADR-007's retention policy has `autoPurge: false` — retention
 *   expiry deletes nothing unless an administrator turns it on. So a
 *   log line written today is a log line that is still there in a year.
 *
 * Logging the text would therefore write an unbounded, unpurged copy of
 * chart content into a sink with none of the access controls the chart
 * itself has — and it would do it *outside* the soft-delete of
 * `ai_conversations`, so a doctor deleting a thread would leave the PHI
 * behind in the logs. "Under PHI rules" resolves to: the metadata, not
 * the text.
 *
 * The transcript is not lost by this. `ai_messages` holds every prompt
 * and completion verbatim, inside the database, under the same care
 * scoping and the same soft delete as the rest of the chart (DB §H2).
 * That is the durable record; this is the operational one.
 *
 * ## What it does log
 *
 * Shape and cost — the things an operator actually pages on and a
 * finance owner actually reconciles: which conversation, how long the
 * input was, how long the answer was, how long it took, whether it
 * completed, and whether a patient was bound at all. Character counts
 * rather than the characters.
 *
 * `patientBound` is a boolean and never an id. That one bit is what
 * makes an incident answerable — "were any patient-bound generations in
 * flight during the window" — without the log itself becoming a list of
 * which patients were discussed.
 *
 * ## Retention
 *
 * Stated on the record rather than assumed. `retentionDays` rides on
 * every line so a log pipeline can expire these independently of
 * everything else in the stream; ADR-007 fixes no AI-specific period, so
 * this takes the shortest one that exists — the message retention of the
 * `retention` platform-settings slice — rather than inventing a number.
 * The constant is here, beside the thing it governs, so the day M30's
 * retention sweep runs it has a value to read rather than a TODO.
 */

import { Injectable, Logger } from '@nestjs/common';

/**
 * ADR-007's `messageDays`, the shortest retention period the platform
 * defines. Chosen rather than invented: an AI exchange is a
 * conversation, and the platform already says how long a conversation's
 * operational trace may live.
 */
export const AI_LOG_RETENTION_DAYS = 180;

export interface AiTranscriptRecord {
  /** `ai_conversations.id` — the row that holds the text itself. */
  readonly conversationId: string;
  /** The user who asked. An id, not a name. */
  readonly userId: string;
  /** Whether a patient was bound, never which one. */
  readonly patientBound: boolean;
  readonly contextMode: string;
  /** Characters in, characters out — the shape, not the content. */
  readonly promptChars: number;
  readonly completionChars: number;
  readonly durationMs: number;
  /** `complete` | `stopped` | `error` — M16.4's three outcomes. */
  readonly outcome: string;
  /** Present only when `outcome` is `error`; a code, not a message. */
  readonly errorCode?: string;
}

@Injectable()
export class AiTranscriptLog {
  private readonly logger = new Logger(AiTranscriptLog.name);

  /**
   * One line per generation, at `info`.
   *
   * Not `debug`: an operator reconciling provider spend or answering
   * "was the assistant degraded at 14:00" needs these in production,
   * and a level nobody ships with is a log that does not exist.
   *
   * Each field is copied by name rather than spreading `entry`. The type
   * already forbids text, but a spread would still write whatever a caller
   * smuggled past it with a cast — a `prompt` on the entry would land in the
   * log line. Picking the fields makes "metadata only" a property of this
   * method rather than of every caller's discipline (M37.3).
   */
  record(entry: AiTranscriptRecord): void {
    this.logger.log({
      event: 'ai.generation',
      retentionDays: AI_LOG_RETENTION_DAYS,
      conversationId: entry.conversationId,
      userId: entry.userId,
      patientBound: entry.patientBound,
      contextMode: entry.contextMode,
      promptChars: entry.promptChars,
      completionChars: entry.completionChars,
      durationMs: entry.durationMs,
      outcome: entry.outcome,
      ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
    });
  }
}
