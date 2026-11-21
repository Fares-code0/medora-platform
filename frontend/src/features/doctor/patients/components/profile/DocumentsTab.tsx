import { useState } from 'react';

import { Download, Eye, Upload } from 'lucide-react';

import { Alert, EmptyState } from '@/components/feedback';
import {
  Badge,
  Button,
  DataTable,
  IconButton,
  Tooltip,
  type DataTableColumn,
} from '@/components/ui';
import { formatDate } from '@/utils/dates';

import type { PatientDocumentAccess } from '../../api/usePatientDocumentAccess';
import { DOCUMENT_STORAGE_UNAVAILABLE } from '../../model/patient-documents-service';
import { DOCUMENT_CATEGORY_META, type PatientDocument } from '../../model/profile-types';

import { UploadDocumentDialog } from './UploadDocumentDialog';

/**
 * Documents tab — the files uploaded against a patient, with their
 * category, upload metadata and size.
 *
 * **What changed at D-04.** View and Download used to build a PDF out of
 * the patient's name and assigned doctor and download it under the
 * document's filename. A doctor who pressed Download on "Referral letter —
 * cardiology.pdf" got a file with that name, three fields, and none of the
 * referral: the failure was silent, and the artefact left the browser. The
 * actions now go through the documents port (`model/patient-documents-service.ts`),
 * which is the only thing in the frontend that can produce a stored file.
 *
 * **Why the actions disappear rather than grey out.** With no document
 * service connected there is nothing to press, and a disabled button with a
 * tooltip still advertises a capability the build does not have — the
 * Imaging tab settled this at D-05, where the "View report" action was
 * removed and the tab was given a notice saying why. A single notice at the
 * top says it once for every row, instead of a tooltip that has to be
 * hunted for per file. The rows themselves stay: the metadata is real, and
 * knowing a consent form is on file is worth something even when the scan
 * cannot be opened here.
 *
 * The table is otherwise unchanged, and the actions column returns intact
 * the moment `storage` reads `available` — nothing in this file needs
 * editing on integration day.
 *
 * **Upload follows the same rule (D-04b).** The register lists "upload /
 * preview states" as frontend-owned, and they are — but the control appears
 * only when a store is connected, for the reason the read side does: an
 * upload button over storage that answers 503 invites a doctor to hand the
 * app a consent form it will drop. The button opens `UploadDocumentDialog`,
 * which asks for the category the server files it under (API §4.7, no
 * default) and the file. Accepted types, size limits and per-kind rules stay
 * the server's (API §17.1): guessing them here would produce a form that
 * disagrees with the store it finally talks to.
 */

function formatSize(sizeKb: number): string {
  return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${String(sizeKb)} KB`;
}

function buildColumns(
  access: PatientDocumentAccess | null,
): ReadonlyArray<DataTableColumn<PatientDocument>> {
  const columns: DataTableColumn<PatientDocument>[] = [
    {
      id: 'name',
      header: 'File name',
      cell: (document) => {
        const Icon = DOCUMENT_CATEGORY_META[document.category].icon;
        return (
          <span className="flex items-center gap-2">
            <Icon
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-text-tertiary"
              strokeWidth={1.75}
            />
            <span className="truncate font-medium">{document.name}</span>
          </span>
        );
      },
    },
    {
      id: 'category',
      header: 'Category',
      cell: (document) => (
        <Badge variant="neutral">{DOCUMENT_CATEGORY_META[document.category].label}</Badge>
      ),
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      cell: (document) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap text-body-sm tabular-nums">
            {formatDate(document.uploadedAt)}
          </p>
          <p className="text-caption text-text-tertiary">by {document.uploadedBy}</p>
        </div>
      ),
    },
    {
      id: 'size',
      header: 'Size',
      numeric: true,
      cell: (document) => <span dir="ltr">{formatSize(document.sizeKb)}</span>,
    },
  ];

  if (access === null) return columns;

  return [
    ...columns,
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      width: '140px',
      cell: (document) => (
        <span className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={Eye}
            loading={access.pendingId === document.id}
            onClick={() => {
              access.view(document);
            }}
          >
            View
          </Button>
          <Tooltip content="Download">
            <IconButton
              icon={Download}
              size="sm"
              aria-label={`Download ${document.name}`}
              onClick={() => {
                access.download(document);
              }}
            />
          </Tooltip>
        </span>
      ),
    },
  ];
}

export function DocumentsTab({
  documents,
  patientId,
  access,
}: {
  documents: readonly PatientDocument[];
  patientId: string;
  access: PatientDocumentAccess;
}) {
  const connected = access.storage === 'available';
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {/* Rendered only once the indicator has answered, so the notice does
          not flash on a build that does have storage. */}
      {access.storage === 'unconfigured' ? (
        <Alert variant="info" title="Stored files cannot be opened in this build">
          {DOCUMENT_STORAGE_UNAVAILABLE} The documents below are listed from the patient record;
          opening one needs the files service of API §17, which is not deployed here.
        </Alert>
      ) : null}

      {connected ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={Upload}
            loading={access.uploading}
            onClick={() => setUploadOpen(true)}
          >
            Upload document
          </Button>
          <UploadDocumentDialog
            open={uploadOpen}
            uploading={access.uploading}
            onClose={() => setUploadOpen(false)}
            onUpload={(file, category) => access.upload({ patientId, file, category })}
          />
        </div>
      ) : null}

      <DataTable
        caption="Uploaded documents with category, upload metadata, and size"
        columns={buildColumns(connected ? access : null)}
        rows={documents}
        getRowId={(document) => document.id}
        emptyState={
          <EmptyState
            title="No documents uploaded"
            description="Referrals, consents, and external records will appear here."
          />
        }
      />
    </div>
  );
}
