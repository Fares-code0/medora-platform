import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import { DOCUMENT_STORAGE_UNAVAILABLE } from '../model/patient-documents-service';

import { DOCUMENT_LINK_REFUSED, httpDocumentsService } from './http-documents-service';

/**
 * Patient documents over HTTP (D-04 / D-04b, API §4.7 and §17).
 *
 * Bodies and refusals are transcribed from the backend on this branch:
 * `patient-tabs.controller.ts` (`addDocument`, `downloadDocument`),
 * `files.controller.ts` / `files.service.ts` (`POST /files`, `toView`),
 * `scan-gate.ts` (403 `scan_pending`) and the health contract
 * (`health.types.ts`). Not run against a live API (G-1).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATIENT = 'b7f0c1d2-0000-4000-8000-000000000001';
const DOCUMENT_ID = 'd1e2f3a4-0000-4000-8000-000000000002';
const FILE_ID = 'f9a8b7c6-0000-4000-8000-000000000003';

const DOCUMENT_VIEW = {
  id: DOCUMENT_ID,
  name: 'consent.pdf',
  category: 'consent',
  sizeKb: 1,
  uploadedAt: '2026-11-01T09:00:00.000Z',
  uploadedBy: 'Dr. Amelia Chen',
};

const FILE_VIEW = {
  id: FILE_ID,
  name: 'consent.pdf',
  sizeKb: 1,
  mimeType: 'application/pdf',
  kind: 'patient_document',
  checksumSha256: 'ab',
  scanStatus: 'pending',
  uploadedAt: '2026-11-01T09:00:00.000Z',
};

function health(storage: string) {
  return envelope({
    status: 'ok',
    services: { db: 'up', redis: 'unconfigured', storage, mail: 'unconfigured', ai: 'up' },
  });
}

const DOWNLOAD = `GET /patients/${PATIENT}/documents/${DOCUMENT_ID}/download`;
const LINK = `POST /patients/${PATIENT}/documents`;

function pdf(): File {
  return new File(['%PDF-1.7'], 'consent.pdf', { type: 'application/pdf' });
}

describe('storage state', () => {
  it('reads available only when /health reports storage up', async () => {
    stubApi({ 'GET /health': () => health('up') });
    await expect(httpDocumentsService.storageState()).resolves.toBe('available');
  });

  it.each(['unconfigured', 'down'])('reads unconfigured when storage is %s', async (storage) => {
    stubApi({ 'GET /health': () => health(storage) });
    await expect(httpDocumentsService.storageState()).resolves.toBe('unconfigured');
  });

  it('fails on a health body without services rather than guessing', async () => {
    stubApi({ 'GET /health': () => envelope({ status: 'ok' }) });
    await expect(httpDocumentsService.storageState()).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });
});

describe('opening a document', () => {
  it('asks the chart’s download route and answers the signed URL', async () => {
    const { requests } = stubApi({
      [DOWNLOAD]: () =>
        envelope({ url: 'https://store.example/signed?x=1', expiresInSeconds: 300 }),
    });

    await expect(httpDocumentsService.resolve(PATIENT, DOCUMENT_ID)).resolves.toEqual({
      kind: 'ready',
      url: 'https://store.example/signed?x=1',
      expiresInSeconds: 300,
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'blob:https://medora.example/0b1c',
    'file:///etc/passwd',
    'not a url',
  ])('refuses to follow a link that is not https (%s)', async (url) => {
    stubApi({ [DOWNLOAD]: () => envelope({ url, expiresInSeconds: 300 }) });

    await expect(httpDocumentsService.resolve(PATIENT, DOCUMENT_ID)).resolves.toEqual({
      kind: 'unavailable',
      reason: DOCUMENT_LINK_REFUSED,
    });
  });

  it('accepts a plain http link only in a development build', async () => {
    stubApi({
      [DOWNLOAD]: () =>
        envelope({ url: 'http://localhost:9000/medora/doc?sig=1', expiresInSeconds: 300 }),
    });
    await expect(httpDocumentsService.resolve(PATIENT, DOCUMENT_ID)).resolves.toMatchObject({
      kind: 'ready',
    });

    vi.stubEnv('DEV', false);
    try {
      await expect(httpDocumentsService.resolve(PATIENT, DOCUMENT_ID)).resolves.toEqual({
        kind: 'unavailable',
        reason: DOCUMENT_LINK_REFUSED,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reads 403 scan_pending as the scan gate, not as a permission failure', async () => {
    stubApi({
      [DOWNLOAD]: () =>
        json(
          {
            message:
              'This file is still being scanned. Download will activate once the scan completes.',
            code: 'scan_pending',
          },
          403,
        ),
    });

    await expect(httpDocumentsService.resolve(PATIENT, DOCUMENT_ID)).resolves.toEqual({
      kind: 'scan-pending',
    });
  });

  it('reads 503 as no document service', async () => {
    stubApi({
      [DOWNLOAD]: () =>
        json({ message: 'File storage is not configured', code: 'service_unavailable' }, 503),
    });

    await expect(httpDocumentsService.resolve(PATIENT, DOCUMENT_ID)).resolves.toEqual({
      kind: 'unavailable',
      reason: DOCUMENT_STORAGE_UNAVAILABLE,
    });
  });

  it('reads 404 as a document no longer on this record', async () => {
    stubApi({ [DOWNLOAD]: () => json({ message: 'Not found', code: 'not_found' }, 404) });

    const resolved = await httpDocumentsService.resolve(PATIENT, DOCUMENT_ID);
    expect(resolved.kind).toBe('unavailable');
    expect(resolved.kind === 'unavailable' ? resolved.reason : '').toMatch(/no longer on the/i);
  });

  it('rejects when the request itself fails, so the caller can say so', async () => {
    stubApi({ [DOWNLOAD]: () => json({ message: 'boom', ref: 'ERR-1' }, 500) });
    await expect(httpDocumentsService.resolve(PATIENT, DOCUMENT_ID)).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('uploading a document', () => {
  it('stores the bytes as a patient_document, then files them under the chart', async () => {
    const { requests } = stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      [LINK]: () => json(envelope(DOCUMENT_VIEW), 201),
    });

    const outcome = await httpDocumentsService.upload({
      patientId: PATIENT,
      file: pdf(),
      category: 'consent',
    });

    expect(outcome).toEqual({
      kind: 'stored',
      document: {
        id: DOCUMENT_ID,
        name: 'consent.pdf',
        category: 'consent',
        sizeKb: 1,
        uploadedAt: '2026-11-01T09:00:00.000Z',
        uploadedBy: 'Dr. Amelia Chen',
      },
    });

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /files',
      LINK,
    ]);
    const form = requests[0]?.body as FormData;
    expect(form.get('kind')).toBe('patient_document');
    expect((form.get('file') as File).name).toBe('consent.pdf');
    // The kind precedes the file: the server reads text parts sent before it.
    expect([...form.keys()]).toEqual(['kind', 'file']);
    expect(requests[1]?.body).toEqual({ fileId: FILE_ID, category: 'consent' });
  });

  it('shows the server’s own words when it refuses the file, and files nothing', async () => {
    const { requests } = stubApi({
      'POST /files': () =>
        json(
          {
            message: 'This file cannot be uploaded',
            code: 'validation_failed',
            fieldErrors: { file: ['application/zip is not accepted for patient_document'] },
          },
          422,
        ),
    });

    await expect(
      httpDocumentsService.upload({ patientId: PATIENT, file: pdf(), category: 'consent' }),
    ).resolves.toEqual({
      kind: 'rejected',
      reason: 'application/zip is not accepted for patient_document',
    });
    expect(requests).toHaveLength(1);
  });

  it('reads 503 on the upload as no document service', async () => {
    stubApi({
      'POST /files': () =>
        json({ message: 'File storage is not configured', code: 'service_unavailable' }, 503),
    });

    await expect(
      httpDocumentsService.upload({ patientId: PATIENT, file: pdf(), category: 'report' }),
    ).resolves.toEqual({ kind: 'unavailable', reason: DOCUMENT_STORAGE_UNAVAILABLE });
  });

  it('reads 413 from the body limit as a rejected file', async () => {
    stubApi({ 'POST /files': () => json({ message: 'Payload too large' }, 413) });

    const outcome = await httpDocumentsService.upload({
      patientId: PATIENT,
      file: pdf(),
      category: 'report',
    });
    expect(outcome).toEqual({
      kind: 'rejected',
      reason: 'The file is larger than the server accepts.',
    });
  });

  it('never reports a stored file as filed when the link is refused', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      [LINK]: () =>
        json(
          {
            message: 'Validation failed',
            code: 'validation_failed',
            fieldErrors: { fileId: ['This upload cannot be filed as a patient document'] },
          },
          422,
        ),
    });

    const outcome = await httpDocumentsService.upload({
      patientId: PATIENT,
      file: pdf(),
      category: 'consent',
    });
    expect(outcome.kind).toBe('rejected');
    expect(outcome).not.toHaveProperty('document');
    expect(outcome.kind === 'rejected' ? outcome.reason : '').toMatch(
      /uploaded but could not be filed.*This upload cannot be filed/,
    );
  });

  it('reads 409 document_already_linked as a refusal, not a second success', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      [LINK]: () => json({ message: 'Already linked', code: 'document_already_linked' }, 409),
    });

    const outcome = await httpDocumentsService.upload({
      patientId: PATIENT,
      file: pdf(),
      category: 'consent',
    });
    expect(outcome).toEqual({
      kind: 'rejected',
      reason: 'This upload is already filed on a record.',
    });
  });

  it('rejects on a malformed link answer instead of inventing a row', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      [LINK]: () => json(envelope({ id: DOCUMENT_ID }), 201),
    });

    await expect(
      httpDocumentsService.upload({ patientId: PATIENT, file: pdf(), category: 'consent' }),
    ).rejects.toMatchObject({ code: 'malformed_response' });
  });
});
