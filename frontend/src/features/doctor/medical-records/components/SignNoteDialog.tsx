import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Modal } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import {
  NOTE_SIGN_BLOCKED_META,
  assessNoteSignability,
  type SignableNote,
} from '../model/record-lifecycle';
import type { MedicalRecord, RecordClinicalNote } from '../model/types';

/**
 * Sign a clinical note (D-21).
 *
 * **Fail closed.** The confirm button is not merely disabled when the note
 * cannot be signed — there is no `SignableNote` to submit, because
 * `assessNoteSignability` is the only producer of one and it refuses. The
 * button reflects that state; it does not create it, and `onConfirm` is typed
 * to take the value so a refactor that re-enables the button still cannot
 * submit anything.
 *
 * The note is shown in full above the action. A signature attests to content,
 * and a dialog that asked for one without showing what it covers would be
 * asking for a reflex.
 */
export interface SignNoteDialogProps {
  open: boolean;
  record: MedicalRecord | null;
  note: RecordClinicalNote | null;
  signedBy: string;
  onClose: () => void;
  onConfirm: (signable: SignableNote) => void;
  submitting: boolean;
  errorMessage: string | null;
}

export function SignNoteDialog({
  open,
  record,
  note,
  signedBy,
  onClose,
  onConfirm,
  submitting,
  errorMessage,
}: SignNoteDialogProps) {
  if (record === null || note === null) return null;

  const { signable, blockedBy } = assessNoteSignability({
    record,
    noteId: note.id,
    signedBy,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sign this clinical note?"
      description={`${note.title} · ${record.patient.name} (MRN ${record.patient.mrn})`}
      size="md"
      role="alertdialog"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Go back
          </Button>
          <Button
            loading={submitting}
            disabled={signable === null}
            onClick={() => {
              if (signable !== null) onConfirm(signable);
            }}
          >
            Sign note
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        {errorMessage !== null ? (
          // The message says whether the note is known to be unchanged
          // (`useRecordLifecycleActions`): after a lost connection it may not be.
          <Alert variant="error" critical title="Signing failed">
            {errorMessage}
          </Alert>
        ) : null}

        <div className="rounded-surface border border-border bg-surface-sunken p-4">
          <p className="text-body-sm font-semibold text-text-primary">{note.title}</p>
          <p className="mt-0.5 text-caption text-text-tertiary tabular-nums">
            {note.author} · {formatDate(note.authoredAt)} · {formatTime(note.authoredAt)}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-body-sm text-text-secondary">{note.body}</p>
        </div>

        <Alert variant="warning" title="Signing is not reversible">
          A signed note is a record of what you believed at this time. It can never be edited —
          a correction is an addendum that stands beside it, under its own timestamp.
        </Alert>

        {signable === null ? (
          <p role="status" className="text-caption text-text-secondary">
            {NOTE_SIGN_BLOCKED_META[blockedBy]}
          </p>
        ) : null}
      </Stack>
    </Modal>
  );
}
