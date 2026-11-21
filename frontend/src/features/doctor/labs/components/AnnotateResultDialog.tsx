import { useEffect, useMemo, useState } from 'react';

import { Alert } from '@/components/feedback';
import { Button, Modal, Select, Textarea } from '@/components/ui';

import {
  ANNOTATION_BLOCKED_META,
  assessAnnotation,
  type AnnotatableNote,
} from '../model/annotation';
import type { LabTest } from '../model/types';

/**
 * Annotate a result (D-15) — a clinician's note on the order, or on one
 * analyte within it.
 *
 * **Scoping is a real choice, not a nicety.** A note reading "consistent with
 * the diuretic" means something different pinned to the potassium than
 * floating over a metabolic panel, and the next clinician cannot recover the
 * intent from the text. So the analyte picker is present whenever the result
 * has more than one released value, and defaults to the order as a whole
 * rather than guessing an analyte.
 *
 * Save is gated by `assessAnnotation`, whose refusal reasons are shown as
 * text rather than only by disabling the button: a disabled control with no
 * explanation is the thing D-11's screen exists to avoid.
 */

export interface AnnotateResultDialogProps {
  open: boolean;
  test: LabTest | null;
  author: string;
  onClose: () => void;
  onConfirm: (note: AnnotatableNote) => void;
  submitting: boolean;
  /** Set when the last attempt failed; the dialog stays open and says so. */
  errorMessage?: string | null;
}

export function AnnotateResultDialog({
  open,
  test,
  author,
  onClose,
  onConfirm,
  submitting,
  errorMessage,
}: AnnotateResultDialogProps) {
  const [text, setText] = useState('');
  const [resultId, setResultId] = useState<string>('');

  // A fresh note per opening. Carrying the previous one over risks filing a
  // note written about one patient's result onto another's.
  useEffect(() => {
    if (open) {
      setText('');
      setResultId('');
    }
  }, [open, test?.id]);

  const assessment = useMemo(() => {
    if (test === null) return null;
    return assessAnnotation({
      test,
      text,
      author,
      resultId: resultId === '' ? null : resultId,
    });
  }, [test, text, author, resultId]);

  if (test === null) return null;

  const blocked = assessment?.blockedBy ?? null;
  /*
   * Nag once they have typed anything at all — `text`, not `text.trim()`.
   * Trimming here was a bug caught in the browser: a field holding only
   * spaces is refused by `assessAnnotation` and the button goes dead, but
   * the trimmed check said "nothing typed yet" and withheld the reason, so
   * the doctor saw a disabled Save and no explanation. That is precisely
   * the failure mode this dialog is supposed to avoid.
   */
  const showBlocked = blocked !== null && text !== '';
  const annotatable = assessment?.annotatable ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a note"
      description={`${test.testName} · ${test.patient.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={annotatable === null || submitting}
            onClick={() => {
              if (annotatable !== null) onConfirm(annotatable);
            }}
          >
            {submitting ? 'Saving…' : 'Save note'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {errorMessage !== null && errorMessage !== undefined ? (
          <Alert variant="error" title="The note was not saved">
            {errorMessage}
          </Alert>
        ) : null}

        {test.results.length > 1 ? (
          <Select
            label="About"
            value={resultId}
            onChange={setResultId}
            options={[
              { value: '', label: 'This result as a whole' },
              ...test.results.map((result) => ({
                value: result.id,
                label: `${result.analyte} — ${result.value} ${result.unit}`.trim(),
              })),
            ]}
          />
        ) : null}

        <Textarea
          label="Note"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          placeholder="What should the next clinician reading this know?"
          helperText="Attributed to you and timestamped. Notes cannot be edited or removed once saved."
          {...(showBlocked ? { error: ANNOTATION_BLOCKED_META[blocked] } : {})}
        />
      </div>
    </Modal>
  );
}
