import { describe, expect, it, vi } from 'vitest';

import type { Principal, PatientSelfScopeService } from '../../../shared/authz';
import type { PrismaService } from '../../../shared/database';
import { type FileStoragePort, ProfilePhotoUrls } from '../../../shared/files';
import type { PatientAppointmentQuery } from '../dto/patient-appointment.schema';
import type {
  DetailRow,
  PatientAppointmentRepository,
} from '../repositories/patient-appointment.repository';
import type { PatientBookingRepository } from '../repositories/patient-booking.repository';

import type { ClinicTimezoneSource } from './clinic-timezone';
import { PatientAppointmentService } from './patient-appointment.service';

/**
 * `GET /me/appointments` and `/me/appointments/:id` embed the doctor, and
 * with it the doctor's photo. The stored `doctors.photo_url` (a
 * `files.id`) never reaches the wire — only what `ProfilePhotoUrls`
 * resolves it to, through one lookup per page.
 *
 * Built with the real resolver over a stub `files` table and signer.
 */

const CLEAN = '44444444-4444-4444-8444-444444444444';
const INFECTED = '66666666-6666-4666-8666-666666666666';
const LEGACY_KEY = 'profile_photo/2026/09/legacy.png';
const PRINCIPAL = { userId: 'u1', role: 'patient' } as unknown as Principal;

function row(publicId: string, photoUrl: string | null): DetailRow {
  return {
    id: `id-${publicId}`,
    hospitalId: null,
    publicId,
    startsAt: new Date('2026-11-02T09:00:00.000Z'),
    durationMin: 30,
    status: 'CONFIRMED',
    priority: 'ROUTINE',
    reason: 'Check-up',
    isNewPatient: false,
    isFollowUp: false,
    doctor: { id: `doc-${publicId}`, fullName: 'Dr X', title: null, specialty: 'GP', photoUrl },
    department: null,
    visitType: { name: 'Consultation' },
    notes: null,
    cancelledReason: null,
    events: [],
  };
}

function serviceWith(rows: DetailRow[], options: { signingFails?: boolean } = {}) {
  const findMany = vi.fn().mockResolvedValue([
    { id: CLEAN, storageKey: 'profile_photo/c.png', scanResult: 'clean' },
    { id: INFECTED, storageKey: 'profile_photo/i.png', scanResult: 'infected' },
  ]);
  const storage = {
    signedDownloadUrl: vi.fn((key: string) =>
      options.signingFails === true
        ? Promise.reject(new Error('signer unavailable'))
        : Promise.resolve(`https://objects.test/${key}?X-Amz-Signature=abc`),
    ),
  } as unknown as FileStoragePort;

  const repository = {
    listOwn: vi.fn().mockResolvedValue({ rows, totalItems: rows.length }),
    findOwn: vi.fn((_patient: string, id: string) =>
      Promise.resolve(rows.find((candidate) => candidate.publicId === id) ?? null),
    ),
  } as unknown as PatientAppointmentRepository;

  const timezone: ClinicTimezoneSource = { current: () => Promise.resolve('Africa/Cairo') };

  const service = new PatientAppointmentService(
    repository,
    { patientIdFor: vi.fn().mockResolvedValue('PT-1') } as unknown as PatientSelfScopeService,
    timezone,
    new ProfilePhotoUrls({ file: { findMany } } as unknown as PrismaService, storage),
    {
      supersedeStale: vi.fn().mockResolvedValue(undefined),
      hospitalNames: vi.fn().mockResolvedValue(new Map()),
      pendingAmong: vi.fn().mockResolvedValue(new Set()),
      pendingRequestFor: vi.fn().mockResolvedValue(null),
      slotTimings: vi.fn().mockResolvedValue(new Map()),
    } as unknown as PatientBookingRepository,
  );

  return { service, findMany };
}

const QUERY = { sort: 'startsAt:desc', page: 1, pageSize: 20 } as unknown as PatientAppointmentQuery;

describe('PatientAppointmentService — the embedded doctor photo', () => {
  it('resolves every embedded photo on a page with one lookup', async () => {
    const { service, findMany } = serviceWith([
      row('A1', CLEAN),
      row('A2', INFECTED),
      row('A3', LEGACY_KEY),
      row('A4', null),
      row('A5', CLEAN),
    ]);

    const page = await service.listOwn(PRINCIPAL, QUERY);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(page.items.map((item) => item.doctor.photoUrl)).toEqual([
      'https://objects.test/profile_photo/c.png?X-Amz-Signature=abc',
      null,
      null,
      null,
      'https://objects.test/profile_photo/c.png?X-Amz-Signature=abc',
    ]);

    const body = JSON.stringify(page);
    expect(body).not.toContain(CLEAN);
    expect(body).not.toContain(INFECTED);
    expect(body).not.toContain(LEGACY_KEY);
  });

  it('resolves the photo on the appointment detail', async () => {
    const { service } = serviceWith([row('A1', CLEAN), row('A2', INFECTED)]);

    expect((await service.ownById(PRINCIPAL, 'A1')).doctor.photoUrl).toBe(
      'https://objects.test/profile_photo/c.png?X-Amz-Signature=abc',
    );
    expect((await service.ownById(PRINCIPAL, 'A2')).doctor.photoUrl).toBeNull();
  });

  it('keeps the rest of the embedded doctor unchanged', async () => {
    const { service } = serviceWith([row('A1', CLEAN)]);

    const detail = await service.ownById(PRINCIPAL, 'A1');

    expect(detail.doctor).toEqual({
      id: 'doc-A1',
      fullName: 'Dr X',
      title: null,
      specialty: 'GP',
      photoUrl: 'https://objects.test/profile_photo/c.png?X-Amz-Signature=abc',
    });
  });

  it('answers with null photos when signing fails', async () => {
    const { service } = serviceWith([row('A1', CLEAN)], { signingFails: true });

    expect((await service.listOwn(PRINCIPAL, QUERY)).items[0]?.doctor.photoUrl).toBeNull();
  });
});
