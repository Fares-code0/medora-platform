import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BellOff,
  ChevronUp,
  EllipsisVertical,
  Info,
  MailOpen,
  Pin,
  PinOff,
  Star,
  Trash2,
} from 'lucide-react';

import { useToast } from '@/app/providers';
import { Skeleton } from '@/components/feedback';
import {
  Avatar,
  Button,
  ConfirmationDialog,
  Dropdown,
  IconButton,
  Tooltip,
  type MenuEntry,
} from '@/components/ui';
import type { ChatMessage, Conversation } from '@/features/shared-domain/conversations';
import { copyText } from '@/utils/clipboard';
import { cn } from '@/utils/cn';
import { dayDiffFromToday, formatDate } from '@/utils/dates';

import {
  useDeleteConversationMutation,
  useDeliverReplyMutation,
  useMarkConversationReadMutation,
  useSendMessageMutation,
  useUpdateConversationMutation,
} from '../api/useMessagingQueries';
import {
  PRESENCE_META,
  contactById,
  conversationContacts,
  conversationTitle,
  type ContactIndex,
} from '../model/selectors';
import { messagingService } from '../service';

import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';

/**
 * Chat workspace — header (participants, presence, thread actions),
 * the message timeline (date separators, author grouping, earlier-
 * message reveal, typing indicator), and the floating composer. Opening
 * a thread marks it read; a successful send triggers the mock
 * counterpart reply behind a typing indicator.
 */

const GROUP_WINDOW_MS = 5 * 60_000;
const VISIBLE_TAIL = 8;
const TYPING_MS = 1_800;

function dayLabel(iso: string): string {
  const diff = dayDiffFromToday(iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  return formatDate(iso);
}

interface TimelineEntry {
  readonly message: ChatMessage;
  readonly grouped: boolean;
  readonly daySeparator: string | null;
}

function buildTimeline(messages: readonly ChatMessage[]): readonly TimelineEntry[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const sameDay =
      previous !== undefined && dayLabel(previous.sentAt) === dayLabel(message.sentAt);
    const grouped =
      previous !== undefined &&
      sameDay &&
      previous.kind === 'text' &&
      message.kind === 'text' &&
      previous.authorId === message.authorId &&
      new Date(message.sentAt).getTime() - new Date(previous.sentAt).getTime() < GROUP_WINDOW_MS;
    return {
      message,
      grouped,
      daySeparator: sameDay ? null : dayLabel(message.sentAt),
    };
  });
}

export interface ChatWorkspaceProps {
  conversation: Conversation;
  /** Contacts by id, from the messaging port (`useContactsQuery`). */
  contacts: ContactIndex;
  onOpenDetails: () => void;
  /** Mobile: return to the conversation list. */
  onBack: (() => void) | null;
  onDeleted: () => void;
}

export function ChatWorkspace({
  conversation,
  contacts: contactIndex,
  onOpenDetails,
  onBack,
  onDeleted,
}: ChatWorkspaceProps) {
  const { toast } = useToast();
  const send = useSendMessageMutation();
  const reply = useDeliverReplyMutation();
  const update = useUpdateConversationMutation();
  const remove = useDeleteConversationMutation();
  const markRead = useMarkConversationReadMutation();

  const [typing, setTyping] = useState(false);
  const [earlierRevealed, setEarlierRevealed] = useState(false);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);
  const markedReadFor = useRef<string | null>(null);

  const contacts = conversationContacts(conversation, contactIndex);
  const direct = contacts.length === 1 ? contacts[0] : undefined;
  const title = conversationTitle(conversation, contactIndex);

  // Opening a thread clears its unread count — once per conversation id
  // (a previous-id ref guards StrictMode re-runs).
  useEffect(() => {
    if (markedReadFor.current === conversation.id) return;
    markedReadFor.current = conversation.id;
    setEarlierRevealed(false);
    setTyping(false);
    if (conversation.unreadCount > 0) markRead.mutate(conversation.id);
  }, [conversation.id, conversation.unreadCount, markRead]);

  useEffect(
    () => () => {
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    },
    [],
  );

  const timeline = useMemo(() => buildTimeline(conversation.messages), [conversation.messages]);
  const hiddenCount = earlierRevealed ? 0 : Math.max(timeline.length - VISIBLE_TAIL, 0);
  const visible = hiddenCount > 0 ? timeline.slice(hiddenCount) : timeline;

  // Keep the newest message in view when the thread grows or typing shows.
  const messageCount = conversation.messages.length;
  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [messageCount, typing, conversation.id, earlierRevealed]);

  const scheduleReply = useCallback(() => {
    setTyping(true);
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      typingTimer.current = null;
      setTyping(false);
      reply.mutate(conversation.id);
    }, TYPING_MS);
  }, [conversation.id, reply]);

  const handleSend = useCallback(
    (body: string, attempt: number) => {
      send.mutate(
        { conversationId: conversation.id, body, attempt },
        {
          onSuccess: scheduleReply,
          onError: () => {
            toast({
              variant: 'error',
              title: 'Message not delivered',
              description: 'Use Retry on the message to send it again.',
            });
          },
        },
      );
    },
    [conversation.id, scheduleReply, send, toast],
  );

  const copyMessage = useCallback(
    (body: string) => {
      void copyText(body)
        .then(() => toast({ variant: 'success', title: 'Message copied' }))
        .catch(() => toast({ variant: 'error', title: "Couldn't copy the message" }));
    },
    [toast],
  );

  const retryMessage = useCallback((body: string) => handleSend(body, 1), [handleSend]);

  const menuEntries: readonly MenuEntry[] = [
    {
      id: 'mark-unread',
      label: 'Mark as unread',
      icon: MailOpen,
      onSelect: () => update.mutate({ id: conversation.id, patch: { unreadCount: 1 } }),
    },
    {
      id: 'pin',
      label: conversation.pinned ? 'Unpin conversation' : 'Pin conversation',
      icon: conversation.pinned ? PinOff : Pin,
      onSelect: () =>
        update.mutate({ id: conversation.id, patch: { pinned: !conversation.pinned } }),
    },
    {
      id: 'mute',
      label: conversation.muted ? 'Unmute' : 'Mute',
      icon: BellOff,
      onSelect: () => update.mutate({ id: conversation.id, patch: { muted: !conversation.muted } }),
    },
    {
      id: 'archive',
      label: conversation.archived ? 'Restore from archive' : 'Archive',
      icon: conversation.archived ? ArchiveRestore : Archive,
      onSelect: () =>
        update.mutate({ id: conversation.id, patch: { archived: !conversation.archived } }),
    },
    { type: 'separator', id: 'sep' },
    {
      id: 'delete',
      label: 'Delete conversation',
      icon: Trash2,
      destructive: true,
      onSelect: () => setConfirmDelete(true),
    },
  ];

  const presenceLine = direct
    ? `${PRESENCE_META[direct.presence].label} · ${direct.department}`
    : `${String(contacts.length + 1)} participants`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-surface px-3 py-2">
        {onBack !== null ? (
          <IconButton
            icon={ArrowLeft}
            size="sm"
            variant="neutral"
            aria-label="Back to conversations"
            onClick={onBack}
          />
        ) : null}
        <Avatar
          name={title}
          size="sm"
          status={direct?.presence === 'online' ? 'online' : undefined}
          decorative
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-semibold text-text-primary">{title}</p>
          <p className="truncate text-caption text-text-tertiary">{presenceLine}</p>
        </div>
        <Tooltip content={conversation.starred ? 'Unstar' : 'Star'}>
          <IconButton
            icon={Star}
            size="sm"
            variant="neutral"
            aria-label={conversation.starred ? 'Unstar conversation' : 'Star conversation'}
            aria-pressed={conversation.starred}
            className={cn(conversation.starred && 'text-warning')}
            onClick={() =>
              update.mutate({ id: conversation.id, patch: { starred: !conversation.starred } })
            }
          />
        </Tooltip>
        <Tooltip content="Conversation details">
          <IconButton
            icon={Info}
            size="sm"
            variant="neutral"
            aria-label="Open conversation details"
            onClick={onOpenDetails}
          />
        </Tooltip>
        <Dropdown
          trigger={
            <IconButton
              icon={EllipsisVertical}
              size="sm"
              variant="neutral"
              aria-label="Conversation actions"
            />
          }
          entries={menuEntries}
          menuLabel="Conversation actions"
        />
      </div>

      {/* ── Timeline ───────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        aria-label={`Messages with ${title}`}
        className="min-h-0 flex-1 overflow-y-auto scroll-smooth bg-background pb-4 [scrollbar-width:thin]"
      >
        {hiddenCount > 0 ? (
          <div className="flex justify-center pt-3">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={ChevronUp}
              loading={earlierLoading}
              onClick={() => {
                setEarlierLoading(true);
                window.setTimeout(() => {
                  setEarlierLoading(false);
                  setEarlierRevealed(true);
                }, 450);
              }}
            >
              Show {hiddenCount} earlier message{hiddenCount === 1 ? '' : 's'}
            </Button>
          </div>
        ) : (
          <p className="pt-4 text-center text-caption text-text-disabled">
            Beginning of the conversation
          </p>
        )}
        {earlierLoading ? (
          <div className="flex flex-col gap-2 px-4 pt-3" aria-hidden="true">
            <Skeleton className="h-10 w-3/5 rounded-surface" />
            <Skeleton className="ms-auto h-10 w-2/5 rounded-surface" />
          </div>
        ) : null}

        {visible.map((entry) => (
          <div key={entry.message.id}>
            {entry.daySeparator !== null ? (
              <div className="my-3 flex items-center gap-3 px-4" role="separator">
                <span className="h-px flex-1 bg-border" />
                <span className="text-caption font-medium text-text-tertiary">
                  {entry.daySeparator}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <MessageBubble
              message={entry.message}
              author={contactById(entry.message.authorId, contactIndex)}
              grouped={entry.grouped}
              onCopy={copyMessage}
              onRetry={retryMessage}
            />
          </div>
        ))}

        {typing ? (
          <div className="mt-3 flex items-center gap-2.5 px-4" role="status">
            <Avatar name={direct?.name ?? title} size="xs" decorative />
            <div className="flex items-center gap-1 rounded-surface rounded-bl-surface border border-border bg-surface px-3 py-2.5">
              <span className="sr-only">{direct?.name ?? 'Participant'} is typing</span>
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 animate-pulse rounded-pill bg-text-tertiary"
              />
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 animate-pulse rounded-pill bg-text-tertiary [animation-delay:150ms]"
              />
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 animate-pulse rounded-pill bg-text-tertiary [animation-delay:300ms]"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Composer ───────────────────────────────────────────── */}
      <MessageComposer
        key={conversation.id}
        draft={conversation.draft}
        sending={send.isPending}
        onSend={(body) => handleSend(body, 0)}
        onDraftChange={(draft) => messagingService.saveDraft(conversation.id, draft)}
      />

      <ConfirmationDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove.mutate(conversation.id);
          onDeleted();
        }}
        title="Delete this conversation?"
        description="The thread and its messages are removed from your workspace. This cannot be undone."
        confirmLabel="Delete conversation"
        tone="destructive"
      />
    </div>
  );
}
