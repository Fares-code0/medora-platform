import type { LabAnnotation, LabTest } from './types';

/**
 * The annotation rule (D-15) — small, but shaped like D-11's review so the
 * module has one idiom rather than two.
 *
 * There is exactly one rule: a note must have text. That is not worth a
 * blocking screen, but it is worth making unrepresentable, because the
 * alternative — a disabled button — leaves the service willing to append an
 * empty note to a patient's result if anything ever calls it directly.
 */

const ANNOTATABLE = Symbol('annotatable');

/** The only value `LabService.annotate` accepts. */
export interface AnnotatableNote {
  readonly [ANNOTATABLE]: true;
  readonly labId: string;
  readonly text: string;
  readonly author: string;
  /** null = the order as a whole; otherwise the analyte being commented on. */
  readonly resultId: string | null;
}

export type AnnotationBlockedReason = 'empty-text' | 'no-author' | 'unknown-analyte';

export const ANNOTATION_BLOCKED_META: Record<AnnotationBlockedReason, string> = {
  'empty-text': 'Write a note before saving.',
  'no-author': 'No signed-in clinician to attribute this note to.',
  'unknown-analyte': 'That analyte is not part of this result.',
};

export interface AnnotationInput {
  readonly test: LabTest;
  readonly text: string;
  readonly author: string;
  readonly resultId: string | null;
}

export type AnnotationResult =
  | { readonly annotatable: AnnotatableNote; readonly blockedBy: null }
  | { readonly annotatable: null; readonly blockedBy: AnnotationBlockedReason };

/** The only producer of `AnnotatableNote`. */
export function assessAnnotation(input: AnnotationInput): AnnotationResult {
  const { test, text, author, resultId } = input;

  const trimmed = text.trim();
  if (trimmed === '') return { annotatable: null, blockedBy: 'empty-text' };
  if (author.trim() === '') return { annotatable: null, blockedBy: 'no-author' };
  /*
   * A note pinned to an analyte that is not on this order would render
   * against nothing and read, to the next clinician, as a note about the
   * order as a whole. Refused rather than silently re-scoped.
   */
  if (resultId !== null && !test.results.some((result) => result.id === resultId)) {
    return { annotatable: null, blockedBy: 'unknown-analyte' };
  }

  return {
    annotatable: {
      [ANNOTATABLE]: true,
      labId: test.id,
      text: trimmed,
      author,
      resultId,
    },
    blockedBy: null,
  };
}

export class NotAnnotatableError extends Error {
  constructor() {
    super('Value was not produced by assessAnnotation');
    this.name = 'NotAnnotatableError';
  }
}

/** Refuses a forged value at runtime, the way `assertReviewable` does. */
export function assertAnnotatable(value: AnnotatableNote): void {
  if (value[ANNOTATABLE] !== true) throw new NotAnnotatableError();
}

/** Builds the stored record. The disclosure wording lives here, once. */
export function toStoredAnnotation(note: AnnotatableNote, now: Date): LabAnnotation {
  const createdAt = now.toISOString();
  return {
    id: `${note.labId}-an-${createdAt}`,
    text: note.text,
    author: note.author,
    createdAt,
    resultId: note.resultId,
    note: 'Recorded in this demo session only — no laboratory system is connected.',
  };
}
