import { FilePenLine, PenLine, Plus } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Avatar, Button } from '@/components/ui';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import { canActOnNote } from '../../model/profile-service';
import type { ClinicalNote } from '../../model/profile-types';

/**
 * Notes tab — reverse-chronological timeline of clinical notes with author
 * attribution and signature state (unsigned notes carry the warning badge per
 * UX 2.3).
 *
 * DEC-001: a note is written unsigned, corrected until it is signed, then
 * frozen. Edit and Sign appear only on the signed-in user's own unsigned
 * notes (`canActOnNote`) — absent, not disabled, on anyone else's. That is a
 * display rule; the server is the authority and does not yet check the
 * author (BR-DEC-001).
 */
export function NotesTab({
  notes,
  currentUserId,
  onAdd,
  onEdit,
  onSign,
}: {
  notes: readonly ClinicalNote[];
  /** The signed-in user's id; Edit and Sign are offered only on their notes. */
  currentUserId?: string | undefined;
  /** Opens the write-note dialog; the button is absent without it. */
  onAdd?: (() => void) | undefined;
  onEdit?: ((note: ClinicalNote) => void) | undefined;
  onSign?: ((note: ClinicalNote) => void) | undefined;
}) {
  return (
    <Stack gap={4}>
      {onAdd !== undefined ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAdd}>
            Write note
          </Button>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <EmptyState
          title="No clinical notes yet"
          description="Notes written for this patient will appear here with author and signature state."
        />
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {notes.map((note) => {
            const mine = canActOnNote(note, currentUserId);
            return (
              <li key={note.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                <Avatar name={note.author} size="sm" decorative />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body-sm font-semibold text-text-primary">{note.title}</p>
                    <StatusBadge
                      status={note.signed ? 'completed' : 'pending'}
                      label={note.signed ? 'Signed' : 'Unsigned'}
                    />
                  </div>
                  <p className="mt-0.5 text-caption text-text-tertiary tabular-nums">
                    {note.author} · {formatDate(note.authoredAt)} {formatTime(note.authoredAt)} ·{' '}
                    {relativeDayLabel(note.authoredAt)}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-body-sm leading-relaxed text-text-secondary">
                    {note.body}
                  </p>
                  {mine && (onEdit !== undefined || onSign !== undefined) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {onEdit !== undefined ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={FilePenLine}
                          aria-label={`Edit note: ${note.title}`}
                          onClick={() => onEdit(note)}
                        >
                          Edit
                        </Button>
                      ) : null}
                      {onSign !== undefined ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          leadingIcon={PenLine}
                          aria-label={`Sign note: ${note.title}`}
                          onClick={() => onSign(note)}
                        >
                          Sign
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Stack>
  );
}
