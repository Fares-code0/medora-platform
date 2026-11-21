import { useState } from 'react';

import { Check, Copy, RefreshCw, RotateCcw } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { MarkdownContent } from '@/components/patterns';
import { Avatar, Button, IconButton, Tooltip } from '@/components/ui';
import { MedoraAiLogo } from '@/shared/components/branding';
import { copyText } from '@/utils/clipboard';
import { cn } from '@/utils/cn';
import { formatTime } from '@/utils/dates';

import type { ChatMessage } from '../model/types';

import { TypingIndicator } from './TypingIndicator';

/**
 * One chat turn. Assistant bubbles carry the accent AI container (UX 1.5:
 * AI surfaces are always visually distinct) and render markdown; user
 * bubbles are plain surface. Message actions (copy / regenerate / retry)
 * live under the bubble; every message shows its timestamp.
 */

function CopyMessageButton({ content }: { content: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copied = state === 'copied';
  const copy = () => {
    const settle = (next: 'copied' | 'failed') => {
      setState(next);
      window.setTimeout(() => setState('idle'), 1_500);
    };
    void copyText(content).then(
      () => settle('copied'),
      () => settle('failed'),
    );
  };
  return (
    <Tooltip content={copied ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy message'}>
      <IconButton
        icon={copied ? Check : Copy}
        size="sm"
        aria-label={
          copied
            ? 'Message copied'
            : state === 'failed'
              ? "Couldn't copy the message — select it instead"
              : 'Copy message to clipboard'
        }
        onClick={copy}
      />
    </Tooltip>
  );
}

export interface ChatMessageBubbleProps {
  message: ChatMessage;
  userName: string;
  /** Regenerate affordance — only offered on the last assistant answer. */
  onRegenerate?: (() => void) | undefined;
  /** Retry affordance — only offered on a failed generation. */
  onRetry?: (() => void) | undefined;
}

export function ChatMessageBubble({
  message,
  userName,
  onRegenerate,
  onRetry,
}: ChatMessageBubbleProps) {
  const isAssistant = message.role === 'assistant';

  if (message.status === 'error') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%]">
          <Alert
            variant="error"
            title="Generation failed"
            actions={
              onRetry ? (
                <Button variant="secondary" size="sm" leadingIcon={RotateCcw} onClick={onRetry}>
                  Retry
                </Button>
              ) : undefined
            }
          >
            {message.error ?? 'The assistant could not generate a response.'}
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex', isAssistant ? 'justify-start' : 'justify-end')}>
      <div className={cn('flex max-w-[85%] items-start gap-3', !isAssistant && 'flex-row-reverse')}>
        {isAssistant ? (
          <span
            aria-hidden="true"
            className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-accent bg-accent-subtle text-accent"
          >
            <MedoraAiLogo className="h-4 w-4" />
          </span>
        ) : (
          <Avatar name={userName} size="sm" decorative className="mt-1 shrink-0" />
        )}

        <div className="min-w-0">
          <div
            className={cn(
              'rounded-surface border px-4 py-3',
              isAssistant ? 'border-accent bg-accent-subtle' : 'border-border bg-surface',
            )}
          >
            {isAssistant ? (
              <MarkdownContent markdown={message.content} />
            ) : (
              <p className="whitespace-pre-wrap text-body-sm text-text-primary">
                {message.content}
              </p>
            )}
            {message.status === 'stopped' ? (
              <p className="mt-2 text-caption italic text-text-secondary">
                Generation stopped by you — the answer above may be incomplete.
              </p>
            ) : null}
          </div>

          <div
            className={cn(
              'mt-1 flex items-center gap-1',
              isAssistant ? 'justify-start' : 'justify-end',
            )}
          >
            <span className="text-caption tabular-nums text-text-tertiary">
              {formatTime(message.createdAt)}
            </span>
            <CopyMessageButton content={message.content} />
            {isAssistant && onRegenerate ? (
              <Tooltip content="Regenerate response">
                <IconButton
                  icon={RefreshCw}
                  size="sm"
                  aria-label="Regenerate this response"
                  onClick={onRegenerate}
                />
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** In-flight assistant bubble: typing dots, then the streaming partial. */
export function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-accent bg-accent-subtle text-accent"
        >
          <MedoraAiLogo className="h-4 w-4" />
        </span>
        <div className="min-w-0 rounded-surface border border-accent bg-accent-subtle px-4 py-3">
          {text === '' ? <TypingIndicator /> : <MarkdownContent markdown={text} />}
        </div>
      </div>
    </div>
  );
}
