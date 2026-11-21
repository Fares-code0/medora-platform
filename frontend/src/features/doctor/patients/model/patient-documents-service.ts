import type { DocumentCategory, PatientDocument } from './profile-types';

/**
 * The patient-documents port — D-04 (FRONTEND_CHECKLIST §3.3, §9 row 3).
 *
 * A row in the Documents tab names a file that lives in object storage.
 * Opening it therefore has to ask something for that file, and until this
 * port existed the tab asked nothing: `onView` and `onDownload` ran the
 * patient's name and assigned doctor through the export engine and handed
 * back a three-line PDF named after the document. That is the defect D-05
 * removed from the Imaging tab — "a document that looks like a radiology
 * report and contains none of one" — with the aggravation that here the
 * real file exists and the doctor has no way to tell they did not get it.
 *
 * **Typed from the backend, not from the mock** (`docs/handoff/auth-seam.md`
 * §1, rule 2). Every shape below is transcribed from
 * `backend/src/shared/files/file-storage.types.ts` and the stub in front of
 * it:
 *
 *  · `signedDownloadUrl(key, ttl)` returns *a short-TTL URL, not the bytes*
 *    — "streaming every attachment through the API turns the app into a
 *    file server". So `resolve` answers a URL, and the browser fetches the
 *    file from storage directly.
 *  · `FileScanStatus` gates download: API §17.2 answers **403
 *    `scan_pending`** until a file is `clean`. `scan-pending` and
 *    `infected` are therefore normal answers, not errors.
 *  · `UnconfiguredFileStorage` answers **503 `service_unavailable`** for
 *    every operation until M25 wires MinIO. `unavailable` is that answer.
 *  · `put()` takes a `kind` from a fixed union, and `'patient_document'` is
 *    one of the seven (API §17.1). The per-kind size and MIME rules are
 *    M25's, so `upload` does not invent any — the frontend does not get to
 *    decide what the store will accept.
 *
 * **Where this file lives, and why it is not in `src/types/`.** The same
 * reasoning the laboratory port records (`labs/model/lab-service.ts`):
 * `import/no-restricted-paths` forbids `src/api` from importing a feature,
 * so a port under `features/` cannot have an HTTP adapter in
 * `src/api/endpoints/` — and this one cannot have an adapter at all yet.
 * The HTTP adapter therefore lives beside it, in
 * `http/http-documents-service.ts`, as the laboratory port's does.
 *
 * **The routes (API §4.7, on this branch since the 2026-10-31 integration).**
 * A document is opened through its chart —
 * `GET /patients/{patientId}/documents/{documentId}/download` answers
 * `{ url, expiresInSeconds }` — because the documents read serves no
 * `fileId`. So `resolve` takes the patient as well as the document: the
 * server checks care scope and the document's membership of that chart
 * before the scan gate. An upload is two calls: `POST /files` (kind
 * `patient_document`), then `POST /patients/{patientId}/documents`
 * `{ fileId, category }` to file it under the chart.
 */


/**
 * Whether a document service is connected at all.
 *
 * This is not a concession to the mock. `/health` already reports a storage
 * indicator with exactly this meaning (API §20.1 — `unconfigured` today),
 * and the tab needs the answer *before* it decides whether to offer a
 * button, not after the doctor has pressed one. Asking per click would put
 * the discovery in a toast, which is where D-16's fake success lived.
 */
export type DocumentStorageState = 'available' | 'unconfigured';

/** What came back when a document was asked for. */
export type ResolvedDocument =
  | {
      readonly kind: 'ready';
      /** Short-TTL signed URL. Opaque — never built by the caller. */
      readonly url: string;
      /** How long the URL stays valid — it is followed at once, never kept. */
      readonly expiresInSeconds: number;
    }
  /** 403 `scan_pending` — the malware scan has not cleared the file yet. */
  | { readonly kind: 'scan-pending' }
  /** The scan found something. The file exists and will not be served. */
  | { readonly kind: 'infected' }
  /** 503 `service_unavailable`, or any other refusal, in words. */
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The wording for the two scan outcomes, as data rather than as JSX, so the
 * tab cannot render a claim the service did not make — the rule
 * `record-attachments/store.ts` follows for its own note.
 */
export const DOCUMENT_SCAN_MESSAGE: Record<'scan-pending' | 'infected', string> = {
  // Not "try again in a moment": with no scanner bound the file stays
  // pending indefinitely (backend `UnconfiguredMalwareScanner`), so the only
  // honest promise is the server's own — it opens once the scan completes.
  'scan-pending':
    'This file has not cleared the malware scan yet, so it cannot be opened. It opens once the scan completes.',
  infected: 'This file did not pass the malware scan, so it will not be opened.',
};

/**
 * What `unconfigured` means, in words, for the tab to render verbatim.
 *
 * It belongs to the port and not to the adapter that returns it, because
 * seam rule 3 forbids anything downstream from importing an adapter — and
 * a component reaching into `mock/` for its own notice text is exactly the
 * import the rule exists to stop. It names the missing service rather than
 * the symptom, so it reads as a deployment fact and not as an error the
 * doctor could have caused.
 */
export const DOCUMENT_STORAGE_UNAVAILABLE =
  'No document service is connected in this build, so the stored file cannot be opened or downloaded.';

/** What came back from an attempt to store a file (D-04b). */
export type UploadOutcome =
  | { readonly kind: 'stored'; readonly document: PatientDocument }
  /**
   * The store refused the file itself — too large, wrong type. Carries the
   * store's words, because the limits are M25's and the frontend must not
   * pre-empt them with a guess that later disagrees.
   */
  | { readonly kind: 'rejected'; readonly reason: string }
  /** 503 `service_unavailable`, as `resolve` returns it. */
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface UploadDocumentInput {
  readonly patientId: string;
  readonly file: File;
  readonly category: DocumentCategory;
}

export interface PatientDocumentsService {
  /** The storage indicator, read once per session (API §20.1). */
  storageState(): Promise<DocumentStorageState>;
  /**
   * Asks for one stored document of one patient's chart. Never throws for a
   * refusal the caller is expected to show a human — those are
   * `ResolvedDocument` branches. A rejection means the request itself failed.
   */
  resolve(patientId: string, documentId: string): Promise<ResolvedDocument>;
  /**
   * Stores one file against a patient (D-04b), the read path's mirror:
   * `put()` on the backend port, `kind: 'patient_document'`.
   *
   * Returns the stored row rather than void, because the tab has to show
   * the new document without refetching a list the service may not yet
   * have — and because a `void` upload cannot tell the caller what id the
   * scan gate will later be asked about.
   */
  upload(input: UploadDocumentInput): Promise<UploadOutcome>;
}
