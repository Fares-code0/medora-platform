import { Download, Eye, Paperclip } from 'lucide-react';

import { Badge, Button, IconButton, Tooltip } from '@/components/ui';
import { useT } from '@/i18n';
import { formatDate } from '@/utils/dates';
import { exportPdf, openPdfPreview } from '@/utils/export';

import { labAttachmentDataset } from '../../model/lab-export';
import { LAB_ATTACHMENT_KIND_META, type LabTest } from '../../model/types';

import { EmptySectionNote, LabSectionCard } from './LabSectionCard';

/**
 * Attachments — files linked to the order (report PDF, addenda). View opens
 * the attachment summary as a PDF in a new tab; Download saves it — both go
 * through the shared export engine, so every action produces a real file.
 */

function formatSize(sizeKb: number): string {
  return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${String(sizeKb)} KB`;
}

export function LabAttachmentsSection({ test }: { test: LabTest }) {
  const t = useT();
  return (
    <LabSectionCard title="Attachments">
      {test.attachments.length === 0 ? (
        <EmptySectionNote>No files are attached to this order.</EmptySectionNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {test.attachments.map((attachment) => (
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
                  {t(LAB_ATTACHMENT_KIND_META[attachment.kind].labelKey)}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Eye}
                  onClick={() => openPdfPreview(labAttachmentDataset(test, attachment))}
                >
                  View
                </Button>
                <Tooltip content="Download">
                  <IconButton
                    icon={Download}
                    size="sm"
                    aria-label={`Download ${attachment.name}`}
                    onClick={() => exportPdf(labAttachmentDataset(test, attachment))}
                  />
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </LabSectionCard>
  );
}
