import { PenLine } from 'lucide-react';

import { MarkdownContent } from '@/components/patterns';
import { Badge, Button } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import type { MedicalRecord, RecordClinicalNote } from '../../model/types';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/**
 * Clinical notes attached to the record, newest first, with sign-off state.
 *
 * D-21 gave the unsigned ones a Sign control. It appears **only** on a note
 * the reader can actually sign — their own, still unsigned — rather than
 * sitting disabled beside everyone else's: the model refuses to produce a
 * signable value for the others, and an affordance that follows that refusal
 * is honest where a greyed-out button is merely quiet.
 *
 * Notes render through `MarkdownContent` (D-29), the same renderer the
 * author previewed with, so what was written is what is read. It parses to
 * React nodes rather than an HTML string, so `dangerouslySetInnerHTML` stays
 * banned (§12.4), no sanitizer is in the path, and a note containing markup
 * renders those characters instead of executing them.
 */
export function RecordNotesSection({
  record,
  signedBy,
  onSign,
}: {
  record: MedicalRecord;
  /** The signed-in clinician; only their own notes offer a Sign control. */
  signedBy?: string | undefined;
  onSign?: ((note: RecordClinicalNote) => void) | undefined;
}) {
  const notes = [...record.notes].sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));

  return (
    <RecordSectionCard title="Clinical notes">
      {notes.length === 0 ? (
        <EmptySectionNote>No clinical notes have been added to this record.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col gap-4">
          {notes.map((note) => (
            <li key={note.id} className="rounded-surface border border-border bg-surface-sunken p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body-sm font-semibold text-text-primary">{note.title}</p>
                <Badge variant={note.signed ? 'success' : 'warning'}>
                  {note.signed ? 'Signed' : 'Unsigned'}
                </Badge>
              </div>
              <p className="mt-0.5 text-caption text-text-tertiary tabular-nums">
                {note.author} · {formatDate(note.authoredAt)} · {formatTime(note.authoredAt)}
              </p>
              <div className="mt-2 text-body-sm text-text-secondary">
                <MarkdownContent markdown={note.body} />
              </div>
              {!note.signed &&
              onSign !== undefined &&
              signedBy !== undefined &&
              note.author === signedBy &&
              record.status !== 'archived' ? (
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={PenLine}
                    onClick={() => onSign(note)}
                    aria-label={`Sign the note "${note.title}"`}
                  >
                    Sign note
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </RecordSectionCard>
  );
}
