import { MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import type { LabTest } from '../../model/types';

import { LabSectionCard } from './LabSectionCard';

/**
 * Clinician notes on this result (D-15).
 *
 * Rendered as its own section rather than folded into the timeline: the
 * timeline is what the laboratory did, this is what a clinician thinks. A
 * reader must not mistake a colleague's interpretation for something the lab
 * asserted.
 *
 * The disclosure line comes from `annotation.note` on the record rather than
 * being written here, so a real backend that stops needing the caveat drops
 * it by answering differently — the DX-10 contract.
 */

export interface LabAnnotationsSectionProps {
  test: LabTest;
  /** Null when the service keeps no annotations (`capabilities.annotations`). */
  onAnnotate: (() => void) | null;
}

export function LabAnnotationsSection({ test, onAnnotate }: LabAnnotationsSectionProps) {
  const analyteName = (resultId: string | null) =>
    resultId === null
      ? null
      : (test.results.find((result) => result.id === resultId)?.analyte ?? null);

  return (
    <LabSectionCard
      title="Notes"
      caption={
        test.annotations.length === 0
          ? undefined
          : `${String(test.annotations.length)} note${test.annotations.length === 1 ? '' : 's'}`
      }
      actions={
        onAnnotate === null ? undefined : (
          <Button variant="secondary" size="sm" leadingIcon={MessageSquarePlus} onClick={onAnnotate}>
            Add note
          </Button>
        )
      }
    >
      {onAnnotate === null ? (
        // Not "no notes": the service has nowhere to keep them, so an empty
        // list would claim an absence nobody checked.
        <p className="text-body-sm text-text-secondary">
          Notes on results are not available from the laboratory service yet.
        </p>
      ) : test.annotations.length === 0 ? (
        <p className="text-body-sm text-text-secondary">
          No notes on this result yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {test.annotations.map((annotation) => {
            const analyte = analyteName(annotation.resultId);
            return (
              <li key={annotation.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <p className="whitespace-pre-wrap text-body-sm text-text-primary">
                  {annotation.text}
                </p>
                <p className="text-caption text-text-tertiary">
                  {annotation.author} · {formatDate(annotation.createdAt)} {formatTime(annotation.createdAt)}
                  {analyte === null ? '' : ` · about ${analyte}`}
                </p>
                {/*
                  * Secondary, not tertiary: this is the DX-10 honesty marker
                  * saying nothing was transmitted. A caveat rendered in the
                  * faintest tint is one a reader skips, which defeats the
                  * only reason it is on screen. The attribution line above
                  * stays tertiary — author and timestamp are the glanceable
                  * metadata tertiary exists for, matching the reviewer line
                  * in LabCells.
                  */}
                <p className="text-caption text-text-secondary">{annotation.note}</p>
              </li>
            );
          })}
        </ul>
      )}
    </LabSectionCard>
  );
}
