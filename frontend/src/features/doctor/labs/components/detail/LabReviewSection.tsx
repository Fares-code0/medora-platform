import { Paperclip } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Fact, FactGrid } from '@/components/patterns';
import { Button } from '@/components/ui';
import { useLabAttachmentsQuery } from '@/features/shared-domain/record-attachments';
import { formatDate, formatTime } from '@/utils/dates';

import { criticalResults } from '../../model/review';
import type { LabTest } from '../../model/types';

import { EmptySectionNote, LabSectionCard } from './LabSectionCard';

/**
 * Review status on the result itself (D-11 / D-14).
 *
 * The list column answers "does this need me"; this section answers "what was
 * decided, by whom, and what happened next" — the two questions a covering
 * colleague and an auditor ask, and the reason the acknowledgment note is
 * shown in full here rather than summarised.
 *
 * The attachment list lives here too, next to the review it usually follows,
 * and it is read from `shared-domain/record-attachments` — the same store the
 * medical record renders from. Neither screen keeps its own copy, so the Labs
 * page cannot claim an attachment the record does not carry.
 */
export function LabReviewSection({
  test,
  onAttach,
}: {
  test: LabTest;
  onAttach: (() => void) | undefined;
}) {
  const attachments = useLabAttachmentsQuery(test.id);
  const critical = criticalResults(test);
  const filed = attachments.data ?? [];

  if (test.results.length === 0) {
    return (
      <LabSectionCard title="Review">
        <EmptySectionNote>
          Nothing has been released for this order yet, so there is nothing to review.
        </EmptySectionNote>
      </LabSectionCard>
    );
  }

  return (
    <LabSectionCard
      title="Review"
      caption="Who signed off on this result, and where it was filed."
      /*
       * "Mark reviewed" is deliberately NOT repeated here. It is the page's
       * primary action in the header, and two buttons with the same name on
       * one page is an ambiguity for a keyboard or screen-reader user with no
       * benefit for anyone else. Attach is the section's own action.
       */
      actions={
        onAttach !== undefined ? (
          <Button variant="secondary" size="sm" leadingIcon={Paperclip} onClick={onAttach}>
            Attach to record
          </Button>
        ) : null
      }
    >
      <Stack gap={4}>
        {test.review === null ? (
          <Alert
            variant={critical.length > 0 ? 'error' : 'warning'}
            critical={critical.length > 0}
            title={
              critical.length > 0
                ? `Awaiting review — ${String(critical.length)} critical value${critical.length === 1 ? '' : 's'}`
                : 'Awaiting review'
            }
          >
            {critical.length > 0
              ? 'UX §2.6 makes review mandatory here: each critical value has to be acknowledged and what was done about it recorded.'
              : 'This result is in your Inbox until it is marked reviewed.'}
          </Alert>
        ) : (
          <>
            <FactGrid>
              <Fact label="Reviewed by">{test.review.reviewedBy}</Fact>
              <Fact label="Reviewed at">
                {formatDate(test.review.reviewedAt)} · {formatTime(test.review.reviewedAt)}
              </Fact>
              <Fact label="Critical values acknowledged">
                {critical.length === 0
                  ? 'None on this result'
                  : test.review.acknowledgedCriticalIds === null
                    ? // Not served, but a review over a critical value cannot
                      // exist without every one acknowledged (API §8.7).
                      `All ${String(critical.length)}`
                    : `${String(test.review.acknowledgedCriticalIds.length)} of ${String(critical.length)}`}
              </Fact>
            </FactGrid>
            {test.review.note !== null && test.review.note !== '' ? (
              <div className="rounded-surface border border-border bg-surface-sunken p-3">
                <p className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
                  What was done
                </p>
                <p className="mt-1 text-body-sm text-text-primary">{test.review.note}</p>
              </div>
            ) : null}
          </>
        )}

        <div>
          <p className="text-body-sm font-medium text-text-primary">Filed to medical records</p>
          {filed.length === 0 ? (
            <p className="mt-1 text-caption text-text-tertiary">
              This report is not attached to any encounter yet.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-border">
              {filed.map((attachment) => (
                <li key={attachment.id} className="py-2 first:pt-0 last:pb-0">
                  <p className="flex items-center gap-2 text-body-sm text-text-primary">
                    <Paperclip
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-text-tertiary"
                      strokeWidth={1.75}
                    />
                    {attachment.name}
                  </p>
                  <p className="ps-6 text-caption text-text-tertiary">
                    Record <span className="font-mono">{attachment.recordId}</span> ·{' '}
                    {attachment.attachedBy} · {formatDate(attachment.attachedAt)}
                  </p>
                  {/* The store's own wording, not this component's claim. */}
                  <p className="ps-6 text-caption text-text-tertiary">{attachment.note}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Stack>
    </LabSectionCard>
  );
}
