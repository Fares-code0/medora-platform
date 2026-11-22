import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient, UPLOAD_TIMEOUT_MS } from '@/api/client';
import { envelope, json, stubApi } from '@/test/api-stub';

import { VerificationSubmitError } from '../model/settings-service';

import { VERIFICATION_STORAGE_UNAVAILABLE, httpSettingsService } from './http-settings-service';

/**
 * The doctor's verification documents over HTTP (NEW-46, API §3.6a).
 *
 * Bodies and refusals are transcribed from the backend on this branch:
 * `doctor-verification.controller.ts` / `doctor-verification.schema.ts`
 * (`GET`/`POST /me/verification-documents`), `admin-doctor.dto.ts`
 * (`VerificationDocumentView`) and `files.controller.ts` (`POST /files`).
 * Not run against a live API.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const USER = 'u-live';
const FILE_ID = 'f9a8b7c6-0000-4000-8000-000000000003';

const VIEW = {
  id: 'vd-1',
  kind: 'medical_license',
  fileId: FILE_ID,
  uploadedAt: '2026-11-15T09:00:00.000Z',
  expiresOn: '2028-06-30',
  decision: 'pending',
  decidedAt: null,
  rejectReason: null,
  checks: { authentic: false, current: false, identityMatch: false },
};

const REJECTED = {
  ...VIEW,
  id: 'vd-0',
  kind: 'national_id',
  expiresOn: null,
  decision: 'rejected',
  decidedAt: '2026-11-14T12:00:00.000Z',
  rejectReason: 'The scan is unreadable.',
};

const FILE_VIEW = {
  id: FILE_ID,
  name: 'licence.pdf',
  sizeKb: 1,
  mimeType: 'application/pdf',
  kind: 'verification_document',
  checksumSha256: 'ab',
  scanStatus: 'pending',
  uploadedAt: '2026-11-15T09:00:00.000Z',
};

function pdf(): File {
  return new File(['%PDF-1.7'], 'licence.pdf', { type: 'application/pdf' });
}

describe('listing verification documents', () => {
  it('reads each document, the expiry day as local midnight', async () => {
    stubApi({ 'GET /me/verification-documents': () => envelope([VIEW, REJECTED]) });

    await expect(httpSettingsService.listVerificationDocuments(USER)).resolves.toEqual([
      {
        id: 'vd-1',
        kind: 'medical_license',
        fileId: FILE_ID,
        uploadedAt: '2026-11-15T09:00:00.000Z',
        expiresOn: '2028-06-30T00:00:00',
        decision: 'pending',
        decidedAt: null,
        rejectReason: null,
        checks: { authentic: false, current: false, identityMatch: false },
      },
      {
        id: 'vd-0',
        kind: 'national_id',
        fileId: FILE_ID,
        uploadedAt: '2026-11-15T09:00:00.000Z',
        expiresOn: null,
        decision: 'rejected',
        decidedAt: '2026-11-14T12:00:00.000Z',
        rejectReason: 'The scan is unreadable.',
        checks: { authentic: false, current: false, identityMatch: false },
      },
    ]);
  });

  it('fails on a decision outside the vocabulary rather than guessing one', async () => {
    stubApi({
      'GET /me/verification-documents': () => envelope([{ ...VIEW, decision: 'verified' }]),
    });
    await expect(httpSettingsService.listVerificationDocuments(USER)).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('fails on an unknown kind', async () => {
    stubApi({
      'GET /me/verification-documents': () => envelope([{ ...VIEW, kind: 'passport' }]),
    });
    await expect(httpSettingsService.listVerificationDocuments(USER)).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('fails on a body that is not a list', async () => {
    stubApi({ 'GET /me/verification-documents': () => envelope({ items: [VIEW] }) });
    await expect(httpSettingsService.listVerificationDocuments(USER)).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });
});

describe('submitting a verification document', () => {
  it('uploads the bytes as a verification_document, then files them with kind and expiry', async () => {
    const { requests } = stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () => json(envelope(VIEW), 201),
    });

    const filed = await httpSettingsService.submitVerificationDocument(USER, {
      file: pdf(),
      kind: 'medical_license',
      expiresOn: '2028-06-30',
    });

    expect(filed).toMatchObject({ id: 'vd-1', decision: 'pending' });
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /files',
      'POST /me/verification-documents',
    ]);
    const form = requests[0]?.body as FormData;
    expect(form.get('kind')).toBe('verification_document');
    expect((form.get('file') as File).name).toBe('licence.pdf');
    // The kind precedes the file: the server reads text parts sent before it.
    expect([...form.keys()]).toEqual(['kind', 'file']);
    expect(requests[1]?.body).toEqual({
      fileId: FILE_ID,
      kind: 'medical_license',
      expiresOn: '2028-06-30',
    });
  });

  it('gives the upload the longer multipart timeout (D2)', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () => json(envelope(VIEW), 201),
    });
    const post = vi.spyOn(apiClient, 'post');

    await httpSettingsService.submitVerificationDocument(USER, {
      file: pdf(),
      kind: 'medical_license',
      expiresOn: '2028-06-30',
    });

    expect(post).toHaveBeenCalledWith('/files', expect.any(FormData), {
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    post.mockRestore();
  });

  it('sends no expiresOn when the document states none', async () => {
    const { requests } = stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () => json(envelope({ ...VIEW, expiresOn: null }), 201),
    });

    await httpSettingsService.submitVerificationDocument(USER, {
      file: pdf(),
      kind: 'degree_certificate',
      expiresOn: null,
    });

    expect(requests[1]?.body).toEqual({ fileId: FILE_ID, kind: 'degree_certificate' });
  });

  it('reads 503 on the upload as no file storage, and files nothing', async () => {
    const { requests } = stubApi({
      'POST /files': () =>
        json({ message: 'File storage is not configured', code: 'service_unavailable' }, 503),
    });

    const submitting = httpSettingsService.submitVerificationDocument(USER, {
      file: pdf(),
      kind: 'medical_license',
      expiresOn: null,
    });
    await expect(submitting).rejects.toBeInstanceOf(VerificationSubmitError);
    await expect(submitting).rejects.toThrow(VERIFICATION_STORAGE_UNAVAILABLE);
    expect(requests).toHaveLength(1);
  });

  it('shows the server’s own words when it refuses the file (422)', async () => {
    const { requests } = stubApi({
      'POST /files': () =>
        json(
          {
            message: 'This file cannot be uploaded',
            code: 'validation_failed',
            fieldErrors: { file: ['application/zip is not accepted for verification_document'] },
          },
          422,
        ),
    });

    await expect(
      httpSettingsService.submitVerificationDocument(USER, {
        file: pdf(),
        kind: 'medical_license',
        expiresOn: null,
      }),
    ).rejects.toThrow('application/zip is not accepted for verification_document');
    expect(requests).toHaveLength(1);
  });

  it('never reports a stored file as submitted when filing is refused (422 on fileId)', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () =>
        json(
          {
            message: 'Validation failed',
            code: 'validation_failed',
            fieldErrors: { fileId: ['This upload cannot be filed as a verification document'] },
          },
          422,
        ),
    });

    await expect(
      httpSettingsService.submitVerificationDocument(USER, {
        file: pdf(),
        kind: 'national_id',
        expiresOn: null,
      }),
    ).rejects.toThrow(
      /uploaded but could not be filed.*This upload cannot be filed as a verification document/,
    );
  });

  it('discards the stored upload when filing fails, so nothing is left in storage', async () => {
    const { requests } = stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () =>
        json({ message: 'Validation failed', fieldErrors: { kind: ['Invalid'] } }, 422),
      [`DELETE /files/${FILE_ID}`]: () => new Response(null, { status: 204 }),
    });

    await expect(
      httpSettingsService.submitVerificationDocument(USER, {
        file: pdf(),
        kind: 'medical_license',
        expiresOn: null,
      }),
    ).rejects.toBeInstanceOf(VerificationSubmitError);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /files',
      'POST /me/verification-documents',
      `DELETE /files/${FILE_ID}`,
    ]);
  });

  it('still reports the filing failure when the cleanup itself fails', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () =>
        json({ message: 'Not found', code: 'not_found' }, 404),
      [`DELETE /files/${FILE_ID}`]: () => json({ message: 'boom' }, 500),
    });

    await expect(
      httpSettingsService.submitVerificationDocument(USER, {
        file: pdf(),
        kind: 'medical_license',
        expiresOn: null,
      }),
    ).rejects.toThrow('Only a practitioner account can submit verification documents.');
  });

  it('never deletes the upload once it is filed', async () => {
    const { requests } = stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () => json(envelope(VIEW), 201),
    });

    await httpSettingsService.submitVerificationDocument(USER, {
      file: pdf(),
      kind: 'medical_license',
      expiresOn: null,
    });

    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  });

  it('reads 409 verification_document_already_filed as a refusal', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () =>
        json({ message: 'Already filed', code: 'verification_document_already_filed' }, 409),
    });

    const submitting = httpSettingsService.submitVerificationDocument(USER, {
      file: pdf(),
      kind: 'medical_license',
      expiresOn: null,
    });
    await expect(submitting).rejects.toBeInstanceOf(VerificationSubmitError);
    await expect(submitting).rejects.toThrow('This upload has already been filed.');
  });

  it('reads 404 as an account with no practitioner profile', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () =>
        json({ message: 'Not found', code: 'not_found' }, 404),
    });

    await expect(
      httpSettingsService.submitVerificationDocument(USER, {
        file: pdf(),
        kind: 'medical_license',
        expiresOn: null,
      }),
    ).rejects.toThrow('Only a practitioner account can submit verification documents.');
  });

  it('lets any other failure through for the screen to offer a retry', async () => {
    stubApi({
      'POST /files': () => json(envelope(FILE_VIEW), 201),
      'POST /me/verification-documents': () => json({ message: 'boom', ref: 'ERR-1' }, 500),
    });

    const submitting = httpSettingsService.submitVerificationDocument(USER, {
      file: pdf(),
      kind: 'medical_license',
      expiresOn: null,
    });
    await expect(submitting).rejects.toMatchObject({ kind: 'server' });
    await expect(submitting).rejects.not.toBeInstanceOf(VerificationSubmitError);
  });
});
