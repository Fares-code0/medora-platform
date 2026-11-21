import {
  Archive,
  Inbox,
  MailOpen,
  PenLine,
  Send,
  SquarePen,
  Star,
  type LucideIcon,
} from 'lucide-react';

import { Avatar, Button } from '@/components/ui';
import type { Contact } from '@/features/shared-domain/conversations';
import { cn } from '@/utils/cn';

import {
  FOLDER_LABELS,
  MESSAGING_FOLDERS,
  PRESENCE_META,
  type MessagingFolder,
} from '../model/selectors';

/**
 * Folder rail — the workspace's own left navigation: New message, the
 * six folders with live counts, and the contact directory (favorites
 * first). This is page chrome, not app chrome — the global sidebar
 * stays untouched.
 */

const FOLDER_ICONS: Record<MessagingFolder, LucideIcon> = {
  inbox: Inbox,
  unread: MailOpen,
  starred: Star,
  sent: Send,
  drafts: PenLine,
  archived: Archive,
};

export interface FolderRailProps {
  folder: MessagingFolder;
  counts: Record<MessagingFolder, number>;
  contacts: readonly Contact[];
  onFolderChange: (folder: MessagingFolder) => void;
  onNewMessage: () => void;
  onOpenContact: (contactId: string) => void;
}

export function FolderRail({
  folder,
  counts,
  contacts,
  onFolderChange,
  onNewMessage,
  onOpenContact,
}: FolderRailProps) {
  const favorites = contacts.filter((contact) => contact.favorite);
  const others = contacts.filter((contact) => !contact.favorite);

  const contactRow = (contact: Contact) => (
    <button
      key={contact.id}
      type="button"
      onClick={() => onOpenContact(contact.id)}
      className="flex w-full items-center gap-2 rounded-surface px-2 py-1.5 text-start transition-colors duration-fast hover:bg-surface-sunken"
    >
      <Avatar
        name={contact.name}
        size="xs"
        status={contact.presence === 'online' ? 'online' : undefined}
        decorative
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm text-text-primary">{contact.name}</span>
        <span className="block truncate text-caption text-text-secondary">
          {contact.department}
        </span>
      </span>
      <span
        aria-label={PRESENCE_META[contact.presence].label}
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-pill',
          PRESENCE_META[contact.presence].dotClass,
        )}
      />
    </button>
  );

  return (
    <nav aria-label="Messaging folders" className="flex h-full min-h-0 flex-col gap-3 p-2.5">
      <Button size="sm" fullWidth leadingIcon={SquarePen} onClick={onNewMessage}>
        New message
      </Button>

      <div className="flex flex-col gap-0.5" role="tablist" aria-label="Folders">
        {MESSAGING_FOLDERS.map((entry) => {
          const Icon = FOLDER_ICONS[entry];
          const active = entry === folder;
          const count = counts[entry];
          return (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFolderChange(entry)}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-surface px-2.5 text-body-sm transition-colors duration-fast',
                active
                  ? 'bg-primary-subtle font-semibold text-primary'
                  : 'font-medium text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="flex-1 truncate text-start">{FOLDER_LABELS[entry]}</span>
              {count > 0 ? (
                <span
                  className={cn(
                    'rounded-pill px-1.5 text-caption tabular-nums',
                    active ? 'bg-surface text-primary' : 'bg-surface-sunken text-text-tertiary',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        {favorites.length > 0 ? (
          <>
            <p className="px-2 pb-1 pt-2 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
              Favorites
            </p>
            {favorites.map(contactRow)}
          </>
        ) : null}
        <p className="px-2 pb-1 pt-2 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
          Contacts
        </p>
        {others.map(contactRow)}
      </div>
    </nav>
  );
}
