import {
  Archive,
  ArchiveRestore,
  BellOff,
  FileText,
  Image as ImageIcon,
  Link2,
  Trash2,
} from 'lucide-react';

import { Avatar, Badge, Button, Divider, Drawer, Switch } from '@/components/ui';
import type { Conversation } from '@/features/shared-domain/conversations';
import { cn } from '@/utils/cn';
import { relativeDayLabel } from '@/utils/dates';

import {
  PRESENCE_META,
  ROLE_LABELS,
  conversationContacts,
  conversationTitle,
  type ContactIndex,
  sharedAttachments,
  sharedLinks,
} from '../model/selectors';

/**
 * Conversation details — participants (role, department, presence, last
 * active), shared files / media / links extracted from the thread, and
 * conversation settings (mute, archive, delete).
 */

export interface ConversationDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  conversation: Conversation;
  /** Contacts by id, from the messaging port (`useContactsQuery`). */
  contacts: ContactIndex;
  onToggleMute: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="pb-1.5 pt-4 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
      {children}
    </p>
  );
}

export function ConversationDetailsDrawer({
  open,
  onClose,
  conversation,
  contacts: contactIndex,
  onToggleMute,
  onToggleArchive,
  onDelete,
}: ConversationDetailsDrawerProps) {
  const contacts = conversationContacts(conversation, contactIndex);
  const files = sharedAttachments(conversation, 'file');
  const media = sharedAttachments(conversation, 'image');
  const links = sharedLinks(conversation);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={conversationTitle(conversation, contactIndex)}
      size="sm"
    >
      <div className="flex flex-col">
        <SectionLabel>Participants</SectionLabel>
        <div className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <div key={contact.id} className="flex items-center gap-2.5">
              <Avatar
                name={contact.name}
                size="sm"
                status={contact.presence === 'online' ? 'online' : undefined}
                decorative
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-medium text-text-primary">
                  {contact.name}
                </p>
                <p className="truncate text-caption text-text-tertiary">
                  {ROLE_LABELS[contact.role]} · {contact.department}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="inline-flex items-center gap-1 text-caption text-text-secondary">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-1.5 w-1.5 rounded-pill',
                      PRESENCE_META[contact.presence].dotClass,
                    )}
                  />
                  {PRESENCE_META[contact.presence].label}
                </span>
                <span className="text-caption text-text-tertiary">
                  Active {relativeDayLabel(contact.lastActiveAt)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <SectionLabel>Shared files</SectionLabel>
        {files.length === 0 ? (
          <p className="text-caption text-text-secondary">No files shared yet.</p>
        ) : (
          files.map((file) => (
            <div key={file.id} className="flex items-center gap-2.5 py-1.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-surface bg-primary-subtle text-primary">
                <FileText aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm text-text-primary">{file.name}</p>
                <p className="text-caption text-text-tertiary">{file.sizeLabel}</p>
              </div>
            </div>
          ))
        )}

        <SectionLabel>Media</SectionLabel>
        {media.length === 0 ? (
          <p className="text-caption text-text-secondary">No media shared yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {media.map((item) => (
              <div
                key={item.id}
                role="img"
                aria-label={item.name}
                className="flex h-16 items-center justify-center rounded-surface bg-info-subtle text-info"
              >
                <ImageIcon aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
              </div>
            ))}
          </div>
        )}

        <SectionLabel>Shared links</SectionLabel>
        {links.length === 0 ? (
          <p className="text-caption text-text-secondary">No links shared yet.</p>
        ) : (
          links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 py-1 text-body-sm text-primary underline-offset-2 hover:underline"
            >
              <Link2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{link.label}</span>
            </a>
          ))
        )}

        <Divider className="my-4" />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-body-sm text-text-primary">
            <BellOff aria-hidden="true" className="h-4 w-4 text-text-tertiary" strokeWidth={1.75} />
            Mute conversation
          </div>
          <Switch
            checked={conversation.muted}
            onCheckedChange={onToggleMute}
            aria-label="Mute conversation"
          />
        </div>
        {conversation.muted ? (
          <Badge variant="neutral" className="mt-2 self-start">
            Muted — unread messages are excluded from the badge
          </Badge>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={conversation.archived ? ArchiveRestore : Archive}
            onClick={onToggleArchive}
          >
            {conversation.archived ? 'Restore from archive' : 'Archive conversation'}
          </Button>
          <Button variant="destructive-secondary" size="sm" leadingIcon={Trash2} onClick={onDelete}>
            Delete conversation
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
