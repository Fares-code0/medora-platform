import {
  CheckCheck,
  EllipsisVertical,
  Eye,
  FileDown,
  FolderHeart,
  LineChart,
  MessageSquarePlus,
  Paperclip,
  Printer,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button, Dropdown, IconButton, Tooltip, type MenuEntry } from '@/components/ui';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';
import { exportPdf, printDataset } from '@/utils/export';

import { labReportDataset } from '../model/lab-export';
import type { LabTest } from '../model/types';

/**
 * Per-test actions — D-11/D-13/D-14 turned the ⋯ menu from a navigation strip
 * into a worklist control.
 *
 * **Mark reviewed is a button, not a menu item, and only when it applies.**
 * It is the action UX §2.6 makes mandatory for critical results, and burying
 * a mandatory action two clicks deep behind an ellipsis is how it gets
 * skipped. A result already reviewed, or one with nothing released, gets no
 * button at all — the affordance follows the state rather than appearing
 * disabled beside every row.
 */

export interface LabRowActionsProps {
  test: LabTest;
  onOpenTest: (test: LabTest) => void;
  /** Omitted where the review loop is not wired (none today; kept honest). */
  review?:
    | {
        readonly canReview: boolean;
        readonly canAttach: boolean;
        readonly canTrend: boolean;
        readonly isCritical: boolean;
        readonly onMarkReviewed: () => void;
        readonly onAttach: () => void;
        readonly onViewTrend: () => void;
        /** Null when the service keeps no annotations (`capabilities.annotations`). */
        readonly onAnnotate: (() => void) | null;
      }
    | undefined;
}

export function LabRowActions({ test, onOpenTest, review }: LabRowActionsProps) {
  const navigate = useNavigate();

  const entries: MenuEntry[] = [
    { id: 'view-test', label: 'View result', icon: Eye, onSelect: () => onOpenTest(test) },
    ...(review?.canTrend === true
      ? [
          {
            id: 'view-trend',
            label: 'View trend',
            icon: LineChart,
            onSelect: review.onViewTrend,
          } satisfies MenuEntry,
        ]
      : []),
    ...(review?.canAttach === true
      ? [
          {
            id: 'attach-record',
            label: 'Attach to record',
            icon: Paperclip,
            onSelect: review.onAttach,
          } satisfies MenuEntry,
        ]
      : []),
    ...(review !== undefined && review.onAnnotate !== null
      ? [
          {
            // Not gated on results: a note is worth writing on an order
            // still in the lab ("chased, verbally reported") as much as on
            // a released one.
            id: 'annotate',
            label: 'Add note',
            icon: MessageSquarePlus,
            onSelect: review.onAnnotate,
          } satisfies MenuEntry,
        ]
      : []),
    {
      id: 'view-patient',
      label: 'View patient',
      icon: UserRound,
      onSelect: () => navigate(routes.doctor.patient(test.patient.id)),
    },
    {
      id: 'view-record',
      label: 'View medical record',
      icon: FolderHeart,
      onSelect: () => navigate(`${routes.doctor.medicalRecords}?patient=${test.patient.id}`),
    },
    { type: 'separator', id: 'sep-documents' },
    {
      id: 'print',
      label: 'Print report',
      icon: Printer,
      onSelect: () => printDataset(labReportDataset(test)),
    },
    {
      id: 'export-pdf',
      label: 'Export PDF',
      icon: FileDown,
      onSelect: () => exportPdf(labReportDataset(test)),
    },
    {
      id: 'ai',
      label: 'AI analysis',
      icon: MedoraAiLogo,
      onSelect: () =>
        navigate(
          `${routes.doctor.assistant}?context=labs&refId=${test.id}&patientId=${test.patient.id}`,
        ),
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      {review?.canReview === true ? (
        <Button
          size="sm"
          variant={review.isCritical ? 'primary' : 'ghost'}
          leadingIcon={CheckCheck}
          onClick={review.onMarkReviewed}
          // The visible label stays one word: the column is narrow and the
          // full sentence belongs to assistive tech, not to the layout.
          aria-label={
            review.isCritical
              ? `Acknowledge the critical values on ${test.id} and mark it reviewed`
              : `Mark lab result ${test.id} reviewed`
          }
        >
          Review
        </Button>
      ) : null}
      <Tooltip content="View result">
        <IconButton
          icon={Eye}
          size="sm"
          aria-label={`View lab result ${test.id}`}
          onClick={() => onOpenTest(test)}
        />
      </Tooltip>
      <Dropdown
        align="end"
        menuLabel={`Actions for ${test.id}`}
        entries={entries}
        trigger={
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            aria-label={`More actions for ${test.id}`}
          />
        }
      />
    </div>
  );
}
