import { memo } from 'react';

import {
  Check,
  CheckCheck,
  Clock3,
  Copy,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';

import { Avatar, IconButton, Tooltip } from '@/components/ui';
import {
  ME_ID,
  type ChatMessage,
  type Contact,
  type MessageStatus,
} from '@/features/shared-domain/conversations';
import { formatDateWith } from '@/i18n';
import { cn } from '@/utils/cn';

import { MessageBody } from './MessageBody';

/**
 * One chat bubble — DS chat pattern for the messaging workspace.
 * Own messages align right in primary-subtle; others align left on
 * surface. Consecutive-author grouping hides the avatar/name repeat.
 * Delivery state renders as tick icons (with text for screen readers);
 * failed messages offer Retry. Memoized — the list re-renders on every
 * keystroke in the composer otherwise.
 */

function timeLabel(iso: string): string {
  return formatDateWith(iso, { hour: '2-digit', minute: '2-digit' });
}

const STATUS_META: Record<
  Exclude<MessageStatus, 'failed'>,
  { readonly label: string; readonly icon: typeof Check; readonly className: string }
> = {
  sending: { label: 'Sending', icon: Clock3, className: 'text-text-disabled' },
  sent: { label: 'Sent', icon: Check, className: 'text-text-tertiary' },
  delivered: { label: 'Delivered', icon: CheckCheck, className: 'text-text-tertiary' },
  read: { label: 'Read', icon: CheckCheck, className: 'text-primary' },
};

export interface MessageBubbleProps {
  message: ChatMessage;
  /** The author, resolved by the workspace from the port's contacts; unused for your own. */
  author: Contact | undefined;
  /** True when the previous message has the same author within 5 min. */
  grouped: boolean;
  onCopy: (body: string) => void;
  onRetry: (body: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  author: resolvedAuthor,
  grouped,
  onCopy,
  onRetry,
}: MessageBubbleProps) {
  const isMine = message.authorId === ME_ID;
  const author = isMine ? undefined : resolvedAuthor;

  if (message.kind === 'system') {
    return (
      <div role="status" className="my-1 flex justify-center px-4">
        <p className="rounded-pill bg-surface-sunken px-3 py-1 text-center text-caption text-text-tertiary">
          {message.body}
        </p>
      </div>
    );
  }

  const failed = message.status === 'failed';
  const status = failed ? null : STATUS_META[message.status];

  return (
    <div
      className={cn(
        'group flex gap-2.5 px-4',
        isMine ? 'flex-row-reverse' : 'flex-row',
        grouped ? 'mt-0.5' : 'mt-3',
      )}
    >
      {!isMine ? (
        <div className="w-7 shrink-0">
          {!grouped ? <Avatar name={author?.name ?? 'Unknown'} size="xs" decorative /> : null}
        </div>
      ) : null}

      <div className={cn('flex max-w-[78%] flex-col md:max-w-[64%]', isMine && 'items-end')}>
        {!grouped && !isMine ? (
          <p className="mb-0.5 px-1 text-caption font-medium text-text-tertiary">
            {author?.name ?? 'Unknown'}
          </p>
        ) : null}

        <div className={cn('flex items-end gap-1.5', isMine && 'flex-row-reverse')}>
          <div
            className={cn(
              /*
               * Both branches carry their own hairline. The received branch
               * already declared `border`, so with the old `--shadow-xs` alias
               * on the shared line it painted a doubled ~2px edge; the sent
               * branch had no border at all and relied on that alias, and
               * primary-subtle on the page background is 1.06:1 — invisible
               * without one. Same treatment as the `failed` state below, which
               * already used a border rather than a shadow.
               */
              'rounded-surface px-3 py-2 text-body-sm leading-[1.45]',
              isMine
                ? 'rounded-br-surface border border-border bg-primary-subtle text-text-primary'
                : 'rounded-bl-surface border border-border bg-surface text-text-primary',
              failed && 'border border-error bg-error-subtle',
            )}
          >
            <MessageBody body={message.body} />

            {(message.attachments ?? []).map((attachment) => (
              <div
                key={attachment.id}
                className={cn(
                  'mt-2 flex items-center gap-2.5 rounded-surface border border-border bg-surface p-2',
                  attachment.kind === 'image' && 'flex-col items-stretch',
                )}
              >
                {attachment.kind === 'image' ? (
                  <div
                    aria-label={`Image attachment ${attachment.name}`}
                    role="img"
                    className="flex h-28 items-center justify-center rounded-surface bg-info-subtle text-info"
                  >
                    <ImageIcon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-surface bg-primary-subtle text-primary">
                    <FileText className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-text-primary">
                    {attachment.name}
                  </p>
                  <p className="text-caption text-text-tertiary">{attachment.sizeLabel}</p>
                </div>
              </div>
            ))}

            <div
              className={cn(
                'mt-1 flex items-center gap-1 text-caption text-text-tertiary',
                isMine && 'justify-end',
              )}
            >
              <span>{timeLabel(message.sentAt)}</span>
              {isMine && status ? (
                <>
                  <status.icon
                    aria-hidden="true"
                    className={cn('h-3.5 w-3.5', status.className)}
                    strokeWidth={2}
                  />
                  <span className="sr-only">{status.label}</span>
                </>
              ) : null}
              {failed ? (
                <span className="inline-flex items-center gap-1 font-medium text-error">
                  <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                  Not delivered
                </span>
              ) : null}
            </div>
          </div>

          {/* Hover actions */}
          <div
            className={cn(
              'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-fast',
              'group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          >
            {failed ? (
              <Tooltip content="Retry">
                <IconButton
                  icon={RefreshCw}
                  size="sm"
                  variant="neutral"
                  aria-label="Retry sending message"
                  onClick={() => onRetry(message.body)}
                />
              </Tooltip>
            ) : null}
            <Tooltip content="Copy">
              <IconButton
                icon={Copy}
                size="sm"
                variant="neutral"
                aria-label="Copy message"
                onClick={() => onCopy(message.body)}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
});
