import { useRef, useState } from 'react';

import { FileCheck2, FileUp } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { StatusBadge, type StatusKind } from '@/components/patterns';
import { Button, Input, Select } from '@/components/ui';

import {
  useSubmitVerificationDocumentMutation,
  useVerificationDocumentsQuery,
} from '../api/useSettingsQueries';
import { SettingsCard } from '../components/SettingsCard';
import { formatDate } from '../model/selectors';
import { VerificationSubmitError } from '../model/settings-service';
import {
  REQUIRED_VERIFICATION_DOCUMENT_KINDS,
  VERIFICATION_DECISION_LABELS,
  VERIFICATION_DOCUMENT_KINDS,
  VERIFICATION_DOCUMENT_KIND_LABELS,
  type VerificationDecision,
  type VerificationDocument,
  type VerificationDocumentKind,
} from '../model/types';

/**
 * Verification section (NEW-46) — the doctor's half of credential review
 * (API §3.6a). The doctor files a medical licence, a degree certificate and
 * an identity document (anything else is optional supporting material); an
 * administrator decides on each in the admin Doctors area, and can complete
 * verification only once all three required ones are approved.
 *
 * Nothing here claims more than the server has said: a submission is
 * "submitted for review", each row shows the reviewer's decision in words,
 * and a rejected one carries the reviewer's reason. Submitting is two calls
 * (the bytes, then the filing) behind one button; the type and size rules
 * are the server's, so its refusal is shown in its own words.
 */

/*
 * `awaiting`, not `pending`, for a document under review: the doctor is
 * blocked on someone else. The admin side marks the same row `pending`
 * because there it is the reader who owes the action (`DOCUMENT_DECISION_KIND`).
 */
const DECISION_STATUS: Record<VerificationDecision, StatusKind> = {
  pending: 'awaiting',
  approved: 'confirmed',
  rejected: 'rejected',
};

/** What the file picker offers — the server's `verification_document` types. */
const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';

/**
 * The required kinds with nothing on file that could still be approved: none
 * filed, or only rejected ones.
 */
function missingRequiredKinds(
  documents: readonly VerificationDocument[],
): VerificationDocumentKind[] {
  return REQUIRED_VERIFICATION_DOCUMENT_KINDS.filter(
    (kind) =>
      !documents.some((document) => document.kind === kind && document.decision !== 'rejected'),
  );
}

/** Why a submission failed — the adapter's words where it gave some. */
function submitFailure(error: unknown): string {
  if (error instanceof VerificationSubmitError) return error.message;
  return 'Nothing was submitted. Please try again.';
}

/**
 * A document is valid through the whole of its expiry day, so it reads
 * "Expired" only from the next midnight. `expiresOn` is that day's local
 * midnight.
 */
function isExpired(expiresOn: string, now = new Date()): boolean {
  const dayAfter = new Date(expiresOn);
  dayAfter.setDate(dayAfter.getDate() + 1);
  return now.getTime() >= dayAfter.getTime();
}

export function VerificationSection() {
  const query = useVerificationDocumentsQuery();

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="Submitted documents"
        description="An administrator reviews each one, and can complete your verification once the medical licence, degree certificate and identity document are all approved."
        icon={FileCheck2}
        flush
      >
        {query.isPending ? (
          <div className="flex flex-col gap-3 px-5 py-4" aria-busy="true">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState
            title="Couldn't load your verification documents"
            description="Something went wrong. Please try again."
            onRetry={() => void query.refetch()}
            className="rounded-none border-0"
          />
        ) : (
          <DocumentList documents={query.data} />
        )}
      </SettingsCard>

      <SubmitDocumentCard />
    </div>
  );
}

function DocumentList({ documents }: { documents: readonly VerificationDocument[] }) {
  const missing = missingRequiredKinds(documents);

  return (
    <div>
      <p className="border-b border-border px-5 py-3 text-body-sm text-text-secondary">
        {missing.length === 0
          ? 'All three required documents have been submitted.'
          : `Still needed: ${missing.map((kind) => VERIFICATION_DOCUMENT_KIND_LABELS[kind]).join(', ')}.`}
      </p>
      {documents.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="No documents submitted yet"
          description="Submit your documents below for an administrator to review."
          headingLevel="h3"
        />
      ) : (
        <ul className="divide-y divide-border px-5" aria-label="Submitted documents">
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentRow({ document }: { document: VerificationDocument }) {
  const label = VERIFICATION_DOCUMENT_KIND_LABELS[document.kind];
  const expiry =
    document.expiresOn === null
      ? null
      : `${isExpired(document.expiresOn) ? 'Expired' : 'Expires'} ${formatDate(document.expiresOn)}`;

  return (
    <li className="flex items-start gap-3 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-text-primary">{label}</p>
        <p className="text-caption text-text-secondary">
          Uploaded {formatDate(document.uploadedAt)}
          {expiry === null ? null : ` · ${expiry}`}
        </p>
        {document.decision === 'rejected' && document.rejectReason !== null ? (
          <p className="mt-1 text-caption text-text-secondary">
            Reviewer’s reason: {document.rejectReason}
          </p>
        ) : null}
      </div>
      <StatusBadge
        status={DECISION_STATUS[document.decision]}
        label={VERIFICATION_DECISION_LABELS[document.decision]}
        className="shrink-0"
      />
    </li>
  );
}

function SubmitDocumentCard() {
  const { toast } = useToast();
  const submit = useSubmitVerificationDocumentMutation();
  const [kind, setKind] = useState<VerificationDocumentKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submitting = submit.isPending;
  const ready = kind !== null && file !== null;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (kind === null || file === null || submitting) return;
    setFailure(null);
    submit.mutate(
      { file, kind, expiresOn: expiresOn === '' ? null : expiresOn },
      {
        onSuccess: () => {
          setKind(null);
          setFile(null);
          setExpiresOn('');
          // A file input is cleared only through its DOM value.
          if (fileRef.current !== null) fileRef.current.value = '';
          toast({
            variant: 'success',
            title: 'Document submitted',
            description: 'Submitted for review. It stays pending until an administrator decides.',
          });
        },
        onError: (error) => setFailure(submitFailure(error)),
      },
    );
  };

  return (
    <SettingsCard
      title="Submit a document"
      description="Upload a scan or photo of the document. A new submission never replaces one already on file."
      icon={FileUp}
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Select
            label="Document type"
            required
            value={kind}
            placeholder="Choose…"
            disabled={submitting}
            onChange={(value) => setKind(value as VerificationDocumentKind)}
            options={VERIFICATION_DOCUMENT_KINDS.map((value) => ({
              value,
              label: VERIFICATION_DOCUMENT_KIND_LABELS[value],
            }))}
          />
          <Input
            label="Expiry date"
            type="date"
            value={expiresOn}
            disabled={submitting}
            helperText="Optional — if the document states one."
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </div>
        <Input
          ref={fileRef}
          label="File"
          type="file"
          accept={ACCEPTED_TYPES}
          required
          disabled={submitting}
          helperText="PDF or image (JPEG, PNG, WebP), up to 10 MB."
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {failure !== null ? (
          <Alert variant="error" title="Document not submitted">
            {failure}
          </Alert>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={!ready || submitting} loading={submitting}>
            Submit for review
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
