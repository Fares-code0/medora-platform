import { apiClient } from '@/api/client';
import { asRecord, readData, readNumber, readString } from '@/api/http';
import { isApiError, type ApiError } from '@/types/api';

import {
  DOCUMENT_STORAGE_UNAVAILABLE,
  type DocumentStorageState,
  type PatientDocumentsService,
  type ResolvedDocument,
  type UploadOutcome,
} from '../model/patient-documents-service';

import { toDocument } from './http-profile-service';

/**
 * Patient documents over HTTP (D-04 / D-04b) — API §4.7 and §17.
 *
 * ## Storage state is the deployment's `/health`, not a guess
 *
 * The tab offers no action until it knows a store exists (the port's
 * `DocumentStorageState` explains why), and API §20.1 publishes exactly that
 * answer: `GET /health` → `services.storage`. Only `up` reads `available`.
 * `unconfigured` and `down` both mean no stored file can be opened, so both
 * read `unconfigured` and the tab says so once instead of per click.
 *
 * Recorded as DEC-018 (`frontend/FRONTEND_CHECKLIST.md` §14; still the
 * owner's to close). An API built from `main` registers no storage health
 * indicator, so `/health` reports `unconfigured` even when an object store is
 * configured, and the live tab keeps its actions hidden — the safe direction
 * to be wrong in. An API built from `backend` registers one since `94297dde`
 * (`StorageHealthIndicator`: S3 `HeadBucket`, cached 15 s, bounded at 3 s),
 * answering `up` / `down` / `unconfigured` under exactly this key, so there
 * the tab offers its actions once a store answers. No change here is needed
 * for that; it has not been run against a real store.
 *
 * ## Opening a document
 *
 * `GET /patients/{patientId}/documents/{documentId}/download` answers
 * `{ url, expiresInSeconds }`. Care scope and chart membership are checked
 * before the M25.3 scan gate, so the refusals are, in order: 404 (not this
 * chart, or not in scope), 403 `scan_pending` (not cleared), 503 (no store).
 *
 * The scan gate answers `scan_pending` for an **infected** file too, with a
 * different message and the same code (`backend/src/shared/files/scan-gate.ts`).
 * The normalized error keeps the code and not the message, so both read as
 * `scan-pending` here: "has not cleared the malware scan" is true of both.
 * The port's `infected` branch stays for the day the server gives it a code.
 *
 * ## Uploading a document
 *
 * Two calls, because the server keeps the bytes and the chart apart:
 * `POST /files` (multipart, `kind=patient_document`, the part `file`), then
 * `POST /patients/{patientId}/documents` `{ fileId, category }`. The type and
 * size rules are the server's (`file-policy.ts`), so its 422 words are shown
 * and nothing is pre-checked here. A file stored but not filed is not shown
 * as filed: the link's refusal is reported, and the unlinked upload is left
 * for the server's orphan sweep (M25.5).
 */

function path(...segments: readonly string[]): string {
  return `/${segments.map(encodeURIComponent).join('/')}`;
}

function isStorageUnavailable(error: ApiError): boolean {
  return (
    error.code === 'service_unavailable' || (error.kind === 'server' && error.ref === 'HTTP-503')
  );
}

/** The server's first field message, the words a 422 carries. */
function firstFieldError(error: ApiError, field: string): string | undefined {
  if (error.kind !== 'validation') return undefined;
  return error.fieldErrors[field]?.[0] ?? Object.values(error.fieldErrors)[0]?.[0];
}

async function storageState(): Promise<DocumentStorageState> {
  const health = asRecord(readData(await apiClient.get('/health'), 'health'), 'health');
  const services = asRecord(health.services, 'health services');
  return services.storage === 'up' ? 'available' : 'unconfigured';
}

/**
 * The signed URL is followed by an anchor click in this origin
 * (`usePatientDocumentAccess`), so its scheme decides what that click does.
 * A `javascript:` URL runs script here, and a `data:` or `blob:` one renders
 * content the server never stored — a compromised or misconfigured API must
 * not be able to turn "Open" into either. An object store signs `https:`
 * links; plain `http:` is accepted only in a development build, for the
 * compose stack's MinIO on `localhost`.
 */
function isFollowableUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || (import.meta.env.DEV && url.protocol === 'http:');
}

export const DOCUMENT_LINK_REFUSED =
  'The document service answered with a link this app will not open.';

async function resolve(patientId: string, documentId: string): Promise<ResolvedDocument> {
  try {
    const body = await apiClient.get(
      path('patients', patientId, 'documents', documentId, 'download'),
    );
    const what = 'document download';
    const dto = asRecord(readData(body, what), what);
    const url = readString(dto, 'url', what);
    if (!isFollowableUrl(url)) return { kind: 'unavailable', reason: DOCUMENT_LINK_REFUSED };
    return {
      kind: 'ready',
      url,
      expiresInSeconds: readNumber(dto, 'expiresInSeconds', what),
    };
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (error.kind === 'forbidden' && error.code === 'scan_pending')
      return { kind: 'scan-pending' };
    if (isStorageUnavailable(error)) {
      return { kind: 'unavailable', reason: DOCUMENT_STORAGE_UNAVAILABLE };
    }
    if (error.kind === 'not_found') {
      return { kind: 'unavailable', reason: 'This document is no longer on the patient record.' };
    }
    if (error.kind === 'forbidden') {
      return { kind: 'unavailable', reason: 'You do not have access to this patient’s documents.' };
    }
    throw error;
  }
}

async function storeFile(file: File): Promise<string | UploadOutcome> {
  const form = new FormData();
  // The kind first: the server reads text parts that precede the file.
  form.append('kind', 'patient_document');
  form.append('file', file, file.name);
  try {
    const what = 'uploaded file';
    return readString(
      asRecord(readData(await apiClient.post('/files', form), what), what),
      'id',
      what,
    );
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (isStorageUnavailable(error)) {
      return { kind: 'unavailable', reason: DOCUMENT_STORAGE_UNAVAILABLE };
    }
    if (error.kind === 'validation') {
      return {
        kind: 'rejected',
        reason: firstFieldError(error, 'file') ?? 'The server did not accept this file.',
      };
    }
    if (error.kind === 'server' && error.ref === 'HTTP-413') {
      return { kind: 'rejected', reason: 'The file is larger than the server accepts.' };
    }
    throw error;
  }
}

const NOT_FILED = 'The file was uploaded but could not be filed on this patient’s record.';

export const httpDocumentsService: PatientDocumentsService = {
  storageState,

  resolve,

  async upload({ patientId, file, category }): Promise<UploadOutcome> {
    const stored = await storeFile(file);
    if (typeof stored !== 'string') return stored;

    try {
      const body = await apiClient.post(path('patients', patientId, 'documents'), {
        fileId: stored,
        category,
      });
      return { kind: 'stored', document: toDocument(readData(body, 'document')) };
    } catch (error) {
      if (!isApiError(error)) throw error;
      if (error.kind === 'validation') {
        const words = firstFieldError(error, 'fileId');
        return {
          kind: 'rejected',
          reason: words === undefined ? NOT_FILED : `${NOT_FILED} ${words}`,
        };
      }
      if (error.kind === 'conflict') {
        return { kind: 'rejected', reason: 'This upload is already filed on a record.' };
      }
      if (error.kind === 'not_found' || error.kind === 'forbidden') {
        return { kind: 'rejected', reason: `${NOT_FILED} The chart is not in your care scope.` };
      }
      throw error;
    }
  },
};
