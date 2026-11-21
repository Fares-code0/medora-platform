import { describe, expect, it, vi } from 'vitest';

import type { ActivityRecorder } from '../../../shared/activity';
import type { AuditDispatcher } from '../../../shared/audit';
import type { PrismaService } from '../../../shared/database';
import { DOWNLOAD_TTL_SECONDS, type FileStoragePort, ProfilePhotoUrls } from '../../../shared/files';
import type { OutboxPort } from '../../../shared/outbox';
import type {
  SelfProfileRepository,
  SelfProfileRow,
} from '../repositories/self-profile.repository';

import { SelfProfileService } from './self-profile.service';

/**
 * The doctor photo on `GET /me/profile` — stored as a `files.id`, served
 * as a signed URL, and gated on the M25.3 malware scan.
 *
 * The service is built with the **real** `ProfilePhotoUrls` over a stub
 * `files` table and a stub signer, so what is asserted is the document
 * the caller receives, not that a mock was called.
 * `shared/files/profile-photo-urls.spec.ts` covers the resolver's cases
 * exhaustively; `test/profile-photo.e2e-spec.ts` covers the route.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const KEY = 'profile_photo/2026/10/55555555-5555-4555-8555-555555555555.png';
const SIGNED = `https://objects.test/${KEY}?X-Amz-Signature=abc`;

function rowWithPhoto(photoUrl: string | null): SelfProfileRow {
  return {
    publicId: 'usr_doctor',
    firstName: 'Dana',
    lastName: 'Doctor',
    displayName: 'Dana Doctor',
    email: 'dana@medora.test',
    phone: null,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    twoFactorEnabled: false,
    avatarUrl: null,
    patient: null,
    doctor: {
      id: '66666666-6666-4666-8666-666666666666',
      fullName: 'Dana Doctor',
      title: null,
      specialty: 'General Practice',
      licenseNumber: 'LIC-1',
      licenseExpiresOn: null,
      professionalCategory: null,
      yearsOfExperience: 3,
      biography: null,
      languages: [],
      education: [],
      certifications: [],
      skills: [],
      contactEmail: 'dana@medora.test',
      contactPhone: '+10000000000',
      officeLocation: null,
      officeHours: null,
      linkedinUrl: null,
      websiteUrl: null,
      photoUrl,
      verificationStatus: 'VERIFIED',
      verifiedAt: null,
      practiceStatus: 'ACTIVE',
      ratingAvg: null,
      department: null,
    },
  } as unknown as SelfProfileRow;
}

function serviceFor(options: {
  readonly stored: string | null;
  readonly scanResult?: string | null;
  readonly signingFails?: boolean;
}) {
  const findMany = vi.fn().mockResolvedValue(
    options.scanResult === undefined
      ? []
      : [{ id: FILE_ID, storageKey: KEY, scanResult: options.scanResult }],
  );
  const signedDownloadUrl = vi.fn(() =>
    options.signingFails === true
      ? Promise.reject(new Error('store unreachable'))
      : Promise.resolve(SIGNED),
  );
  const storage = { signedDownloadUrl } as unknown as FileStoragePort;

  const repository = {
    findProfile: vi.fn().mockResolvedValue(rowWithPhoto(options.stored)),
  } as unknown as SelfProfileRepository;

  const service = new SelfProfileService(
    repository,
    {} as AuditDispatcher,
    {} as ActivityRecorder,
    {} as OutboxPort,
    storage,
    new ProfilePhotoUrls({ file: { findMany } } as unknown as PrismaService, storage),
  );

  return { service, findMany, signedDownloadUrl };
}

describe('SelfProfileService — the doctor photo on the profile view', () => {
  it('serves a clean photo as a short-TTL inline signed URL, never the stored id', async () => {
    const { service, signedDownloadUrl } = serviceFor({ stored: FILE_ID, scanResult: 'clean' });

    const view = await service.profile(USER_ID);

    expect(view.doctor?.photoUrl).toBe(SIGNED);
    expect(JSON.stringify(view)).not.toContain(FILE_ID);
    expect(signedDownloadUrl).toHaveBeenCalledWith(KEY, DOWNLOAD_TTL_SECONDS, {
      disposition: 'inline',
    });
  });

  it('does not serve a photo the scanner has not run on', async () => {
    const { service, signedDownloadUrl } = serviceFor({ stored: FILE_ID, scanResult: null });

    const view = await service.profile(USER_ID);

    expect(view.doctor?.photoUrl).toBeNull();
    expect(JSON.stringify(view)).not.toContain(FILE_ID);
    expect(signedDownloadUrl).not.toHaveBeenCalled();
  });

  it('does not serve a photo the scanner marked infected', async () => {
    const { service, signedDownloadUrl } = serviceFor({
      stored: FILE_ID,
      scanResult: 'infected',
    });

    expect((await service.profile(USER_ID)).doctor?.photoUrl).toBeNull();
    expect(signedDownloadUrl).not.toHaveBeenCalled();
  });

  it('serves nothing for an id that names no live profile photo', async () => {
    const { service } = serviceFor({ stored: FILE_ID });

    expect((await service.profile(USER_ID)).doctor?.photoUrl).toBeNull();
  });

  it('never echoes a bare storage key written before the files row existed', async () => {
    const { service } = serviceFor({ stored: KEY });

    const view = await service.profile(USER_ID);

    expect(view.doctor?.photoUrl).toBeNull();
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it('passes an absolute https URL through unchanged', async () => {
    const { service, findMany } = serviceFor({ stored: 'https://cdn.example.test/portrait.png' });

    expect((await service.profile(USER_ID)).doctor?.photoUrl).toBe(
      'https://cdn.example.test/portrait.png',
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('degrades to no photo, not a failed profile, when signing fails', async () => {
    const { service } = serviceFor({ stored: FILE_ID, scanResult: 'clean', signingFails: true });

    expect((await service.profile(USER_ID)).doctor?.photoUrl).toBeNull();
  });

  it('answers null with no lookup when there is no photo', async () => {
    const { service, findMany } = serviceFor({ stored: null });

    expect((await service.profile(USER_ID)).doctor?.photoUrl).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
