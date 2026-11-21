import { describe, expect, it } from 'vitest';

import {
  NotAnnotatableError,
  assertAnnotatable,
  assessAnnotation,
  toStoredAnnotation,
  type AnnotatableNote,
} from './annotation';
import type { LabResultItem, LabTest } from './types';

/**
 * The D-15 annotation rule. Small, but shaped like D-11's review: the only
 * producer of the value the service accepts is `assessAnnotation`, so an
 * empty note is unrepresentable rather than merely refused by a disabled
 * button.
 */

function result(id: string, analyte: string): LabResultItem {
  return {
    id,
    analyte,
    value: '4.4',
    numericValue: 4.4,
    unit: 'mmol/L',
    referenceRange: { low: 3.5, high: 5.1, text: '3.5–5.1' },
    flag: 'normal',
  };
}

const TEST = {
  id: 'LAB-1',
  results: [result('r1', 'Potassium'), result('r2', 'Sodium')],
} as unknown as LabTest;

const base = { test: TEST, author: 'Dr. Amelia Chen', resultId: null };

describe('assessAnnotation', () => {
  it('produces a value for a note with text', () => {
    const { annotatable, blockedBy } = assessAnnotation({ ...base, text: 'Chased with the lab.' });
    expect(blockedBy).toBeNull();
    expect(annotatable?.text).toBe('Chased with the lab.');
    expect(annotatable?.labId).toBe('LAB-1');
  });

  it('trims, so a note of spaces is empty rather than saved as blank', () => {
    expect(assessAnnotation({ ...base, text: '   ' }).blockedBy).toBe('empty-text');
    expect(assessAnnotation({ ...base, text: '  hi  ' }).annotatable?.text).toBe('hi');
  });

  it('refuses an unattributed note', () => {
    expect(assessAnnotation({ ...base, text: 'x', author: '  ' }).blockedBy).toBe('no-author');
  });

  it('scopes to an analyte on the order', () => {
    const { annotatable } = assessAnnotation({ ...base, text: 'High-ish', resultId: 'r1' });
    expect(annotatable?.resultId).toBe('r1');
  });

  it('refuses an analyte that is not on this order rather than silently re-scoping it', () => {
    /*
     * Falling back to "the order as a whole" would file a note written about
     * one analyte as a comment on the panel, and the next reader could not
     * tell from the text which was meant.
     */
    const { annotatable, blockedBy } = assessAnnotation({
      ...base,
      text: 'About the calcium',
      resultId: 'r-nope',
    });
    expect(annotatable).toBeNull();
    expect(blockedBy).toBe('unknown-analyte');
  });
});

describe('assertAnnotatable', () => {
  it('accepts a value the assessment produced', () => {
    const { annotatable } = assessAnnotation({ ...base, text: 'ok' });
    expect(annotatable).not.toBeNull();
    expect(() => {
      assertAnnotatable(annotatable as AnnotatableNote);
    }).not.toThrow();
  });

  it('refuses a forged one at runtime, not only in the type system', () => {
    const forged = {
      labId: 'LAB-1',
      text: '',
      author: 'nobody',
      resultId: null,
    } as unknown as AnnotatableNote;
    expect(() => {
      assertAnnotatable(forged);
    }).toThrow(NotAnnotatableError);
  });
});

describe('toStoredAnnotation', () => {
  it('attributes, timestamps, and carries its own disclosure', () => {
    const { annotatable } = assessAnnotation({ ...base, text: 'Verbally reported.' });
    const stored = toStoredAnnotation(annotatable as AnnotatableNote, new Date('2026-09-01T10:00:00Z'));
    expect(stored.author).toBe('Dr. Amelia Chen');
    expect(stored.createdAt).toBe('2026-09-01T10:00:00.000Z');
    // The UI renders this verbatim rather than restating it, so a real
    // backend drops the caveat by answering differently.
    expect(stored.note).toContain('no laboratory system is connected');
  });
});
