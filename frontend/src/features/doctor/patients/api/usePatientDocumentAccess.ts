import { useCallback, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { useToast } from '@/app/providers';

import {
  DOCUMENT_SCAN_MESSAGE,
  type DocumentStorageState,
  type ResolvedDocument,
  type UploadDocumentInput,
} from '../model/patient-documents-service';
import type { PatientDocument } from '../model/profile-types';
import { patientDocumentsService } from '../service';

import { patientKeys } from './usePatientsQuery';

/**
 * Reading a stored patient document (D-04).
 *
 * Two questions, deliberately separate. **Is there a document service at
 * all** is asked once and drives whether the tab offers actions; **give me
 * this file** is asked per click and drives what happens. Collapsing them
 * into one per-click call would put the answer "there is no storage in this
 * build" behind a button press, which is the shape of failure D-16 was
 * filed for: a control that looks live and reports the truth only after you
 * have trusted it.
 */

export const patientDocumentKeys = createKeyFactory('patient-documents');

const STORAGE_KEY = [...patientDocumentKeys.all, 'storage'] as const;

export interface PatientDocumentAccess {
  /** `undefined` until the storage indicator has answered. */
  readonly storage: DocumentStorageState | undefined;
  /** The document currently being resolved, so one row can show progress. */
  readonly pendingId: string | null;
  readonly view: (document: PatientDocument) => void;
  readonly download: (document: PatientDocument) => void;
  /** True while an upload is in flight (D-04b). */
  readonly uploading: boolean;
  /**
   * Stores one file, reporting the outcome. Resolves to the stored row, or
   * `null` when the store refused — the refusal is surfaced by this hook, so
   * a caller only has to know whether it now has a document.
   */
  readonly upload: (input: UploadDocumentInput) => Promise<PatientDocument | null>;
}

/**
 * Hands the browser a signed URL. Cross-origin storage decides the
 * disposition, so `download` is a request rather than a guarantee — which
 * is correct: the file's own `Content-Disposition` is M25's to set, not
 * this component's to override.
 */
function followUrl(url: string, filename: string, download: boolean): void {
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener noreferrer';
  if (download) anchor.download = filename;
  else anchor.target = '_blank';
  anchor.click();
}

function refusal(resolved: Exclude<ResolvedDocument, { kind: 'ready' }>): string {
  return resolved.kind === 'unavailable' ? resolved.reason : DOCUMENT_SCAN_MESSAGE[resolved.kind];
}

/**
 * `patientId` is the chart the documents belong to: the server opens a
 * document through its chart (API §4.7), and a filed upload refreshes that
 * chart's Documents tab.
 */
export function usePatientDocumentAccess(patientId: string): PatientDocumentAccess {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Whether storage exists is a property of the deployment, not of the
  // patient — one query for the session, shared by every profile.
  const storage = useQuery({
    queryKey: STORAGE_KEY,
    queryFn: () => patientDocumentsService.storageState(),
    staleTime: Infinity,
  });

  const open = useCallback(
    (document: PatientDocument, asDownload: boolean) => {
      setPendingId(document.id);
      patientDocumentsService
        .resolve(patientId, document.id)
        .then((resolved) => {
          if (resolved.kind === 'ready') {
            followUrl(resolved.url, document.name, asDownload);
            return;
          }
          // Never a success toast, and never a fabricated file: the only
          // thing this branch produces is the service's own words.
          toast({
            variant: 'error',
            title: `${document.name} could not be opened`,
            description: refusal(resolved),
          });
        })
        .catch(() => {
          toast({
            variant: 'error',
            title: `${document.name} could not be opened`,
            description: 'The document service did not answer. Nothing was downloaded.',
          });
        })
        .finally(() => {
          setPendingId(null);
        });
    },
    [patientId, toast],
  );

  const view = useCallback(
    (document: PatientDocument) => {
      open(document, false);
    },
    [open],
  );

  const download = useCallback(
    (document: PatientDocument) => {
      open(document, true);
    },
    [open],
  );

  const upload = useCallback(
    async (input: UploadDocumentInput): Promise<PatientDocument | null> => {
      setUploading(true);
      try {
        const outcome = await patientDocumentsService.upload(input);
        if (outcome.kind === 'stored') {
          // Pessimistic: the tab is refetched from the server rather than
          // patched, so the row shown is the row the chart now holds.
          await queryClient.invalidateQueries({
            queryKey: [...patientKeys.detail(input.patientId), 'tab', 'documents'],
          });
          toast({
            variant: 'success',
            title: `${input.file.name} uploaded`,
            description:
              'The file is on the patient record. It can be opened once the malware scan has cleared it.',
          });
          return outcome.document;
        }
        // The only success toast in this hook is the one above, and it fires
        // only on a `stored` outcome carrying a real row. Everything else
        // says what happened and returns nothing.
        toast({
          variant: 'error',
          title: `${input.file.name} was not uploaded`,
          description: outcome.reason,
        });
        return null;
      } catch {
        toast({
          variant: 'error',
          title: `${input.file.name} was not uploaded`,
          description: 'The document service did not answer. Nothing was stored.',
        });
        return null;
      } finally {
        setUploading(false);
      }
    },
    [queryClient, toast],
  );

  return { storage: storage.data, pendingId, view, download, uploading, upload };
}
