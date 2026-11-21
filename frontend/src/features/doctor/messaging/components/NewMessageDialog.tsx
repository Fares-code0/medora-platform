import { Avatar, Button, Modal } from '@/components/ui';
import type { Contact } from '@/features/shared-domain/conversations';
import { cn } from '@/utils/cn';

import { PRESENCE_META, ROLE_LABELS } from '../model/selectors';

/**
 * New message — pick a contact to open (or create) the direct thread.
 * Group threads are created by the care team upstream; starting one is
 * out of scope for the mock.
 */

export interface NewMessageDialogProps {
  open: boolean;
  onClose: () => void;
  contacts: readonly Contact[];
  pending: boolean;
  onPick: (contactId: string) => void;
}

export function NewMessageDialog({
  open,
  onClose,
  contacts,
  pending,
  onPick,
}: NewMessageDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New message"
      description="Start or continue a direct conversation."
      size="sm"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-1" role="list" aria-label="Contacts">
        {contacts.map((contact) => (
          <button
            key={contact.id}
            type="button"
            role="listitem"
            disabled={pending}
            onClick={() => onPick(contact.id)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-surface p-2 text-start transition-colors duration-fast',
              'hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <Avatar
              name={contact.name}
              size="sm"
              status={contact.presence === 'online' ? 'online' : undefined}
              decorative
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-medium text-text-primary">
                {contact.name}
              </span>
              <span className="block truncate text-caption text-text-tertiary">
                {ROLE_LABELS[contact.role]} · {contact.department}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-caption text-text-secondary">
              <span
                aria-hidden="true"
                className={cn('h-1.5 w-1.5 rounded-pill', PRESENCE_META[contact.presence].dotClass)}
              />
              {PRESENCE_META[contact.presence].label}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
