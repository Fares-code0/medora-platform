import { useEffect, useState } from 'react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Button, Checkbox, Modal, Textarea } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import {
  REVIEW_BLOCKED_META,
  assessReviewability,
  criticalResults,
  type ReviewableTest,
} from '../model/review';
import { LAB_RESULT_FLAG_META, type LabTest } from '../model/types';

/**
 * "Mark reviewed" (D-11, UX §2.6) — and the shape of it changes with the
 * result, which is the whole point.
 *
 * A result with nothing out of range is one button: there is nothing to
 * acknowledge, and making a doctor tick a box to confirm a normal CBC is how
 * confirmation steps stop being read. A result carrying a **critical** value
 * is a different screen: every critical analyte is listed with its own
 * checkbox, and a note saying what was done about it is required.
 *
 * **Fail closed.** The confirm button is not merely disabled while the ticks
 * are missing — there is no `ReviewableTest` to submit, because
 * `assessReviewability` is the only producer of one and it refuses. The
 * button reflects that state; it does not create it. `onConfirm` is typed to
 * take the value, so a future refactor that re-enables the button cannot
 * accidentally submit anything.
 *
 * The dialog stays open and busy while the write runs (`ConfirmationDialog`'s
 * `loading` contract), and the caller closes it only on success — a failed
 * write leaves the doctor looking at the same unreviewed result, which is
 * what UX §2.6 asks for.
 */

export interface MarkReviewedDialogProps {
  open: boolean;
  test: LabTest | null;
  reviewer: string;
  onClose: () => void;
  onConfirm: (reviewable: ReviewableTest) => void;
  submitting: boolean;
  /** Set when the last attempt failed; the dialog stays open and says so. */
  errorMessage: string | null;
}

export function MarkReviewedDialog({
  open,
  test,
  reviewer,
  onClose,
  onConfirm,
  submitting,
  errorMessage,
}: MarkReviewedDialogProps) {
  const [acknowledged, setAcknowledged] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');

  /*
   * Reset per result, not per open: the dialog is reused across rows, and an
   * acknowledgment ticked for one patient's potassium must never carry into
   * the next patient's. Keyed on the id so re-opening the SAME result after a
   * failed write keeps what was typed.
   */
  useEffect(() => {
    setAcknowledged([]);
    setNote('');
  }, [test?.id]);

  if (test === null) return null;

  const critical = criticalResults(test);
  const { reviewable, blockedBy } = assessReviewability({
    test,
    reviewedBy: reviewer,
    acknowledgedCriticalIds: acknowledged,
    note,
  });

  const toggle = (resultId: string) =>
    setAcknowledged((previous) =>
      previous.includes(resultId)
        ? previous.filter((id) => id !== resultId)
        : [...previous, resultId],
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={critical.length > 0 ? 'Acknowledge and mark reviewed' : 'Mark this result reviewed'}
      description={`${test.testName} · ${test.id} · ${test.patient.name} (MRN ${test.patient.mrn})`}
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
            disabled={reviewable === null}
            onClick={() => {
              if (reviewable !== null) onConfirm(reviewable);
            }}
          >
            {critical.length > 0 ? 'Acknowledge & mark reviewed' : 'Mark reviewed'}
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        {errorMessage !== null ? (
          <Alert variant="error" critical title="The result was not marked reviewed">
            {errorMessage} Nothing was recorded — this result is still awaiting review.
          </Alert>
        ) : null}

        {critical.length > 0 ? (
          <>
            <Alert
              variant="error"
              critical
              title={`${String(critical.length)} critical value${critical.length === 1 ? '' : 's'} on this result`}
            >
              UX §2.6 makes review mandatory here. Acknowledge each value and record what was done
              about it; both are stored on the result with your name against them.
            </Alert>

            <fieldset className="min-w-0">
              <legend className="mb-2 text-body-sm font-medium text-text-primary">
                Critical values
              </legend>
              <Stack gap={2}>
                {critical.map((result) => (
                  <div
                    key={result.id}
                    className="rounded-surface border border-error bg-error-subtle p-3"
                  >
                    <Checkbox
                      checked={acknowledged.includes(result.id)}
                      onChange={() => toggle(result.id)}
                      disabled={submitting}
                      label={`${result.analyte} ${result.value}${result.unit ? ` ${result.unit}` : ''}`}
                      description={`Reference ${result.referenceRange.text}${
                        result.unit ? ` ${result.unit}` : ''
                      } — I have seen this value and acted on it.`}
                    />
                    <div className="mt-2 ps-7">
                      <StatusBadge
                        status={LAB_RESULT_FLAG_META[result.flag].kind}
                        label={LAB_RESULT_FLAG_META[result.flag].label}
                      />
                    </div>
                  </div>
                ))}
              </Stack>
            </fieldset>

            <Textarea
              label="What was done about it"
              required
              rows={3}
              value={note}
              disabled={submitting}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Patient called, advised to attend ED; repeat sample requested."
              helperText="Recorded on the result. Required before a critical value can be signed off."
            />
          </>
        ) : (
          <p className="text-body-sm text-text-secondary">
            All {test.results.length} released value{test.results.length === 1 ? '' : 's'} are
            within their reference ranges. Marking this reviewed records{' '}
            <span className="font-medium text-text-primary">{reviewer}</span> against it and takes
            it out of the Inbox. Collected {formatDate(test.collectedDate ?? test.requestedDate)}.
          </p>
        )}

        {reviewable === null && blockedBy !== 'no-reviewer' ? (
          <p role="status" className="text-caption text-text-tertiary">
            {REVIEW_BLOCKED_META[blockedBy]}
          </p>
        ) : null}
      </Stack>
    </Modal>
  );
}
