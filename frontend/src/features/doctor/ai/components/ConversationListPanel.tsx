import { useMemo, useState } from 'react';

import { EllipsisVertical, MessageSquarePlus, Pencil, Star, Trash2 } from 'lucide-react';

import { EmptyState, Skeleton } from '@/components/feedback';
import {
  Button,
  ConfirmationDialog,
  Dropdown,
  IconButton,
  Input,
  Modal,
  SearchInput,
  Tooltip,
} from '@/components/ui';
import { cn } from '@/utils/cn';
import { relativeDayLabel } from '@/utils/dates';

import { AI_CONTEXT_META, type AiConversation } from '../model/types';

/**
 * Conversation history — local management of past chats: search, open,
 * rename (Modal), favorite, and delete (ConfirmationDialog). Favorites
 * sort first; the list is ordered by last activity.
 */
export interface ConversationListPanelProps {
  conversations: readonly AiConversation[];
  activeId: string | null;
  loading: boolean;
  onOpen: (conversation: AiConversation) => void;
  onNew: () => void;
  onRename: (conversationId: string, title: string) => void;
  onToggleFavorite: (conversation: AiConversation) => void;
  onDelete: (conversationId: string) => void;
}

export function ConversationListPanel({
  conversations,
  activeId,
  loading,
  onOpen,
  onNew,
  onRename,
  onToggleFavorite,
  onDelete,
}: ConversationListPanelProps) {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<AiConversation | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<AiConversation | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched =
      q === ''
        ? conversations
        : conversations.filter((conversation) =>
            conversation.title.toLowerCase().includes(q),
          );
    return [...matched].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [conversations, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchInput
            aria-label="Search conversations"
            placeholder="Search chats…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
        </div>
        <Tooltip content="New chat">
          <Button variant="secondary" leadingIcon={MessageSquarePlus} onClick={onNew}>
            New
          </Button>
        </Tooltip>
      </div>

      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-surface" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query === '' ? 'No conversations yet' : 'No chats match'}
          description={
            query === ''
              ? 'Start a new chat or use a suggested prompt.'
              : 'Try a different search term.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Conversation history">
          {filtered.map((conversation) => {
            const active = conversation.id === activeId;
            const modeLabel = AI_CONTEXT_META[conversation.context.mode].label;
            return (
              <li key={conversation.id}>
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded-surface border px-2 py-2 transition-colors duration-fast',
                    active
                      ? 'border-accent bg-accent-subtle'
                      : 'border-transparent hover:bg-surface-sunken',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(conversation)}
                    aria-current={active ? 'true' : undefined}
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start"
                  >
                    <span className="flex w-full min-w-0 items-center gap-1.5">
                      {conversation.favorite ? (
                        <Star
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 text-warning"
                          strokeWidth={2}
                        />
                      ) : null}
                      <span className="truncate text-body-sm font-medium text-text-primary">
                        {conversation.title}
                      </span>
                    </span>
                    <span className="text-caption text-text-tertiary">
                      {modeLabel} · {relativeDayLabel(conversation.updatedAt)}
                    </span>
                  </button>
                  <Dropdown
                    align="end"
                    menuLabel={`Actions for "${conversation.title}"`}
                    entries={[
                      {
                        id: 'rename',
                        label: 'Rename',
                        icon: Pencil,
                        onSelect: () => {
                          setRenaming(conversation);
                          setRenameValue(conversation.title);
                        },
                      },
                      {
                        id: 'favorite',
                        label: conversation.favorite ? 'Remove favorite' : 'Add to favorites',
                        icon: Star,
                        onSelect: () => onToggleFavorite(conversation),
                      },
                      { type: 'separator', id: 'sep' },
                      {
                        id: 'delete',
                        label: 'Delete',
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => setDeleting(conversation),
                      },
                    ]}
                    trigger={
                      <IconButton
                        icon={EllipsisVertical}
                        size="sm"
                        aria-label={`Actions for "${conversation.title}"`}
                      />
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename conversation"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (renaming && renameValue.trim() !== '') {
                  onRename(renaming.id, renameValue.trim());
                }
                setRenaming(null);
              }}
              disabled={renameValue.trim() === ''}
            >
              Rename
            </Button>
          </>
        }
      >
        <Input
          label="Conversation title"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          maxLength={80}
        />
      </Modal>

      <ConfirmationDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) onDelete(deleting.id);
          setDeleting(null);
        }}
        title="Delete this conversation?"
        description={
          deleting
            ? `"${deleting.title}" and its messages will be removed from this device.`
            : undefined
        }
        confirmLabel="Delete conversation"
        tone="destructive"
      />
    </div>
  );
}
