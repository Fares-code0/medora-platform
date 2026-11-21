import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { MessageSquareDashed, Pin, Star } from 'lucide-react';

import { EmptyState, Skeleton } from '@/components/feedback';
import { Avatar, CountBadge, SearchInput } from '@/components/ui';
import type { Conversation } from '@/features/shared-domain/conversations';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';
import { relativeDayLabel } from '@/utils/dates';

import {
  FOLDER_LABELS,
  conversationContacts,
  type ContactIndex,
  conversationPreview,
  conversationTitle,
  messageMatchCount,
  type MessagingFolder,
} from '../model/selectors';

/**
 * Conversation list pane — the middle column of the workspace. Rich
 * previews (title, snippet/draft, recency, unread badge, pin/star
 * marks, online dot), a search box that also matches message bodies,
 * and roving Arrow-key navigation across the list (a11y).
 */

export interface ConversationListPaneProps {
  conversations: readonly Conversation[];
  /** Contacts by id, from the messaging port (`useContactsQuery`). */
  contacts: ContactIndex;
  folder: MessagingFolder;
  activeId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  loading: boolean;
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-2.5 rounded-surface p-2.5">
          <Skeleton className="h-8 w-8 rounded-pill" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="mt-1.5 h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationListPane({
  conversations,
  contacts,
  folder,
  activeId,
  query,
  onQueryChange,
  loading,
}: ConversationListPaneProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-row]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.findIndex((item) => item === document.activeElement);
    const next =
      event.key === 'ArrowDown'
        ? Math.min(current + 1, items.length - 1)
        : Math.max(current - 1, 0);
    items[next]?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border p-2.5">
        <SearchInput
          aria-label="Search conversations and messages"
          placeholder="Search messages…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onClear={() => onQueryChange('')}
        />
      </div>

      {loading ? (
        <ListSkeleton />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquareDashed}
          tone="info"
          title={query !== '' ? 'No matches' : `Nothing in ${FOLDER_LABELS[folder]}`}
          description={
            query !== ''
              ? 'No conversation or message matches this search.'
              : 'Conversations will appear here as your care team writes to you.'
          }
          className="py-10"
        />
      ) : (
        <div
          ref={listRef}
          role="list"
          aria-label={`${FOLDER_LABELS[folder]} conversations`}
          onKeyDown={onListKeyDown}
          className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:thin]"
        >
          {conversations.map((conversation) => {
            const contact = conversationContacts(conversation, contacts)[0];
            const active = conversation.id === activeId;
            const matches = messageMatchCount(conversation, query.trim());
            return (
              <a
                key={conversation.id}
                data-row
                role="listitem"
                href={routes.doctor.conversation(conversation.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-surface p-2.5 text-start transition-colors duration-fast',
                  active
                    ? 'bg-primary-subtle shadow-[inset_2px_0_0_0_var(--color-primary)]'
                    : 'hover:bg-surface-sunken',
                )}
              >
                <Avatar
                  name={conversationTitle(conversation, contacts)}
                  size="sm"
                  status={contact?.presence === 'online' ? 'online' : undefined}
                  decorative
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-body-sm text-text-primary',
                        conversation.unreadCount > 0 ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {conversationTitle(conversation, contacts)}
                    </p>
                    {conversation.pinned ? (
                      <Pin
                        aria-label="Pinned"
                        className="h-3 w-3 shrink-0 text-text-tertiary"
                        strokeWidth={2}
                      />
                    ) : null}
                    {conversation.starred ? (
                      <Star
                        aria-label="Starred"
                        className="h-3 w-3 shrink-0 fill-warning text-warning"
                        strokeWidth={2}
                      />
                    ) : null}
                    <span className="shrink-0 text-caption text-text-tertiary">
                      {relativeDayLabel(conversation.lastActivityAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate text-caption',
                        conversation.draft !== ''
                          ? 'italic text-warning'
                          : conversation.unreadCount > 0
                            ? 'font-medium text-text-secondary'
                            : 'text-text-tertiary',
                      )}
                    >
                      {conversationPreview(conversation)}
                    </p>
                    {matches > 0 ? (
                      <span className="shrink-0 rounded-pill bg-info-subtle px-1.5 text-caption font-medium text-info">
                        {matches} match{matches === 1 ? '' : 'es'}
                      </span>
                    ) : null}
                    {conversation.unreadCount > 0 ? (
                      <CountBadge
                        count={conversation.unreadCount}
                        aria-label={`${String(conversation.unreadCount)} unread messages`}
                      />
                    ) : null}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
