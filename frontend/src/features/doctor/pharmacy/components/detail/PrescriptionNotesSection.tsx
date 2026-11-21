import { useState } from 'react';

import { MessageSquarePlus } from 'lucide-react';

import { useDoctorProfile, useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Button, Textarea } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import { useAddPrescriptionNoteMutation } from '../../api/usePrescriptionMutations';
import { PRESCRIPTION_NOTE_MAX } from '../../model/prescription-service';
import type { Prescription } from '../../model/types';

import { EmptySectionNote, PharmacySectionCard } from './PharmacySectionCard';

/**
 * Notes — prescriber and pharmacist notes attached to the prescription, and
 * the composer that appends one (API §7.10).
 *
 * Append-only by construction: the port has no edit or delete, so a note is
 * corrected by writing another one under your own name. The write is
 * pessimistic — the note joins the list from the server's answer, and a
 * failure keeps the text in the composer with the reason beside it.
 */
export function PrescriptionNotesSection({ prescription }: { prescription: Prescription }) {
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const addNote = useAddPrescriptionNoteMutation();
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');

  const trimmed = body.trim();
  const close = () => {
    setComposing(false);
    setBody('');
    addNote.reset();
  };

  const save = () => {
    if (trimmed === '') return;
    addNote.mutate(
      { prescriptionId: prescription.id, body: trimmed, author: profile.fullName || 'Doctor' },
      {
        onSuccess: () => {
          close();
          toast({ variant: 'success', title: 'Note added' });
        },
      },
    );
  };

  return (
    <PharmacySectionCard
      title="Notes"
      actions={
        composing ? null : (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={MessageSquarePlus}
            onClick={() => setComposing(true)}
          >
            Add note
          </Button>
        )
      }
    >
      {prescription.notes.length === 0 && !composing ? (
        <EmptySectionNote>No notes have been added to this prescription.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {prescription.notes.map((note) => (
            <li key={note.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body-sm font-medium text-text-primary">{note.author}</p>
                <p className="text-caption text-text-tertiary tabular-nums">
                  {formatDate(note.authoredAt)} · {formatTime(note.authoredAt)}
                </p>
              </div>
              <p className="mt-1 whitespace-pre-line text-body-sm text-text-secondary">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {composing ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Textarea
            label="New note"
            rows={3}
            maxLength={PRESCRIPTION_NOTE_MAX}
            showCount
            autoFocus
            value={body}
            onChange={(event) => setBody(event.target.value)}
            helperText="Added under your name. Notes cannot be edited or removed afterwards."
            disabled={addNote.isPending}
          />
          {addNote.isError ? (
            <Alert variant="error" title="The note was not saved">
              {addNote.error.message || 'Please try again.'}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={addNote.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed === ''} loading={addNote.isPending}>
              Save note
            </Button>
          </div>
        </form>
      ) : null}
    </PharmacySectionCard>
  );
}
