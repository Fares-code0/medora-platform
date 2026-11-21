import { useState } from 'react';

import { AlertTriangle, BadgeCheck, Check, Eye, FileText, X } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { StatusBadge } from '@/components/patterns';
import { Button, Checkbox, Drawer } from '@/components/ui';
import { cn } from '@/utils/cn';

import { GridEmpty, Overline, Panel } from '../components/primitives';

import {
  canApproveDocument,
  DOCUMENT_DECISION_LABEL,
  DOCUMENT_DECISION_KIND,
  DOCUMENT_LABEL,
  formatDate,
  formatDateTime,
  isExpired,
  isExpiringSoon,
  REQUIRED_DOCUMENTS,
  verificationBlockers,
} from './doctors';
import type { CredentialDocument, DoctorRecord, DocumentChecklist } from './doctors.types';

/**
 * The credential file (ADM-03 · UX §3.3, Documents tab).
 *
 * The three-check list is the point of this tab. An administrator approving
 * a medical licence is asserting three separate things — that it is
 * authentic, that it is current, and that it belongs to this person — and
 * the approve button stays inert until all three are ticked. That is
 * enforced again in the service, so the checklist is evidence rather than
 * decoration.
 *
 * "Complete verification" sits at the bottom and states what is blocking it
 * rather than simply being grey.
 */
export function DoctorDocumentsTab({
  doctor,
  busy,
  onCheck,
  onApprove,
  onReject,
  onComplete,
}: {
  doctor: DoctorRecord;
  busy: boolean;
  onCheck: (documentId: string, field: keyof DocumentChecklist, value: boolean) => void;
  onApprove: (documentId: string) => void;
  onReject: (document: CredentialDocument) => void;
  onComplete: () => void;
}) {
  const [preview, setPreview] = useState<CredentialDocument | null>(null);
  const now = Date.now();
  const blockers = verificationBlockers(doctor, now);
  const verified = doctor.verification === 'verified';

  return (
    <div className="flex flex-col gap-4">
      {doctor.verificationNote !== null ? (
        <Alert
          variant={doctor.verification === 'rejected' ? 'error' : 'info'}
          title={
            doctor.verification === 'rejected'
              ? 'This application was rejected'
              : 'Documents requested from the doctor'
          }
        >
          {doctor.verificationNote}
        </Alert>
      ) : null}

      {doctor.documents.length === 0 ? (
        <GridEmpty>{doctor.name} has not uploaded any credential documents yet.</GridEmpty>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {doctor.documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            now={now}
            locked={verified}
            onCheck={(field, value) => onCheck(document.id, field, value)}
            onApprove={() => onApprove(document.id)}
            onReject={() => onReject(document)}
            onPreview={() => setPreview(document)}
          />
        ))}
      </div>

      <Panel title="Verification" icon={BadgeCheck} tone={verified ? 'success' : 'warning'}>
        {verified ? (
          <p className="text-body-sm text-text-secondary">
            {doctor.name} is verified. Re-opening the decision means rejecting the application,
            which suspends the account.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {blockers.length === 0 ? (
              <p className="text-body-sm text-text-secondary">
                Every required document is approved and in date. Completing verification lets{' '}
                {doctor.name} see patients on the platform.
              </p>
            ) : (
              <div>
                <Overline>Still outstanding</Overline>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 ps-5">
                  {blockers.map((blocker) => (
                    <li key={blocker} className="text-body-sm text-text-secondary">
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Button
                leadingIcon={BadgeCheck}
                disabled={blockers.length > 0}
                loading={busy}
                onClick={onComplete}
              >
                Complete verification
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <DocumentPreviewDrawer document={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function DocumentCard({
  document,
  now,
  locked,
  onCheck,
  onApprove,
  onReject,
  onPreview,
}: {
  document: CredentialDocument;
  now: number;
  locked: boolean;
  onCheck: (field: keyof DocumentChecklist, value: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  onPreview: () => void;
}) {
  const expired = isExpired(document, now);
  const expiring = isExpiringSoon(document, now);
  const required = REQUIRED_DOCUMENTS.includes(document.kind);
  const approvable = canApproveDocument(document) && !expired;

  // One field per write, so ticking three boxes quickly cannot lose one.
  const toggle = (key: keyof DocumentChecklist) => {
    onCheck(key, !document.checklist[key]);
  };

  return (
    <section className="flex flex-col gap-3 rounded-surface border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-surface bg-surface-sunken">
            <FileText
              aria-hidden="true"
              className="h-5 w-5 text-text-tertiary"
              strokeWidth={1.75}
            />
          </span>
          <div className="min-w-0">
            {/*
             * `h2`, not `h3`. These four cards and the Verification panel
             * below are peers under the page's h1 — the tab strip between
             * them is a set of buttons, not a heading — so an h3 here opened
             * the tab on a skipped level, and put three of them ahead of the
             * h2 they appeared to belong to.
             */}
            <h2 className="truncate text-body font-semibold text-text-primary">
              {DOCUMENT_LABEL[document.kind]}
              {required ? null : (
                <span className="ms-1.5 text-caption font-normal text-text-tertiary">optional</span>
              )}
            </h2>
            <p className="truncate text-caption text-text-tertiary">{uploadLine(document)}</p>
          </div>
        </div>
        <StatusBadge
          status={DOCUMENT_DECISION_KIND[document.decision] ?? 'info'}
          label={DOCUMENT_DECISION_LABEL[document.decision] ?? document.decision}
        />
      </div>

      {document.expiresAt !== null ? (
        <p
          className={cn(
            'flex items-center gap-1.5 text-caption',
            expired ? 'text-error' : expiring ? 'text-warning' : 'text-text-tertiary',
          )}
        >
          {expired || expiring ? (
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          ) : null}
          {expired ? 'Expired' : 'Expires'} {formatDate(document.expiresAt)}
        </p>
      ) : null}

      {document.decision === 'rejected' && document.rejectionReason !== null ? (
        <p className="rounded-surface bg-error-subtle px-3 py-2 text-caption text-error">
          {document.rejectionReason}
        </p>
      ) : null}

      {/* Not disabled while a check is in flight: each field is written
          independently, and blocking the boxes for a round trip each would
          make ticking three of them feel broken. */}
      <fieldset className="flex flex-col gap-1.5" disabled={locked}>
        <legend className="sr-only">
          Verification checklist for {DOCUMENT_LABEL[document.kind]}
        </legend>
        <Checkbox
          label="Authentic"
          checked={document.checklist.authentic}
          onChange={() => toggle('authentic')}
          aria-label={`Authentic — ${DOCUMENT_LABEL[document.kind]}`}
        />
        <Checkbox
          label="Current"
          checked={document.checklist.current}
          onChange={() => toggle('current')}
          aria-label={`Current — ${DOCUMENT_LABEL[document.kind]}`}
        />
        <Checkbox
          label="Matches identity"
          checked={document.checklist.matchesIdentity}
          onChange={() => toggle('matchesIdentity')}
          aria-label={`Matches identity — ${DOCUMENT_LABEL[document.kind]}`}
        />
      </fieldset>

      {document.reviewedBy !== null && document.reviewedAt !== null ? (
        <p className="text-caption text-text-tertiary">
          Reviewed by {document.reviewedBy} · {formatDateTime(document.reviewedAt)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* No stand-in to render where the platform serves no file preview
            (the live API stores the scan; FE-10.10). */}
        {document.previewLines.length > 0 ? (
          <Button variant="secondary" size="sm" leadingIcon={Eye} onClick={onPreview}>
            Preview
          </Button>
        ) : null}
        {locked ? null : (
          <>
            <Button
              size="sm"
              leadingIcon={Check}
              disabled={!approvable}
              onClick={onApprove}
              title={
                expired
                  ? 'An expired document cannot be approved.'
                  : approvable
                    ? undefined
                    : 'Tick all three checks first.'
              }
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={X}
              disabled={document.decision === 'rejected'}
              onClick={onReject}
            >
              Reject
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The preview drawer. The stored file is mocked, so this renders the
 * document's text stand-in — enough to exercise the surface an
 * administrator reviews from without pretending to be a PDF viewer.
 */
function DocumentPreviewDrawer({
  document,
  onClose,
}: {
  document: CredentialDocument | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={document !== null}
      onClose={onClose}
      title={document === null ? 'Document' : DOCUMENT_LABEL[document.kind]}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {document === null ? null : (
        <div className="flex flex-col gap-4">
          <p className="text-caption text-text-tertiary">{uploadLine(document)}</p>
          <div className="flex flex-col gap-2 rounded-surface border border-border bg-surface-sunken p-6 text-center">
            {document.previewLines.map((line, index) => (
              <p
                key={line}
                className={cn(
                  index === 0
                    ? 'text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary'
                    : index === 1
                      ? 'text-h5 font-semibold text-text-primary'
                      : 'text-body-sm text-text-secondary',
                )}
              >
                {line}
              </p>
            ))}
          </div>
          <p className="text-caption text-text-secondary">
            The stored scan is not available in this environment. Verification decisions are made
            against the document itself in production.
          </p>
        </div>
      )}
    </Drawer>
  );
}

/** "degree-certificate.pdf · uploaded 3 Oct 2026", or the date alone. */
function uploadLine(document: CredentialDocument): string {
  const uploaded = `uploaded ${formatDate(document.uploadedAt)}`;
  return document.filename === null
    ? `Uploaded ${formatDate(document.uploadedAt)}`
    : `${document.filename} · ${uploaded}`;
}
