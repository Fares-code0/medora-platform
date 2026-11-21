import { useRef, useState } from 'react';

import { Upload } from 'lucide-react';

import { Stack } from '@/components/layout';
import { Button, Modal, Select } from '@/components/ui';

import {
  DOCUMENT_CATEGORY_META,
  type DocumentCategory,
  type PatientDocument,
} from '../../model/profile-types';

/**
 * File one document under a patient's chart (D-04b, API §4.7).
 *
 * The category has no default. The server requires one of five
 * (`linkDocumentSchema`), and a pre-selected "Referral" would file every
 * consent form and insurance card as a referral whenever nobody changed it —
 * the reason `AddHistoryEventDialog` leaves its kind empty too.
 *
 * Accepted types and the size limit are not pre-checked: they are the
 * server's (`file-policy.ts`), and its refusal is shown in its own words by
 * the access hook. The dialog stays open on a refusal so the doctor can pick
 * another file without choosing the category again.
 */
export interface UploadDocumentDialogProps {
  readonly open: boolean;
  readonly uploading: boolean;
  readonly onClose: () => void;
  /** Resolves to the filed row, or `null` when the server refused. */
  readonly onUpload: (file: File, category: DocumentCategory) => Promise<PatientDocument | null>;
}

const CATEGORIES = Object.keys(DOCUMENT_CATEGORY_META) as DocumentCategory[];

export function UploadDocumentDialog({
  open,
  uploading,
  onClose,
  onUpload,
}: UploadDocumentDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DocumentCategory | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [showIssues, setShowIssues] = useState(false);

  const issues = {
    category: category === null ? 'Choose what kind of document this is' : undefined,
    file: file === null ? 'Choose a file to upload' : undefined,
  };

  const close = () => {
    setCategory(null);
    setFile(null);
    setShowIssues(false);
    onClose();
  };

  const submit = async () => {
    setShowIssues(true);
    if (category === null || file === null) return;
    const filed = await onUpload(file, category);
    if (filed !== null) close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Upload document"
      description="The file is filed on this patient’s record."
      dismissible={!uploading}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={uploading}>
            Upload
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Stack gap={4}>
          <Select
            label="Category"
            required
            value={category}
            placeholder="Choose…"
            onChange={(value) => setCategory(value as DocumentCategory)}
            options={CATEGORIES.map((value) => ({
              value,
              label: DOCUMENT_CATEGORY_META[value].label,
            }))}
            error={showIssues ? issues.category : undefined}
          />
          <div className="flex flex-col gap-1.5">
            {/*
              The input is the control; the button is its label. Kept out of
              the accessibility tree in favour of the button, so a screen
              reader is offered one affordance, not two for the same act.
            */}
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                // Reset first: picking the same file twice must fire again.
                event.target.value = '';
                if (picked !== undefined) setFile(picked);
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={Upload}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {file === null ? 'Choose file' : 'Choose another file'}
              </Button>
              <span className="min-w-0 truncate text-body-sm text-text-secondary">
                {file === null ? 'No file chosen' : file.name}
              </span>
            </div>
            {showIssues && issues.file !== undefined ? (
              <p className="text-caption text-error" role="alert">
                {issues.file}
              </p>
            ) : null}
          </div>
        </Stack>
      </form>
    </Modal>
  );
}
