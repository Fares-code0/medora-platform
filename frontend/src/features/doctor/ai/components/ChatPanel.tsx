import { useEffect, useRef } from 'react';

import { Chip, Select } from '@/components/ui';

import { useChatSession } from '../hooks/useChatSession';
import { rankPrompts, type AiPrompt } from '../model/prompts';
import {
  AI_CONTEXT_META,
  AI_CONTEXT_MODES,
  contextLabel,
  type AiContextMode,
  type AiConversation,
  type AiSettings,
  type ChatMessage,
} from '../model/types';

import { ChatComposer } from './ChatComposer';
import { ChatMessageBubble, StreamingBubble } from './ChatMessageBubble';
import { PromptCards } from './PromptCards';

/**
 * The open conversation: context-mode bar, message thread (auto-scrolls
 * while streaming), suggested prompts on a fresh chat, and the composer.
 * All generation state lives in useChatSession; persistence is delegated
 * upward so the page owns the mutation.
 */
export interface ChatPanelProps {
  conversation: AiConversation;
  settings: AiSettings;
  userName: string;
  favoritePromptIds: readonly string[];
  onPersist: (messages: readonly ChatMessage[], titleHint: string | null) => void;
  onContextModeChange: (mode: AiContextMode) => void;
  onClearContext: () => void;
  onTogglePromptFavorite: (promptId: string) => void;
  /** A message queued before the conversation existed (prompt card / seed). */
  pendingMessage: { readonly text: string; readonly promptId: string | null } | null;
  onPendingConsumed: () => void;
}

export function ChatPanel({
  conversation,
  settings,
  userName,
  favoritePromptIds,
  onPersist,
  onContextModeChange,
  onClearContext,
  onTogglePromptFavorite,
  pendingMessage,
  onPendingConsumed,
}: ChatPanelProps) {
  const session = useChatSession({ conversation, settings, onPersist });

  /* Auto-send a queued message once the conversation is mounted. The ref
     makes it single-shot: StrictMode re-runs and parent re-renders while
     the prop is still set must not send twice. */
  const { send } = session;
  const pendingSentRef = useRef(false);
  useEffect(() => {
    if (pendingMessage && !pendingSentRef.current) {
      pendingSentRef.current = true;
      send(pendingMessage.text, pendingMessage.promptId);
      onPendingConsumed();
    }
    // Send once per queued message; `send` identity churns with phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage, onPendingConsumed]);

  /* Keep the newest content in view while messages arrive/stream. */
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [session.messages, session.streamingText, session.phase]);

  const hasContext = conversation.context.mode !== 'general';
  const showSuggestions =
    session.phase === 'idle' &&
    session.messages.filter((message) => message.role === 'user').length === 0;

  const usePrompt = (prompt: AiPrompt) => {
    session.send(prompt.message, prompt.id);
  };

  const lastIndex = session.messages.length - 1;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Context bar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <Select
            label="Chat context"
            options={AI_CONTEXT_MODES.map((mode) => ({
              value: mode,
              label: AI_CONTEXT_META[mode].label,
            }))}
            value={conversation.context.mode}
            onChange={(value) => onContextModeChange(value as AiContextMode)}
          />
        </div>
        {hasContext ? (
          <Chip
            label={contextLabel(conversation.context)}
            icon={AI_CONTEXT_META[conversation.context.mode].icon}
            onRemove={onClearContext}
            removeLabel="Detach context from this chat"
          />
        ) : (
          <p className="text-caption text-text-secondary">
            {AI_CONTEXT_META.general.description}
          </p>
        )}
      </div>

      {/* Thread */}
      <div
        className="flex max-h-[58vh] min-h-[20rem] flex-col gap-4 overflow-y-auto rounded-surface border border-border bg-surface-sunken p-4"
        aria-label="Conversation messages"
      >
        {session.messages.map((message, index) => (
          <ChatMessageBubble
            key={message.id}
            message={message}
            userName={userName}
            onRegenerate={
              index === lastIndex && session.canRegenerate ? session.regenerate : undefined
            }
            onRetry={index === lastIndex && session.canRetry ? session.retry : undefined}
          />
        ))}
        {session.phase !== 'idle' ? <StreamingBubble text={session.streamingText} /> : null}
        <div ref={bottomRef} />
      </div>

      {showSuggestions ? (
        <PromptCards
          prompts={rankPrompts(conversation.context.mode).slice(0, 3)}
          favoriteIds={favoritePromptIds}
          onUse={usePrompt}
          onToggleFavorite={onTogglePromptFavorite}
          columns={{ base: 1, md: 3 }}
        />
      ) : null}

      <ChatComposer phase={session.phase} onSend={session.send} onStop={session.stop} />

      <p className="text-caption text-text-secondary">
        Medora AI supports, but never replaces, clinical judgment. Responses are mock data.
      </p>
    </div>
  );
}
