import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Button } from '@/components/ui';
import { findContactForPatient } from '@/features/shared-domain/conversations';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import {
  messagingKeys,
  useContactsQuery,
  useConversationsQuery,
  useDeleteConversationMutation,
  useUpdateConversationMutation,
} from '../api/useMessagingQueries';
import { ChatWorkspace } from '../components/ChatWorkspace';
import { ConversationDetailsDrawer } from '../components/ConversationDetailsDrawer';
import { ConversationListPane } from '../components/ConversationListPane';
import { FolderRail } from '../components/FolderRail';
import { NewMessageDialog } from '../components/NewMessageDialog';
import {
  FOLDER_LABELS,
  MESSAGING_FOLDERS,
  filterConversations,
  indexContacts,
  folderCounts,
  type MessagingFolder,
} from '../model/selectors';
import { messagingService } from '../service';

/**
 * Messages — the communication workspace (UX §2 inbox). Unlike the
 * registry pages this is a full-height three-pane surface: folder rail ·
 * conversation list · chat. Folder and search state live in the URL;
 * the open thread is the :conversationId route param. Below lg the
 * workspace collapses to list-or-chat with a slide-back header.
 */

function isFolder(value: string | null): value is MessagingFolder {
  return value !== null && (MESSAGING_FOLDERS as readonly string[]).includes(value);
}

export function MessagesPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams<{ conversationId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLg = useMediaQuery('(min-width: 1024px)');

  const folderParam = searchParams.get('folder');
  const folder: MessagingFolder = isFolder(folderParam) ? folderParam : 'inbox';
  const query = searchParams.get('q') ?? '';

  const queryClient = useQueryClient();
  const conversationsQuery = useConversationsQuery();
  const contactsQuery = useContactsQuery();
  const update = useUpdateConversationMutation();
  const remove = useDeleteConversationMutation();

  const detailsDrawer = useDisclosure();
  const newMessage = useDisclosure();

  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);
  const contacts = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);
  const contactIndex = useMemo(() => indexContacts(contacts), [contacts]);
  const counts = useMemo(() => folderCounts(conversations), [conversations]);
  const filtered = useMemo(
    () => filterConversations(conversations, folder, query, contactIndex),
    [conversations, folder, query, contactIndex],
  );

  const active = conversations.find((conversation) => conversation.id === conversationId) ?? null;

  const setParam = useCallback(
    (key: 'folder' | 'q', value: string) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value === '' || (key === 'folder' && value === 'inbox')) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Plain promise chain (not a mutation callback) so navigation is never
  // dropped by a StrictMode remount — the Phase 10 lesson.
  const openContact = useCallback(
    (contactId: string) => {
      newMessage.close();
      void messagingService.openDirectConversation(contactId).then((id) => {
        void queryClient.invalidateQueries({ queryKey: messagingKeys.all });
        navigate(routes.doctor.conversation(id));
      });
    },
    [navigate, newMessage, queryClient],
  );

  const backToList = useCallback(() => navigate(routes.doctor.messages), [navigate]);

  /*
   * D-24 — the entry points from outside this feature.
   *
   * `?compose=1` opens the picker; `?patient=<id>` skips it and opens that
   * patient's thread, which is what "Send message" on a patient profile
   * means. They are consumed once and stripped from the URL: a compose
   * intent is an action, not a view, and leaving it in place would reopen
   * the dialog on every back-navigation to the inbox.
   *
   * The guard is a ref rather than the param itself, because opening a
   * thread is asynchronous — without it the effect re-runs on the render
   * caused by its own `setSearchParams` and starts a second conversation.
   */
  const composeParam = searchParams.get('compose');
  const patientParam = searchParams.get('patient');
  const entryHandled = useRef(false);

  useEffect(() => {
    if (entryHandled.current) return;
    if (composeParam === null && patientParam === null) return;
    // Contacts must be loaded before a patient can be resolved to a thread.
    if (patientParam !== null && contactsQuery.data === undefined) return;

    entryHandled.current = true;
    const clearEntryParams = () => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('compose');
          next.delete('patient');
          return next;
        },
        { replace: true },
      );
    };

    if (patientParam !== null) {
      const contact = findContactForPatient(contactsQuery.data ?? [], patientParam);
      clearEntryParams();
      /*
       * No contact means this patient has no portal messaging. Falling back
       * to the picker is honest — it says "choose someone" rather than
       * opening a thread with a person who cannot receive it.
       */
      if (contact === undefined) newMessage.open();
      else openContact(contact.id);
      return;
    }

    clearEntryParams();
    newMessage.open();
  }, [composeParam, patientParam, contactsQuery.data, newMessage, openContact, setSearchParams]);

  const chatPane =
    active !== null ? (
      <ChatWorkspace
        conversation={active}
        contacts={contactIndex}
        onOpenDetails={detailsDrawer.open}
        onBack={isLg ? null : backToList}
        onDeleted={backToList}
      />
    ) : conversationsQuery.isPending && conversationId !== undefined ? (
      <div className="flex h-full flex-col gap-3 p-4" aria-hidden="true">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-12 w-3/5 rounded-surface" />
        <Skeleton className="ms-auto h-12 w-2/5 rounded-surface" />
        <Skeleton className="h-12 w-1/2 rounded-surface" />
      </div>
    ) : conversationId !== undefined ? (
      <EmptyState
        icon={MessagesSquare}
        tone="primary"
        title="Conversation not found"
        description="It may have been deleted from this workspace."
        action={
          <Button variant="secondary" size="sm" onClick={backToList}>
            Back to inbox
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={MessagesSquare}
        tone="primary"
        title="Select a conversation"
        description="Pick a thread from the list, or start a new message to a colleague or patient."
        action={
          <Button size="sm" onClick={newMessage.open}>
            New message
          </Button>
        }
      />
    );

  const showListOnMobile = active === null && conversationId === undefined;

  /*
   * A failed load is an error — "not connected" where the service has no
   * messaging to offer — and never an empty workspace that reads as "no
   * conversations".
   */
  if (conversationsQuery.isError) {
    return (
      <div className="mx-auto max-w-container-2xl px-3 py-3 md:px-4">
        <h1 className="sr-only">Messages</h1>
        <ErrorState
          title="Couldn't load your conversations"
          error={conversationsQuery.error}
          onRetry={() => void conversationsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="px-3 py-3 md:px-4">
      {/*
       * The page's one h1, visually hidden.
       *
       * This is a full-height three-pane workspace, so it deliberately has no
       * `ContentHeader` band — and that left it with no page heading at all.
       * A sighted user reads the workspace; a screen-reader user landing here
       * got the shell's landmarks and then a folder rail, with nothing saying
       * which page they were on. `sr-only` restores the heading without
       * spending the vertical space the three-pane layout does not have.
       */}
      <h1 className="sr-only">Messages</h1>
      <div
        className={cn(
          'mx-auto grid max-w-container-2xl overflow-hidden rounded-surface border border-border bg-surface',
          'h-[calc(100dvh-172px)] md:h-[calc(100dvh-96px)] lg:grid-cols-[218px_minmax(260px,330px)_1fr]',
        )}
      >
        {/* Folder rail — desktop only */}
        <div className="hidden min-h-0 border-e border-border bg-surface-sunken lg:block">
          <FolderRail
            folder={folder}
            counts={counts}
            contacts={contacts}
            onFolderChange={(next) => setParam('folder', next)}
            onNewMessage={newMessage.open}
            onOpenContact={openContact}
          />
        </div>

        {/* Conversation list */}
        <div
          className={cn(
            'min-h-0 flex-col border-e border-border',
            isLg ? 'flex' : showListOnMobile ? 'flex' : 'hidden',
          )}
        >
          {/* Mobile: folders as a horizontal chip row + new message */}
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border p-2 lg:hidden">
            {MESSAGING_FOLDERS.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setParam('folder', entry)}
                aria-pressed={entry === folder}
                className={cn(
                  'shrink-0 rounded-pill px-2.5 py-1 text-caption font-medium transition-colors duration-fast',
                  entry === folder
                    ? 'bg-primary-subtle text-primary'
                    : 'text-text-secondary hover:bg-surface-sunken',
                )}
              >
                {FOLDER_LABELS[entry]}
                {counts[entry] > 0 ? ` (${String(counts[entry])})` : ''}
              </button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto shrink-0"
              onClick={newMessage.open}
            >
              New
            </Button>
          </div>

          <ConversationListPane
            conversations={filtered}
            contacts={contactIndex}
            folder={folder}
            activeId={active?.id ?? null}
            query={query}
            onQueryChange={(next) => setParam('q', next)}
            loading={conversationsQuery.isPending}
          />
        </div>

        {/* Chat */}
        <div className={cn('min-h-0', isLg ? 'block' : showListOnMobile ? 'hidden' : 'block')}>
          {chatPane}
        </div>
      </div>

      {active !== null ? (
        <ConversationDetailsDrawer
          open={detailsDrawer.isOpen}
          onClose={detailsDrawer.close}
          conversation={active}
          contacts={contactIndex}
          onToggleMute={() => update.mutate({ id: active.id, patch: { muted: !active.muted } })}
          onToggleArchive={() => {
            update.mutate({ id: active.id, patch: { archived: !active.archived } });
            detailsDrawer.close();
          }}
          onDelete={() => {
            detailsDrawer.close();
            remove.mutate(active.id);
            backToList();
          }}
        />
      ) : null}

      <NewMessageDialog
        open={newMessage.isOpen}
        onClose={newMessage.close}
        contacts={contacts}
        pending={false}
        onPick={openContact}
      />
    </div>
  );
}
