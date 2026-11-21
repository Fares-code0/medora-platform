import {
  DOCUMENT_STORAGE_UNAVAILABLE,
  type DocumentStorageState,
  type PatientDocumentsService,
  type ResolvedDocument,
  type UploadOutcome,
} from '../model/patient-documents-service';

/**
 * The only adapter behind the documents port, and it is not a mock.
 *
 * It is the frontend half of `backend/src/shared/files/unconfigured-file-storage.ts`,
 * whose own comment sets the rule this file follows: "a `put()` that
 * resolves without writing anything would hand the caller a file id for
 * bytes that do not exist… Failing loudly at the point of the call is the
 * honest behaviour until M25 wires MinIO." The same applies in reverse on
 * this side — a `resolve()` that answered with *something* would be the
 * fabricated PDF again, under a better-organised roof.
 *
 * So there is no `mockDocumentsService`. Inventing bytes to stand in for a
 * scan of a patient's insurance card is not a mock, it is a forged clinical
 * document, and no seam flag should be able to turn it on. What the file
 * does provide is the shape of the answer, so the tab that reads it is
 * written once and does not change when M25 replaces this module.
 *
 * `upload` refuses for the same reason and one more (D-04b): a resolved
 * upload would put a row in the Documents tab for a file that reached no
 * store, so the next person to open it — or the next session, which keeps
 * nothing — finds a consent form that does not exist. The backend's own
 * comment makes the point: a `put()` that resolves without writing "would
 * hand the caller a file id for bytes that do not exist, and the failure
 * would surface later as a broken download rather than a failed upload."
 */

const STORAGE_UNCONFIGURED: DocumentStorageState = 'unconfigured';

export const unconfiguredDocumentsService: PatientDocumentsService = {
  storageState: (): Promise<DocumentStorageState> => Promise.resolve(STORAGE_UNCONFIGURED),

  resolve: (): Promise<ResolvedDocument> =>
    Promise.resolve({ kind: 'unavailable', reason: DOCUMENT_STORAGE_UNAVAILABLE }),

  upload: (): Promise<UploadOutcome> =>
    Promise.resolve({ kind: 'unavailable', reason: DOCUMENT_STORAGE_UNAVAILABLE }),
};
