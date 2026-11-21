import { useCallback, useEffect, useRef, useState } from 'react';

import { localId } from '../model/store';
import type { AiConversation, AiSettings, ChatMessage, ChatMessageStatus } from '../model/types';
import { aiService } from '../service';

/**
 * Chat session state machine for one open conversation: sending, mock
 * "thinking" latency, simulated token streaming, stop-mid-stream, retry
 * after a failed generation, and regenerate of the last answer. Local
 * message state is authoritative while the conversation is open; every
 * finalized message is pushed to the caller for persistence.
 */

export type ChatPhase = 'idle' | 'thinking' | 'streaming';

const STREAM_TICK_MS = 45;
const STREAM_WORDS_PER_TICK = 3;

const ERROR_LINE = 'The assistant could not generate a response. Retry to try again.';

interface PendingPrompt {
  readonly text: string;
  readonly promptId: string | null;
  readonly attempt: number;
}

export interface UseChatSessionInput {
  readonly conversation: AiConversation;
  readonly settings: AiSettings;
  /** Fire-and-forget persistence of the finalized message list. */
  readonly onPersist: (messages: readonly ChatMessage[], titleHint: string | null) => void;
}

export function useChatSession({ conversation, settings, onPersist }: UseChatSessionInput) {
  const [messages, setMessages] = useState<readonly ChatMessage[]>(conversation.messages);
  const [phase, setPhase] = useState<ChatPhase>('idle');
  const [streamingText, setStreamingText] = useState('');

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const intervalRef = useRef<number | null>(null);
  const generationRef = useRef(0); // bumped to cancel in-flight work
  const lastPromptRef = useRef<PendingPrompt | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;

  const contextRef = useRef(conversation.context);
  contextRef.current = conversation.context;

  const titleHintRef = useRef<string | null>(null);

  const clearStreamTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /* Switching conversations resets the session to the stored messages.
     Guarded by the previous id (not just the dep array) so a StrictMode
     effect re-run for the SAME conversation can't wipe freshly-sent
     messages or cancel an in-flight generation. */
  const conversationId = conversation.id;
  const mountedForIdRef = useRef(conversationId);
  useEffect(() => {
    if (mountedForIdRef.current === conversationId) return;
    mountedForIdRef.current = conversationId;
    generationRef.current += 1;
    clearStreamTimer();
    setPhase('idle');
    setStreamingText('');
    lastPromptRef.current = null;
    titleHintRef.current = null;
    setMessages(conversation.messages);
    // Intentionally keyed by id: the object identity churns on list refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, clearStreamTimer]);

  useEffect(() => () => clearStreamTimer(), [clearStreamTimer]);

  const persist = useCallback((next: readonly ChatMessage[]) => {
    onPersistRef.current(next, titleHintRef.current);
  }, []);

  const appendMessage = useCallback(
    (message: ChatMessage, options?: { persist?: boolean }) => {
      const next = [...messagesRef.current, message];
      setMessages(next);
      if (options?.persist !== false) persist(next);
      return next;
    },
    [persist],
  );

  const finalizeAssistant = useCallback(
    (content: string, status: ChatMessageStatus, error: string | null) => {
      // Invalidate any still-scheduled async work for this generation
      // before committing the message — a finalize is always terminal.
      generationRef.current += 1;
      clearStreamTimer();
      setStreamingText('');
      setPhase('idle');
      appendMessage({
        id: localId('msg'),
        role: 'assistant',
        content,
        createdAt: new Date().toISOString(),
        status,
        error,
      });
    },
    [appendMessage, clearStreamTimer],
  );

  const startStreaming = useCallback(
    (fullText: string, generation: number) => {
      setPhase('streaming');
      const words = fullText.split(' ');
      let index = 0;
      setStreamingText('');
      // The interval clears ITSELF by id — never a later interval's id —
      // so a superseded stream can't leak and re-finalize forever.
      const intervalId = window.setInterval(() => {
        if (generationRef.current !== generation) {
          window.clearInterval(intervalId);
          return;
        }
        index = Math.min(words.length, index + STREAM_WORDS_PER_TICK);
        setStreamingText(words.slice(0, index).join(' '));
        if (index >= words.length) {
          window.clearInterval(intervalId);
          finalizeAssistant(fullText, 'complete', null);
        }
      }, STREAM_TICK_MS);
      intervalRef.current = intervalId;
    },
    [finalizeAssistant],
  );

  const runGeneration = useCallback(
    (prompt: PendingPrompt) => {
      lastPromptRef.current = prompt;
      // New generation token: supersedes any in-flight work (double-send
      // under StrictMode, rapid regenerate) instead of racing it.
      generationRef.current += 1;
      const generation = generationRef.current;
      setPhase('thinking');

      void aiService.generateReply({
        prompt: prompt.text,
        promptId: prompt.promptId,
        context: contextRef.current,
        settings: settingsRef.current,
        attempt: prompt.attempt,
      })
        .then((fullText) => {
          if (generationRef.current !== generation) return; // stopped/switched
          if (settingsRef.current.streaming) startStreaming(fullText, generation);
          else finalizeAssistant(fullText, 'complete', null);
        })
        .catch(() => {
          if (generationRef.current !== generation) return;
          finalizeAssistant('', 'error', ERROR_LINE);
        });
    },
    [finalizeAssistant, startStreaming],
  );

  const send = useCallback(
    (text: string, promptId: string | null = null) => {
      const trimmed = text.trim();
      if (trimmed === '' || phase !== 'idle') return;
      if (conversation.title === 'New conversation' && titleHintRef.current === null) {
        titleHintRef.current = trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
      }
      appendMessage({
        id: localId('msg'),
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
        status: 'complete',
        error: null,
      });
      runGeneration({ text: trimmed, promptId, attempt: 1 });
    },
    [appendMessage, conversation.title, phase, runGeneration],
  );

  /** Stop generation: mid-stream keeps the partial text; mid-thinking discards. */
  const stop = useCallback(() => {
    if (phase === 'idle') return;
    generationRef.current += 1;
    if (phase === 'streaming' && streamingText !== '') {
      finalizeAssistant(streamingText, 'stopped', null);
    } else {
      clearStreamTimer();
      setStreamingText('');
      setPhase('idle');
    }
  }, [clearStreamTimer, finalizeAssistant, phase, streamingText]);

  /** Retry the last failed generation (drops the error bubble; always succeeds). */
  const retry = useCallback(() => {
    const prompt = lastPromptRef.current;
    if (!prompt || phase !== 'idle') return;
    const withoutError = messagesRef.current.filter(
      (message, index) =>
        !(index === messagesRef.current.length - 1 && message.status === 'error'),
    );
    setMessages(withoutError);
    persist(withoutError);
    runGeneration({ ...prompt, attempt: prompt.attempt + 1 });
  }, [persist, phase, runGeneration]);

  /** Re-run the last user prompt, replacing the trailing assistant answer. */
  const regenerate = useCallback(() => {
    if (phase !== 'idle') return;
    const current = messagesRef.current;
    const lastUser = [...current].reverse().find((message) => message.role === 'user');
    if (!lastUser) return;
    const last = current[current.length - 1];
    const trimmedList =
      last !== undefined && last.role === 'assistant' ? current.slice(0, -1) : current;
    setMessages(trimmedList);
    persist(trimmedList);
    runGeneration({
      text: lastUser.content,
      promptId: lastPromptRef.current?.promptId ?? null,
      attempt: 2, // regeneration never re-fails: mirrors a warm retry path
    });
  }, [persist, phase, runGeneration]);

  const lastMessage = messages[messages.length - 1];

  return {
    messages,
    phase,
    streamingText,
    send,
    stop,
    retry,
    regenerate,
    canRetry: phase === 'idle' && lastMessage !== undefined && lastMessage.status === 'error',
    canRegenerate:
      phase === 'idle' &&
      lastMessage !== undefined &&
      lastMessage.role === 'assistant' &&
      lastMessage.status !== 'error' &&
      messages.some((message) => message.role === 'user'),
  } as const;
}
