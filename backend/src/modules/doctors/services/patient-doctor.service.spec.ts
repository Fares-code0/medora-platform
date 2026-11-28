import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../shared/database';
import { type FileStoragePort, ProfilePhotoUrls } from '../../../shared/files';
import type { PatientDoctorDetail, PatientDoctorSummary } from '../dto/patient-doctor.dto';
import type { PatientDoctorRepository } from '../repositories/patient-doctor.repository';

import { PatientDoctorService } from './patient-doctor.service';

/**
 * `GET /patient/doctors` and `/patient/doctors/:id` never put the stored
 * `doctors.photo_url` (a `files.id`) on the wire — only what
 * `ProfilePhotoUrls` resolves it to, through one lookup per page.
 *
 * Built with the real resolver over a stub `files` table and signer.
 */

const CLEAN = '44444444-4444-4444-8444-444444444444';
const PENDING = '55555555-5555-4555-8555-555555555555';
const LEGACY_KEY = 'profile_photo/2026/09/legacy.png';

function summary(id: string, photoUrl: string | null): PatientDoctorSummary {
  return {
    id,
    fullName: `Dr ${id}`,
    title: null,
    specialty: 'Cardiology',
    departmentName: null,
    photoUrl,
    yearsOfExperience: 5,
    languages: [],
    ratingAvg: null,
    hospital: null,
  };
}

function serviceWith(items: PatientDoctorSummary[], options: { signingFails?: boolean } = {}) {
  const findMany = vi.fn().mockResolvedValue([
    { id: CLEAN, storageKey: 'profile_photo/c.png', scanResult: 'clean' },
    { id: PENDING, storageKey: 'profile_photo/p.png', scanResult: null },
  ]);
  const storage = {
    signedDownloadUrl: vi.fn((key: string) =>
      options.signingFails === true
        ? Promise.reject(new Error('signer unavailable'))
        : Promise.resolve(`https://objects.test/${key}?X-Amz-Signature=abc`),
    ),
  } as unknown as FileStoragePort;

  const repository = {
    search: vi.fn().mockResolvedValue({ items, totalItems: items.length }),
    findById: vi.fn((id: string) => {
      const found = items.find((item) => item.id === id);
      return Promise.resolve(
        found === undefined ? null : ({ ...found } as unknown as PatientDoctorDetail),
      );
    }),
  } as unknown as PatientDoctorRepository;

  const service = new PatientDoctorService(
    repository,
    new ProfilePhotoUrls({ file: { findMany } } as unknown as PrismaService, storage),
  );

  return { service, findMany };
}

const QUERY = { sort: 'name:asc', page: 1, pageSize: 20 } as const;

describe('PatientDoctorService — the doctor photo', () => {
  it('resolves every photo on a page with one lookup, and never echoes a stored value', async () => {
    const items = [
      summary('d1', CLEAN),
      summary('d2', PENDING),
      summary('d3', LEGACY_KEY),
      summary('d4', null),
      summary('d5', 'https://cdn.example.test/p.png'),
    ];
    const { service, findMany } = serviceWith(items);

    const page = await service.search(QUERY);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(page.items.map((item) => item.photoUrl)).toEqual([
      'https://objects.test/profile_photo/c.png?X-Amz-Signature=abc',
      null,
      null,
      null,
      'https://cdn.example.test/p.png',
    ]);

    const body = JSON.stringify(page);
    expect(body).not.toContain(CLEAN);
    expect(body).not.toContain(PENDING);
    expect(body).not.toContain(LEGACY_KEY);
  });

  it('resolves the detail photo the same way', async () => {
    const { service } = serviceWith([summary('d1', CLEAN), summary('d2', PENDING)]);

    expect((await service.byId('d1')).photoUrl).toBe(
      'https://objects.test/profile_photo/c.png?X-Amz-Signature=abc',
    );
    expect((await service.byId('d2')).photoUrl).toBeNull();
  });

  it('answers the page with null photos when signing fails', async () => {
    const { service } = serviceWith([summary('d1', CLEAN)], { signingFails: true });

    expect((await service.search(QUERY)).items[0]?.photoUrl).toBeNull();
  });

  it('makes no lookup for a page with no photos', async () => {
    const { service, findMany } = serviceWith([summary('d1', null)]);

    await service.search(QUERY);
    expect(findMany).not.toHaveBeenCalled();
  });
});
