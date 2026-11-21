import { useEffect, useState } from 'react';

import { useAuth, useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, ConfirmationDialog, Input, Modal, Textarea } from '@/components/ui';

import {
  useAddNoteMutation,
  useSignChartNoteMutation,
  useUpdateNoteMutation,
} from '../../api/usePatientProfileQuery';
import { NOT_NOTE_AUTHOR, NOTE_BODY_MAX, NOTE_TITLE_MAX } from '../../model/profile-service';
import type { ClinicalNote } from '../../model/profile-types';

/**
 * Writing, correcting and signing chart notes (API §4.6, DEC-001).
 *
 * A note is created **unsigned**; it can be corrected until it is signed, and
 * signing freezes it. The chart only offers Edit and Sign on the signed-in
 * user's own unsigned notes (`canActOnNote`); the server refuses anyone else
 * with 403 `not_note_author` (BR-DEC-001), which is named here rather than
 * reported as a failure worth retrying.
 *
 * All pessimistic: nothing reads as saved or signed before the server says so
 * and the Notes tab has refetched. A failure keeps the dialog and what was
 * typed.
 */

function failureOf(error: unknown): string {
  // A 403 carries no detail through the client's normalisation, and "try
  // again" would be wrong: the answer will not change.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { readonly code?: unknown };
    if (code === NOT_NOTE_AUTHOR) {
      return 'Only the note’s author can edit or sign it. Nothing was changed.';
    }
  }
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const { detail } = error as { readonly detail?: unknown };
    if (typeof detail === 'string' && detail !== '') return detail;
  }
  return 'Nothing was saved. Please try again.';
}

export function ChartNoteDialog({
  open,
  patientId,
  patientName,
  note,
  onClose,
}: {
  open: boolean;
  patientId: string;
  patientName: string;
  /** The unsigned note being corrected, or `null` to write a new one. */
  note: ClinicalNote | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const add = useAddNoteMutation(patientId);
  const update = useUpdateNoteMutation(patientId);
  const write = note === null ? add : update;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showIssues, setShowIssues] = useState(false);

  // Each opening starts from the note being corrected (or a blank one).
  useEffect(() => {
    if (!open) return;
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setShowIssues(false);
  }, [open, note]);

  const issues = {
    title: title.trim() === '' ? 'Give the note a title' : undefined,
    body: body.trim() === '' ? 'Write the note' : undefined,
  };
  const valid = issues.title === undefined && issues.body === undefined;

  const close = () => {
    add.reset();
    update.reset();
    onClose();
  };

  const submit = () => {
    setShowIssues(true);
    if (!valid) return;
    const input = { title, body };
    const done = (saved: ClinicalNote) => {
      close();
      toast({
        variant: 'success',
        title: note === null ? 'Note saved, unsigned' : 'Note updated',
        description: `“${saved.title}” — sign it once it is final.`,
      });
    };
    const author = { id: user?.id ?? '', name: user?.name ?? 'Doctor' };
    if (note === null) {
      add.mutate({ input, author }, { onSuccess: done });
    } else {
      update.mutate({ noteId: note.id, input, actor: author }, { onSuccess: done });
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={note === null ? 'Write a note' : 'Edit note'}
      description={`For ${patientName}. Saved unsigned — you can correct it until you sign it.`}
      dismissible={!write.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={write.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={write.isPending}>
            {note === null ? 'Save note' : 'Save changes'}
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
            label="Title"
            required
            maxLength={NOTE_TITLE_MAX}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={showIssues ? issues.title : undefined}
            placeholder="e.g. Telephone encounter"
          />
          <Textarea
            label="Note"
            required
            rows={8}
            maxLength={NOTE_BODY_MAX}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            error={showIssues ? issues.body : undefined}
          />
          {write.isError ? (
            <Alert variant="error" title="The note was not saved">
              {failureOf(write.error)}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}

export function SignChartNoteDialog({
  patientId,
  note,
  onClose,
}: {
  patientId: string;
  /** The note being signed; `null` keeps the dialog closed. */
  note: ClinicalNote | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const sign = useSignChartNoteMutation(patientId);

  const close = () => {
    sign.reset();
    onClose();
  };

  return (
    <ConfirmationDialog
      open={note !== null}
      onClose={close}
      tone="primary"
      title="Sign this note?"
      description={note?.title}
      confirmLabel="Sign note"
      loading={sign.isPending}
      onConfirm={() => {
        if (note === null) return;
        const actor = { id: user?.id ?? '', name: user?.name ?? 'Doctor' };
        sign.mutate(
          { noteId: note.id, actor },
          {
            onSuccess: (signed) => {
              close();
              toast({
                variant: 'success',
                title: 'Note signed',
                description: `“${signed.title}” can no longer be edited.`,
              });
            },
          },
        );
      }}
    >
      <div className="flex flex-col gap-3 text-body-sm text-text-secondary">
        <p>Your signature attests to this note as written. Once signed it cannot be edited.</p>
        {note === null ? null : (
          <p className="max-h-40 overflow-y-auto whitespace-pre-line rounded-control border border-border p-3 text-text-primary">
            {note.body}
          </p>
        )}
        {sign.isError ? (
          <Alert variant="error" title="The note was not signed">
            {failureOf(sign.error)}
          </Alert>
        ) : null}
      </div>
    </ConfirmationDialog>
  );
}
