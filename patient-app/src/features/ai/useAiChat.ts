import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { isAssistantUnavailable, isCancelled } from './errors';
import { aiKeys } from './hooks';
import type { AiMessage, AiMode, AiTurnState } from './model/types';
import { aiService } from './service';

/**
 * One conversation's turn machine.
 *
 * ── The rules it keeps ───────────────────────────────────────────────
 *
 * - **One turn at a time.** `busy` is a ref, not state: two taps in the
 *   same frame both see the committed `idle` of a stale render, and a
 *   duplicate send is a second question the patient did not ask. The
 *   composer also disables itself while a turn runs; this is the guard
 *   that does not depend on it.
 * - **Cancelled on unmount.** Leaving the screen aborts the request, so
 *   a reply is not paid for, and not written into state nobody can see.
 * - **The conversation is created on the first message**, not when the
 *   screen opens: an abandoned screen leaves no empty conversation, and
 *   a 503 or an unlinked account is met at the moment it matters.
 * - **Nothing is invented.** The assistant's text is the concatenation of
 *   the server's deltas. A stream that ends without its `done` frame is a
 *   failed turn with a retry, not a finished one.
 * - **The server's escalation is rendered as such.** Either an
 *   `escalation` frame or `escalated: true` on `done` marks the assistant
 *   message `escalated`; this hook never decides that itself.
 *
 * Refusals that mean "this cannot work right now" (503, an unlinked
 * account) take the turn to `unavailable` / leave `error` for the screen
 * and remove the unsent bubble: the message was never accepted, so it is
 * not left on screen looking like part of a conversation.
 */
export interface AiChat {
  readonly messages: readonly AiMessage[];
  readonly turn: AiTurnState;
  /** The last refusal or failure, for the screen to classify (not linked, …). */
  readonly error: unknown;
  readonly conversationId: string | undefined;
  /** False if a turn is already running or the text is empty. */
  readonly send: (content: string) => Promise<boolean>;
  readonly retry: () => void;
  /** Replaces the transcript with a fetched one, once, before anything is sent. */
  readonly hydrate: (messages: readonly AiMessage[]) => void;
}

const FAILED_STATUSES = new Set(['FAILED', 'ERROR', 'failed', 'error']);

export function useAiChat(mode: AiMode, initialConversationId?: string): AiChat {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<readonly AiMessage[]>([]);
  const [turn, setTurn] = useState<AiTurnState>('idle');
  const [error, setError] = useState<unknown>(null);
  const [conversationId, setConversationId] = useState(initialConversationId);

  const idRef = useRef(initialConversationId);
  const busy = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const lastText = useRef<string | null>(null);
  const failedPatientId = useRef<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const nextId = (prefix: string) => `${prefix}-${String((sequence.current += 1))}`;

  const hydrate = useCallback((loaded: readonly AiMessage[]) => {
    if (hydrated.current || busy.current) return;
    hydrated.current = true;
    setMessages(loaded);
  }, []);

  const run = useCallback(
    async (text: string): Promise<boolean> => {
      const content = text.trim();
      if (content === '' || busy.current) return false;
      busy.current = true;
      lastText.current = content;
      failedPatientId.current = null;
      const abort = new AbortController();
      controller.current = abort;

      const patientId = nextId('local-patient');
      const assistantId = nextId('local-assistant');
      const patientMessage: AiMessage = {
        id: patientId,
        author: 'patient',
        body: content,
        at: new Date().toISOString(),
      };

      const alive = () => mounted.current && !abort.signal.aborted;
      const dropUnsent = () => setMessages((current) => current.filter((m) => m.id !== patientId));

      setError(null);
      setTurn('sending');
      setMessages((current) => [...current, patientMessage]);

      try {
        let id = idRef.current;
        if (id === undefined) {
          const created = await aiService.createConversation(mode);
          id = created.id;
          idRef.current = id;
          if (mounted.current) setConversationId(id);
          void queryClient.invalidateQueries({ queryKey: aiKeys.lists() });
        }

        let body = '';
        let escalated = false;
        let finished = false;
        let failed = false;
        const upsertAssistant = () =>
          setMessages((current) => {
            const reply: AiMessage = {
              id: assistantId,
              author: 'assistant',
              body,
              at: new Date().toISOString(),
              ...(escalated ? { escalated: true } : {}),
            };
            const index = current.findIndex((m) => m.id === assistantId);
            return index === -1
              ? [...current, reply]
              : current.map((m, i) => (i === index ? reply : m));
          });

        for await (const event of aiService.sendMessage(id, content, abort.signal)) {
          if (!alive()) return true;
          if (event.type === 'delta') {
            body += event.text;
            setTurn('responding');
            upsertAssistant();
          } else if (event.type === 'escalation') {
            body = event.text;
            escalated = true;
            setTurn('responding');
            upsertAssistant();
          } else {
            finished = true;
            failed = event.error !== null || FAILED_STATUSES.has(event.status);
            if (event.escalated && !escalated) {
              escalated = true;
              if (body !== '') upsertAssistant();
            }
          }
        }

        if (!alive()) return true;
        if (!finished || failed) {
          failedPatientId.current = patientId;
          setTurn('failed');
        } else {
          setTurn('idle');
        }
        void queryClient.invalidateQueries({ queryKey: aiKeys.lists() });
        return true;
      } catch (caught) {
        if (isCancelled(caught) || !mounted.current) return true;
        setError(caught);
        if (isAssistantUnavailable(caught)) {
          dropUnsent();
          setTurn('unavailable');
        } else if (
          typeof caught === 'object' &&
          caught !== null &&
          (caught as { code?: unknown }).code === 'patient_not_linked'
        ) {
          dropUnsent();
          setTurn('idle');
        } else {
          failedPatientId.current = patientId;
          setTurn('failed');
        }
        return true;
      } finally {
        busy.current = false;
      }
    },
    [mode, queryClient],
  );

  const retry = useCallback(() => {
    const text = lastText.current;
    const failedId = failedPatientId.current;
    if (text === null || failedId === null || busy.current) return;
    // The failed bubble, and any partial reply after it, go; `run` adds
    // the question again so the transcript has it exactly once.
    setMessages((current) => {
      const index = current.findIndex((m) => m.id === failedId);
      return index === -1 ? current : current.slice(0, index);
    });
    void run(text);
  }, [run]);

  return { messages, turn, error, conversationId, send: run, retry, hydrate };
}
