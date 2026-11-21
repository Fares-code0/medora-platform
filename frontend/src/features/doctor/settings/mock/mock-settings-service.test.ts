import { afterEach, describe, expect, it } from 'vitest';

import { VerificationSubmitError } from '../model/settings-service';

import { mockSettingsService } from './mock-settings-service';

/**
 * The demo's integration connect (RM M40.4). The simulated linked account is
 * the demo adapter's to invent — it used to be a table in the shared
 * `IntegrationsSection`, which put it in every production bundle.
 */

afterEach(() => {
  window.localStorage.clear();
});

describe('mockSettingsService.toggleIntegration', () => {
  it('links a simulated account when the caller names none', async () => {
    const document = await mockSettingsService.toggleIntegration('u-demo', {
      id: 'zoom',
      connect: true,
      account: null,
    });
    const zoom = document.integrations.find((integration) => integration.id === 'zoom');
    expect(zoom).toMatchObject({ connected: true, account: 'amelia.chen@medora.health' });
  });

  it('keeps an account the caller names, and clears it on disconnect', async () => {
    const linked = await mockSettingsService.toggleIntegration('u-demo', {
      id: 'outlook',
      connect: true,
      account: 'someone@example.test',
    });
    expect(linked.integrations.find((i) => i.id === 'outlook')?.account).toBe(
      'someone@example.test',
    );

    const unlinked = await mockSettingsService.toggleIntegration('u-demo', {
      id: 'outlook',
      connect: false,
      account: null,
    });
    expect(unlinked.integrations.find((i) => i.id === 'outlook')).toMatchObject({
      connected: false,
      account: null,
    });
  });
});

describe('mockSettingsService verification documents (NEW-46)', () => {
  it('files a submission as pending, and lists it newest first', async () => {
    const user = 'u-verify';
    await expect(mockSettingsService.listVerificationDocuments(user)).resolves.toEqual([]);

    await mockSettingsService.submitVerificationDocument(user, {
      file: new File(['%PDF-1.7'], 'degree.pdf', { type: 'application/pdf' }),
      kind: 'degree_certificate',
      expiresOn: null,
    });
    const filed = await mockSettingsService.submitVerificationDocument(user, {
      file: new File(['png'], 'licence.png', { type: 'image/png' }),
      kind: 'medical_license',
      expiresOn: '2028-06-30',
    });

    expect(filed).toMatchObject({
      kind: 'medical_license',
      decision: 'pending',
      expiresOn: '2028-06-30T00:00:00',
      rejectReason: null,
    });
    const listed = await mockSettingsService.listVerificationDocuments(user);
    expect(listed.map((document) => document.kind)).toEqual([
      'medical_license',
      'degree_certificate',
    ]);
  });

  it('refuses a type the server would refuse, and files nothing', async () => {
    const user = 'u-verify-refused';
    await expect(
      mockSettingsService.submitVerificationDocument(user, {
        file: new File(['zip'], 'scans.zip', { type: 'application/zip' }),
        kind: 'national_id',
        expiresOn: null,
      }),
    ).rejects.toBeInstanceOf(VerificationSubmitError);
    await expect(mockSettingsService.listVerificationDocuments(user)).resolves.toEqual([]);
  });
});
