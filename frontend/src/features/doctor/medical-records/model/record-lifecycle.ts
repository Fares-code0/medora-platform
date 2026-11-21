import type { MedicalRecord, MedicalRecordStatus, RecordClinicalNote } from './types';

/**
 * The record lifecycle (D-21) — what may change, when, and by whom.
 *
 * The Phase-6 module shipped `MedicalRecordStatus` and `RecordClinicalNote.signed`
 * and then never wrote either: there was no transition map, no signing path,
 * and no rule about what a signed note means. This module is those rules, and
 * it is pure, so "may this be signed?" has exactly one answer and it is
 * answerable in a unit test.
 *
 * Two properties it exists to guarantee:
 *
 * 1. **A signed note is never rewritten.** UX §2.3 shows notes as
 *    signed/unsigned and nothing in it edits a signed one. That is not a
 *    stylistic choice — a clinical note is a legal record of what a clinician
 *    believed at a time, so a correction is an *addendum* that stands beside
 *    it, never a mutation that replaces it. `amend` appends; there is no
 *    `editNote` on the port at all, so rewriting one is a compile error
 *    rather than a missing button.
 *
 * 2. **A signature is unforgeable.** `assessNoteSignability` is the only
 *    producer of `SignableNote`, that type carries a module-private symbol,
 *    and the mutation and the adapter both demand one — the shape the
 *    pharmacy's `assessSignability` and the labs' `assessReviewability`
 *    already use. A note with an empty body, a note already signed, and a
 *    note belonging to someone else all reach the same place: there is no
 *    value to hand to the service, and none can be forged.
 */

/* ── Status transitions ─────────────────────────────────────────── */

/**
 * The encounter lifecycle. `draft` is being written; `active` is a live
 * encounter with at least one signed note; `completed` is finished care;
 * `archived` is out of the working set.
 *
 * Nothing returns to `draft`: once a note on the record is signed there is a
 * signed clinical statement in the world, and a status that says "still being
 * written" would be a lie about it. Archiving is likewise terminal — an
 * archived record is unarchived by a person with a reason, which is an admin
 * capability rather than a doctor's.
 */
export const RECORD_STATUS_TRANSITIONS: Record<
  MedicalRecordStatus,
  readonly MedicalRecordStatus[]
> = {
  draft: ['active'],
  active: ['completed'],
  completed: ['archived'],
  archived: [],
};

export function canTransition(from: MedicalRecordStatus, to: MedicalRecordStatus): boolean {
  return RECORD_STATUS_TRANSITIONS[from].includes(to);
}

/** The transitions a doctor may perform from here, for building the control. */
export function allowedTransitions(
  record: MedicalRecord,
): readonly MedicalRecordStatus[] {
  /*
   * A draft only becomes active once something on it is signed. Otherwise
   * "active encounter" would describe a record whose every statement is still
   * provisional — which is exactly what `draft` already says.
   */
  if (record.status === 'draft' && !hasSignedNote(record)) return [];
  return RECORD_STATUS_TRANSITIONS[record.status];
}

/* ── Notes ──────────────────────────────────────────────────────── */

export function hasSignedNote(record: MedicalRecord): boolean {
  return record.notes.some((note) => note.signed);
}

export function unsignedNotes(record: MedicalRecord): readonly RecordClinicalNote[] {
  return record.notes.filter((note) => !note.signed);
}

/**
 * A record accepts an addendum once it carries a signed note — before that,
 * the unsigned note is still the working draft and there is nothing to
 * append *to*. An archived record accepts nothing.
 *
 * A record with **no notes at all** accepts one: that is a record whose
 * first note failed to save after the record itself was created (the two
 * are separate requests to the records service), and without this it could
 * never be given one.
 */
export function canAmend(record: MedicalRecord): boolean {
  return record.status !== 'archived' && (hasSignedNote(record) || record.notes.length === 0);
}

/**
 * DEC-004: a record's fields may be edited only while it is a draft with
 * nothing on it signed. Once a note is signed the record is relied on, and
 * corrections are addenda. The server is looser (it also edits `active`
 * records); this is the stricter rule the owner chose.
 */
export function canEditRecord(record: MedicalRecord): boolean {
  return record.status === 'draft' && !hasSignedNote(record);
}

/* ── Signability — the unforgeable part ─────────────────────────── */

const SIGNABLE: unique symbol = Symbol('medora.records.signable-note');

export interface SignableNote {
  readonly [SIGNABLE]: true;
  readonly recordId: string;
  readonly noteId: string;
  readonly signedBy: string;
}

export type NoteSignBlockedReason =
  | 'not-found'
  | 'already-signed'
  | 'empty-body'
  | 'no-signer'
  | 'not-the-author'
  | 'record-archived';

export const NOTE_SIGN_BLOCKED_META: Record<NoteSignBlockedReason, string> = {
  'not-found': 'That note is not on this record.',
  'already-signed': 'This note is already signed. Add an addendum instead.',
  'empty-body': 'A note needs content before it can be signed.',
  'no-signer': 'The signing clinician is unknown.',
  'not-the-author': 'Only the clinician who wrote a note can sign it.',
  'record-archived': 'This record is archived and cannot be changed.',
};

export interface NoteSignabilityInput {
  readonly record: MedicalRecord;
  readonly noteId: string;
  readonly signedBy: string;
}

export type NoteSignabilityResult =
  | { readonly signable: SignableNote; readonly blockedBy: null }
  | { readonly signable: null; readonly blockedBy: NoteSignBlockedReason };

/**
 * The only producer of `SignableNote`.
 *
 * The author check is the one rule here that is clinical rather than
 * structural: a signature attests that *this clinician* stands behind what
 * the note says, so signing somebody else's note is not a permission problem
 * to be granted, it is a different act (an addendum, under your own name).
 */
export function assessNoteSignability(input: NoteSignabilityInput): NoteSignabilityResult {
  const { record, noteId, signedBy } = input;

  if (record.status === 'archived') return { signable: null, blockedBy: 'record-archived' };
  if (signedBy.trim() === '') return { signable: null, blockedBy: 'no-signer' };

  const note = record.notes.find((candidate) => candidate.id === noteId);
  if (note === undefined) return { signable: null, blockedBy: 'not-found' };
  if (note.signed) return { signable: null, blockedBy: 'already-signed' };
  if (note.body.trim() === '') return { signable: null, blockedBy: 'empty-body' };
  if (note.author !== signedBy) return { signable: null, blockedBy: 'not-the-author' };

  return {
    signable: { [SIGNABLE]: true, recordId: record.id, noteId: note.id, signedBy },
    blockedBy: null,
  };
}

export class NotSignableNoteError extends Error {
  constructor() {
    super('Refusing to sign: the value did not come from a completed signability check.');
    this.name = 'NotSignableNoteError';
  }
}

/** The runtime half of the guarantee — a cast does not survive this. */
export function assertSignableNote(value: SignableNote): void {
  const candidate = value as unknown as Record<symbol, unknown> | null;
  if (typeof candidate !== 'object' || candidate === null || candidate[SIGNABLE] !== true) {
    throw new NotSignableNoteError();
  }
}
