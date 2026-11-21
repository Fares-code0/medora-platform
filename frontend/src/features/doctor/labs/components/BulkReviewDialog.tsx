import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Modal } from '@/components/ui';

import {
  BULK_REFUSAL_META,
  assessReviewability,
  partitionForBulkReview,
  type ReviewableTest,
} from '../model/review';
import type { LabTest } from '../model/types';

/**
 * Bulk review (D-11, UX §2.6: "bulk allowed only for Normal").
 *
 * The rule is enforced by `partitionForBulkReview`, and this dialog exists to
 * show its *other* half. A bulk action that silently reviewed the four normal
 * results and quietly skipped the three abnormal ones would leave a doctor
 * believing their queue was clear; so the refused results are listed, by name
 * and with the reason, and they stay selected afterwards. The count on the
 * button is the count that will actually change.
 *
 * Every eligible test still goes through `assessReviewability` individually,
 * so the bulk path produces the same unforgeable value the single path does —
 * the eligibility rule cannot be applied here and skipped in the service.
 */

export interface BulkReviewDialogProps {
  open: boolean;
  tests: readonly LabTest[];
  reviewer: string;
  onClose: () => void;
  onConfirm: (reviewables: readonly ReviewableTest[]) => void;
  submitting: boolean;
  errorMessage: string | null;
}

export function BulkReviewDialog({
  open,
  tests,
  reviewer,
  onClose,
  onConfirm,
  submitting,
  errorMessage,
}: BulkReviewDialogProps) {
  const { eligible, refused } = partitionForBulkReview(tests);

  const reviewables = eligible
    .map(
      (test) =>
        assessReviewability({
          test,
          reviewedBy: reviewer,
          acknowledgedCriticalIds: [],
          note: '',
        }).reviewable,
    )
    .filter((value): value is ReviewableTest => value !== null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Mark ${String(reviewables.length)} normal result${reviewables.length === 1 ? '' : 's'} reviewed`}
      description="Only results with every value inside its reference range can be reviewed in bulk."
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
            disabled={reviewables.length === 0}
            onClick={() => onConfirm(reviewables)}
          >
            Mark {reviewables.length} reviewed
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        {errorMessage !== null ? (
          <Alert variant="error" critical title="Nothing was marked reviewed">
            {errorMessage} Every selected result is still awaiting review.
          </Alert>
        ) : null}

        {reviewables.length > 0 ? (
          <div>
            <p className="text-body-sm font-medium text-text-primary">
              These will be marked reviewed
            </p>
            <ul className="mt-2 flex flex-col divide-y divide-border">
              {eligible.map((test) => (
                <li key={test.id} className="py-2 first:pt-0 last:pb-0">
                  <p className="text-body-sm text-text-primary">
                    {test.patient.name} — {test.testName}
                  </p>
                  <p className="text-caption text-text-tertiary">
                    <span className="font-mono">{test.id}</span> · {test.results.length} value
                    {test.results.length === 1 ? '' : 's'}, all within range
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Alert variant="warning" title="Nothing here can be reviewed in bulk">
            Every selected result needs to be opened and reviewed on its own.
          </Alert>
        )}

        {refused.length > 0 ? (
          <div>
            <p className="text-body-sm font-medium text-text-primary">
              These will not — review them individually
            </p>
            <ul className="mt-2 flex flex-col divide-y divide-border">
              {refused.map(({ test, reason }) => (
                <li key={test.id} className="py-2 first:pt-0 last:pb-0">
                  <p className="text-body-sm text-text-primary">
                    {test.patient.name} — {test.testName}
                  </p>
                  <p className="text-caption text-text-tertiary">
                    <span className="font-mono">{test.id}</span> · {BULK_REFUSAL_META[reason]}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-text-tertiary">
              They stay selected, so nothing disappears from view when the rest go through.
            </p>
          </div>
        ) : null}
      </Stack>
    </Modal>
  );
}
