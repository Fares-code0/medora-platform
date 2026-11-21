import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_SCAN_MESSAGE,
  type ResolvedDocument,
} from './model/patient-documents-service';
import { patientDocumentsService } from './service';

/**
 * The documents seam (D-04).
 *
 * The one thing worth guarding here is that the seam has no second
 * implementation to fall into. `unconfigured-documents-service.ts` exists
 * because the honest answer to "give me this patient's insurance scan" is
 * "there is no storage in this build" — and the moment someone adds a
 * `mockDocumentsService` that answers with a generated file, the tab starts
 * handing out forged clinical documents again with nothing in the UI
 * changed. So the test asserts on the answer, not on the wiring.
 *
 * This suite runs the mock build. Live builds select
 * `http/http-documents-service.ts`, contract-tested on its own.
 */

describe('the patient-documents service', () => {
  it('reports storage as unconfigured, matching the backend indicator', async () => {
    await expect(patientDocumentsService.storageState()).resolves.toBe('unconfigured');
  });

  it('resolves no document to anything openable, whatever the id', async () => {
    for (const id of ['PT-1001-doc-0', 'PT-9999-doc-7', '']) {
      const resolved: ResolvedDocument = await patientDocumentsService.resolve('PT-1001', id);
      expect(resolved.kind).not.toBe('ready');
      expect(resolved).not.toHaveProperty('url');
    }
  });

  it('refuses in words a doctor can act on, rather than by throwing', async () => {
    const resolved = await patientDocumentsService.resolve('PT-1001', 'PT-1001-doc-0');

    expect(resolved.kind).toBe('unavailable');
    expect(resolved.kind === 'unavailable' ? resolved.reason : '').toMatch(
      /no document service is connected/i,
    );
  });

  it('names both scan outcomes, so neither surfaces as a bare code', () => {
    expect(DOCUMENT_SCAN_MESSAGE['scan-pending']).toMatch(/not cleared the malware scan/i);
    expect(DOCUMENT_SCAN_MESSAGE.infected).toMatch(/malware scan/i);
  });
});

describe('storing a patient document (D-04b)', () => {
  it('refuses the upload rather than resolving with a row nothing backs', async () => {
    // The backend's own stub sets the rule this mirrors: a put() that
    // resolves without writing "would hand the caller a file id for bytes
    // that do not exist, and the failure would surface later as a broken
    // download rather than a failed upload".
    const outcome = await patientDocumentsService.upload({
      patientId: 'PT-1001',
      file: new File(['x'], 'consent.pdf', { type: 'application/pdf' }),
      category: 'consent',
    });

    expect(outcome.kind).toBe('unavailable');
    expect(outcome).not.toHaveProperty('document');
    expect(outcome.kind === 'unavailable' ? outcome.reason : '').toMatch(
      /no document service is connected/i,
    );
  });
});
