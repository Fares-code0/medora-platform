import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import type { ProfilePhotoUrls } from '../../../shared/files';

import type { DiscoveryRepository } from './discovery.repository';
import { discoverySearchSchema, hospitalListSchema } from './discovery.schema';
import { haversineKm } from './discovery.geo';
import { DiscoveryService } from './discovery.service';

const user = (role: string): AuthenticatedUser => ({
  id: '11111111-1111-4111-8111-111111111111',
  publicId: 'usr_x',
  role,
  permissions: [],
  sessionId: 's',
});

function service() {
  const repository = {
    activeInsuranceProvider: vi.fn().mockResolvedValue(null),
    candidateDoctors: vi.fn().mockResolvedValue([]),
    candidateHospitals: vi.fn().mockResolvedValue([]),
    hospitalDetail: vi.fn().mockResolvedValue(null),
    nextSlots: vi.fn().mockResolvedValue(new Map()),
    coveredHospitals: vi.fn().mockResolvedValue(new Set()),
  };
  const photos = { lookup: vi.fn().mockResolvedValue(() => null) };
  return {
    repository,
    service: new DiscoveryService(
      repository as unknown as DiscoveryRepository,
      photos as unknown as ProfilePhotoUrls,
    ),
  };
}

describe('DiscoveryService authorization', () => {
  it.each(['admin', 'doctor', 'nurse'])('refuses the %s role with 403 before any read', async (role) => {
    const { service: discovery, repository } = service();
    const query = discoverySearchSchema.parse({});

    await expect(discovery.search(user(role), query)).rejects.toMatchObject({ status: 403 });
    await expect(discovery.hospitals(user(role), hospitalListSchema.parse({}))).rejects.toMatchObject({
      status: 403,
    });
    await expect(discovery.hospital(user(role), 'x')).rejects.toMatchObject({ status: 403 });
    expect(repository.candidateDoctors).not.toHaveBeenCalled();
    expect(repository.hospitalDetail).not.toHaveBeenCalled();
  });

  it('serves a patient', async () => {
    const { service: discovery } = service();
    await expect(discovery.search(user('patient'), discoverySearchSchema.parse({}))).resolves.toMatchObject({
      totalItems: 0,
    });
  });
});

describe('discovery query validation and distance', () => {
  it('parses near and rejects out-of-range coordinates', () => {
    expect(discoverySearchSchema.parse({ near: '24.7,46.6' }).near).toEqual({
      latitude: 24.7,
      longitude: 46.6,
    });
    expect(discoverySearchSchema.safeParse({ near: '90.5,0' }).success).toBe(false);
    expect(discoverySearchSchema.safeParse({ near: '0,-180.1' }).success).toBe(false);
    expect(discoverySearchSchema.safeParse({ sort: 'distance' }).success).toBe(false);
  });

  it('computes haversine distance', () => {
    const km = haversineKm(
      { latitude: 24.7136, longitude: 46.6753 },
      { latitude: 21.4858, longitude: 39.1925 },
    );
    expect(km).toBeGreaterThan(840);
    expect(km).toBeLessThan(860);
    expect(haversineKm({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 })).toBe(0);
  });
});
