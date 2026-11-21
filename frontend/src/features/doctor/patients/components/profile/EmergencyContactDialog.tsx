import { useEffect, useState } from 'react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Checkbox, Input, Modal } from '@/components/ui';

import { useSaveEmergencyContactMutation } from '../../api/usePatientProfileQuery';
import {
  CONTACT_NAME_MAX,
  CONTACT_PHONE_PATTERN,
  CONTACT_RELATIONSHIP_MAX,
} from '../../model/profile-service';
import type { EmergencyContact } from '../../model/profile-types';

/**
 * Add an emergency contact, or correct one (API §4.6). The phone rule and the
 * length caps are the server's. Marking a contact primary clears the flag on
 * the others — the server does that rather than refusing, and the dialog says
 * so before it happens. Pessimistic; a failure keeps the form.
 */
export interface EmergencyContactDialogProps {
  open: boolean;
  patientId: string;
  patientName: string;
  /** The contact being corrected, or `null` to add one. */
  contact: EmergencyContact | null;
  /** Whether another contact is already primary — worded in the checkbox hint. */
  hasPrimary: boolean;
  onClose: () => void;
}

interface Draft {
  readonly name: string;
  readonly relationship: string;
  readonly phone: string;
  readonly isPrimary: boolean;
}

function draftOf(contact: EmergencyContact | null, hasPrimary: boolean): Draft {
  return contact === null
    ? { name: '', relationship: '', phone: '', isPrimary: !hasPrimary }
    : {
        name: contact.name,
        relationship: contact.relationship,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
      };
}

function failureOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const { detail } = error as { readonly detail?: unknown };
    if (typeof detail === 'string' && detail !== '') return detail;
  }
  return 'Nothing was saved. Please try again.';
}

export function EmergencyContactDialog({
  open,
  patientId,
  patientName,
  contact,
  hasPrimary,
  onClose,
}: EmergencyContactDialogProps) {
  const { toast } = useToast();
  const save = useSaveEmergencyContactMutation(patientId);
  const [draft, setDraft] = useState<Draft>(() => draftOf(contact, hasPrimary));
  const [showIssues, setShowIssues] = useState(false);
  const editing = contact !== null;

  // Each opening starts from the contact being edited (or a blank one).
  useEffect(() => {
    if (open) {
      setDraft(draftOf(contact, hasPrimary));
      setShowIssues(false);
    }
  }, [open, contact, hasPrimary]);

  const phone = draft.phone.trim();
  const issues = {
    name: draft.name.trim() === '' ? 'Name the contact' : undefined,
    relationship: draft.relationship.trim() === '' ? 'Say how they are related' : undefined,
    phone: CONTACT_PHONE_PATTERN.test(phone) ? undefined : 'Enter a valid phone number',
  };
  const valid = Object.values(issues).every((issue) => issue === undefined);
  const takesPrimaryFromAnother = draft.isPrimary && hasPrimary && contact?.isPrimary !== true;

  const close = () => {
    save.reset();
    onClose();
  };

  const submit = () => {
    setShowIssues(true);
    if (!valid) return;
    save.mutate(
      { contactId: contact?.id ?? null, input: { ...draft, phone } },
      {
        onSuccess: (saved) => {
          close();
          toast({
            variant: 'success',
            title: editing ? `${saved.name} updated` : `${saved.name} added`,
            description: saved.isPrimary
              ? `The primary emergency contact for ${patientName}.`
              : `An emergency contact for ${patientName}.`,
          });
        },
      },
    );
  };

  const issue = (field: keyof typeof issues) => (showIssues ? issues[field] : undefined);

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={editing ? 'Edit emergency contact' : 'Add an emergency contact'}
      description={`For ${patientName}.`}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {editing ? 'Save contact' : 'Add contact'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap={4}>
          <Input
            label="Name"
            required
            maxLength={CONTACT_NAME_MAX}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            error={issue('name')}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Relationship"
              required
              maxLength={CONTACT_RELATIONSHIP_MAX}
              value={draft.relationship}
              onChange={(event) => setDraft({ ...draft, relationship: event.target.value })}
              error={issue('relationship')}
              placeholder="e.g. Spouse"
            />
            <Input
              type="tel"
              label="Phone"
              required
              dir="ltr"
              maxLength={30}
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              error={issue('phone')}
              placeholder="+20 100 123 4567"
            />
          </div>
          <Checkbox
            label="Primary contact"
            description={
              takesPrimaryFromAnother
                ? 'The current primary contact will no longer be primary.'
                : 'The one to call first.'
            }
            checked={draft.isPrimary}
            onChange={(event) => setDraft({ ...draft, isPrimary: event.target.checked })}
          />
          {save.isError ? (
            <Alert variant="error" title="The contact was not saved">
              {failureOf(save.error)}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
