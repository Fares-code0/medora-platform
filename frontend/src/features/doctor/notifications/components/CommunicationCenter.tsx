import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { ArrowLeft, RotateCcw, SendHorizonal } from 'lucide-react';

import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Avatar, Badge, Button, Card, CountBadge, Textarea } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import {
  useConversationsQuery,
  useMarkConversationReadMutation,
  useSendMessageMutation,
} from '../api/useNotificationsQuery';
import { CONVERSATION_KIND_META, type ChatMessage, type Conversation } from '../model/types';

/**
 * Communication center — the Messages tab: colleague direct messages,
 * internal announcements, and system alerts. Mock chat: sending appends
 * the message plus a deterministic auto-reply; messages containing
 * "[fail]" fail once and Retry succeeds. Opening a conversation clears
 * its unread count (which feeds the shell Messages badge).
 */

function ConversationRow({
  conversation,
  active,
  onOpen,
}: {
  conversation: Conversation;
  active: boolean;
  onOpen: (conversation: Conversation) => void;
}) {
  const last = conversation.messages[conversation.messages.length - 1];
  const kindMeta = CONVERSATION_KIND_META[conversation.kind];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(conversation)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex w-full items-start gap-3 rounded-surface border px-3 py-2.5 text-start transition-colors duration-fast',
          active
            ? 'border-primary bg-primary-subtle'
            : 'border-transparent hover:bg-surface-sunken',
        )}
      >
        <Avatar name={conversation.name} size="sm" decorative />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-body-sm font-medium text-text-primary">
              {conversation.name}
            </span>
            {last ? (
              <span className="shrink-0 text-caption text-text-tertiary">
                {relativeDayLabel(last.at)}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-caption text-text-secondary">
              {last ? `${last.from === 'me' ? 'You: ' : ''}${last.body}` : conversation.caption}
            </span>
            {conversation.unreadCount > 0 ? (
              <CountBadge
                count={conversation.unreadCount}
                aria-label={`${String(conversation.unreadCount)} unread messages`}
              />
            ) : null}
          </span>
          <span className="mt-1 inline-flex">
            <Badge variant={conversation.kind === 'direct' ? 'neutral' : 'info'}>
              {conversation.kind === 'direct' ? conversation.caption : kindMeta.label}
            </Badge>
          </span>
        </span>
      </button>
    </li>
  );
}

function MessageBubble({ message, senderName }: { message: ChatMessage; senderName: string }) {
  const mine = message.from === 'me';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[85%] items-start gap-2', mine && 'flex-row-reverse')}>
        {!mine ? <Avatar name={senderName} size="sm" decorative className="mt-1 shrink-0" /> : null}
        <div className="min-w-0">
          <div
            className={cn(
              'rounded-surface border px-3 py-2',
              mine ? 'border-primary bg-primary-subtle' : 'border-border bg-surface',
            )}
          >
            <p className="whitespace-pre-wrap text-body-sm text-text-primary">{message.body}</p>
          </div>
          <p
            className={cn(
              'mt-0.5 text-caption tabular-nums text-text-tertiary',
              mine ? 'text-end' : 'text-start',
            )}
          >
            {formatDate(message.at)} · {formatTime(message.at)}
          </p>
        </div>
      </div>
    </div>
  );
}

export interface CommunicationCenterProps {
  conversationId: string | null;
  onOpenConversation: (conversationId: string | null) => void;
}

export function CommunicationCenter({
  conversationId,
  onOpenConversation,
}: CommunicationCenterProps) {
  const conversationsQuery = useConversationsQuery();
  const markRead = useMarkConversationReadMutation();
  const sendMutation = useSendMessageMutation();

  const [draft, setDraft] = useState('');
  const [failedBody, setFailedBody] = useState<string | null>(null);

  const conversations = conversationsQuery.data ?? [];
  const active =
    conversationId !== null
      ? (conversations.find((conversation) => conversation.id === conversationId) ?? null)
      : null;

  /* Opening a conversation clears its unread count (once per open). */
  const markedRef = useRef<string | null>(null);
  const { mutate: markReadMutate } = markRead;
  useEffect(() => {
    if (active && active.unreadCount > 0 && markedRef.current !== active.id) {
      markedRef.current = active.id;
      markReadMutate(active.id);
    }
  }, [active, markReadMutate]);

  /* Keep the newest message in view. */
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [active?.messages.length, conversationId]);

  const send = (body: string, attempt: number) => {
    const trimmed = body.trim();
    if (trimmed === '' || !active || sendMutation.isPending) return;
    sendMutation.mutate(
      { conversationId: active.id, body: trimmed, attempt },
      {
        onSuccess: () => {
          setDraft('');
          setFailedBody(null);
        },
        onError: () => setFailedBody(trimmed),
      },
    );
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(draft, 1);
    }
  };

  // A failed load is an error — "not connected" when the service has no
  // conversations to offer — and never an empty inbox.
  if (conversationsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load conversations"
        error={conversationsQuery.error}
        onRetry={() => void conversationsQuery.refetch()}
      />
    );
  }

  if (conversationsQuery.isPending) {
    return (
      <div aria-busy="true" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Skeleton className="h-64 w-full rounded-surface" />
        </div>
        <div className="lg:col-span-8">
          <Skeleton className="h-64 w-full rounded-surface" />
        </div>
      </div>
    );
  }

  const listPanel = (
    <Card padding="compact">
      <ul className="flex flex-col gap-1" aria-label="Conversations">
        {conversations.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === conversationId}
            onOpen={(next) => onOpenConversation(next.id)}
          />
        ))}
      </ul>
    </Card>
  );

  const threadPanel = active ? (
    <Card padding="compact" className="flex min-h-0 flex-col">
      <Stack gap={3}>
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={ArrowLeft}
            className="lg:hidden"
            onClick={() => onOpenConversation(null)}
          >
            Back
          </Button>
          <Avatar name={active.name} size="sm" decorative />
          <div className="min-w-0">
            <p className="truncate text-body-sm font-semibold text-text-primary">{active.name}</p>
            <p className="text-caption text-text-tertiary">{active.caption}</p>
          </div>
        </div>

        <div
          className="flex max-h-[46vh] min-h-[16rem] flex-col gap-3 overflow-y-auto p-1"
          aria-label={`Messages with ${active.name}`}
        >
          {active.messages.map((message) => (
            <MessageBubble key={message.id} message={message} senderName={active.name} />
          ))}
          <div ref={bottomRef} />
        </div>

        {failedBody !== null ? (
          <Alert
            variant="error"
            title="Message failed to send"
            actions={
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={RotateCcw}
                onClick={() => send(failedBody, 2)}
              >
                Retry
              </Button>
            }
          >
            The message was not delivered. Retry to send it again.
          </Alert>
        ) : null}

        {active.readOnly ? (
          <p className="rounded-surface bg-surface-sunken px-3 py-2 text-caption text-text-secondary">
            This channel is read-only — replies are disabled for{' '}
            {CONVERSATION_KIND_META[active.kind].label.toLowerCase()}.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Textarea
                label={`Message ${active.name}`}
                placeholder="Write a message… (Enter to send)"
                rows={2}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                disabled={sendMutation.isPending}
              />
            </div>
            <Button
              leadingIcon={SendHorizonal}
              onClick={() => send(draft, 1)}
              disabled={draft.trim() === '' || sendMutation.isPending}
            >
              Send
            </Button>
          </div>
        )}
      </Stack>
    </Card>
  ) : (
    <EmptyState
      title="Select a conversation"
      description="Choose a colleague, the announcements channel, or system alerts."
    />
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className={cn('min-w-0 lg:col-span-4', active !== null && 'hidden lg:block')}>
        {listPanel}
      </div>
      <div className={cn('min-w-0 lg:col-span-8', active === null && 'hidden lg:block')}>
        {threadPanel}
      </div>
    </div>
  );
}
