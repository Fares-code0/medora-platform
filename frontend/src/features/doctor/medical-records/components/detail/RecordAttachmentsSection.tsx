import { Download, Eye, Paperclip } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge, Button, IconButton, Tooltip } from '@/components/ui';
import { useRecordAttachmentsQuery } from '@/features/shared-domain/record-attachments';
import { routes } from '@/routes';
import { formatDate } from '@/utils/dates';
import { exportPdf, openPdfPreview } from '@/utils/export';

import { recordAttachmentDataset } from '../../model/record-export';
import { RECORD_ATTACHMENT_KIND_META, type MedicalRecord } from '../../model/types';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/**
 * Attachments — files linked to the encounter. View opens the attachment
 * summary as a PDF in a new tab; Download saves it — both go through the
 * shared export engine, so every action produces a real file.
 *
 * **Lab reports filed here by D-14 render alongside them**, read from
 * `shared-domain/record-attachments`. This is the half of attach-to-record
 * that makes the other half honest: without it the Labs screen would report
 * "attached to this record" and the record would show nothing. They are
 * listed separately, and each links back to the result it came from, because
 * a lab report on a chart is a pointer to a result rather than a file
 * somebody uploaded.
 */

function formatSize(sizeKb: number): string {
  return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${String(sizeKb)} KB`;
}

export function RecordAttachmentsSection({ record }: { record: MedicalRecord }) {
  const labReports = useRecordAttachmentsQuery(record.id);
  const filed = labReports.data ?? [];

  return (
    <RecordSectionCard title="Attachments">
      {record.attachments.length === 0 && filed.length === 0 ? (
        <EmptySectionNote>No files are attached to this record.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {record.attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Paperclip
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-text-tertiary"
                  strokeWidth={1.75}
                />
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-text-primary">
                    {attachment.name}
                  </p>
                  <p className="text-caption text-text-tertiary">
                    <span dir="ltr">{formatSize(attachment.sizeKb)}</span> · {attachment.uploadedBy}{' '}
                    · {formatDate(attachment.uploadedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="neutral">
                  {RECORD_ATTACHMENT_KIND_META[attachment.kind].label}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Eye}
                  onClick={() => openPdfPreview(recordAttachmentDataset(record, attachment))}
                >
                  View
                </Button>
                <Tooltip content="Download">
                  <IconButton
                    icon={Download}
                    size="sm"
                    aria-label={`Download ${attachment.name}`}
                    onClick={() => exportPdf(recordAttachmentDataset(record, attachment))}
                  />
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}

      {filed.length > 0 ? (
        <div className="mt-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
            Laboratory reports
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {filed.map((attachment) => (
              <li
                key={attachment.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Paperclip
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-text-tertiary"
                    strokeWidth={1.75}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-text-primary">
                      {attachment.name}
                    </p>
                    <p className="text-caption text-text-tertiary">
                      {attachment.resultCount} value{attachment.resultCount === 1 ? '' : 's'}
                      {attachment.abnormalCount > 0
                        ? `, ${String(attachment.abnormalCount)} abnormal`
                        : ''}{' '}
                      · {attachment.attachedBy} · {formatDate(attachment.attachedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {attachment.hasCriticalResult ? (
                    <Badge variant="error">Critical value</Badge>
                  ) : null}
                  <Badge variant="neutral">Lab result</Badge>
                  <Link
                    to={routes.doctor.labReport(attachment.labId)}
                    className="rounded-control text-body-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Open result
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </RecordSectionCard>
  );
}
