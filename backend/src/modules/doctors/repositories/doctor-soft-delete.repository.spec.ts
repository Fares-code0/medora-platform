import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../shared/database';

import { AdminDoctorRepository } from './admin-doctor.repository';
import { AvailabilityRepository } from './availability.repository';
import { DoctorVerificationRepository } from './doctor-verification.repository';

/**
 * Soft-deleted doctors are not resolved by the doctor repositories.
 *
 * The soft-delete extension filters `findFirst`/`findMany`/`count` but
 * cannot filter `findUnique`, and nothing filters `update`. Every lookup
 * and write these repositories make on an active doctor must therefore
 * name `deletedAt: null` itself — this pins that it does, and that a
 * guarded write which matches nothing reports "gone" instead of throwing.
 */

const DOCTOR = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';

function prismaStub(updateCount = 1) {
  const doctor = {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
  };
  const doctorVerificationDocument = {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
  };
  // PR #61: status writes run in one transaction with the account's
  // `authz_version` bump, and availability is stamped with the employment.
  const user = { update: vi.fn().mockResolvedValue({}) };
  const tx = {
    doctorAvailability: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    doctorEmployment: { findFirst: vi.fn().mockResolvedValue({ id: 'emp-1', hospitalId: 'hsp-1' }) },
    doctor,
    user,
  };
  const prisma = {
    db: { doctor, doctorVerificationDocument },
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;

  return { prisma, doctor, doctorVerificationDocument, user };
}

describe('AdminDoctorRepository — soft-deleted doctors', () => {
  it('findById looks up a live doctor with findFirst, never findUnique', async () => {
    const { prisma, doctor } = prismaStub();

    await expect(new AdminDoctorRepository(prisma).findById(DOCTOR)).resolves.toBeNull();

    expect(doctor.findUnique).not.toHaveBeenCalled();
    expect(doctor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DOCTOR, deletedAt: null } }),
    );
  });

  // PR #61 adaptation: the live check is a `findFirst({ deletedAt: null })`
  // inside the transaction that also bumps `authz_version`, rather than
  // #63's `updateMany` count. The contract is the same: a deleted doctor is
  // never written and the caller gets `null` (404).
  it('setPracticeStatus writes only a live row and reports null when none matched', async () => {
    const { prisma, doctor, user } = prismaStub();

    const result = await new AdminDoctorRepository(prisma).setPracticeStatus({
      doctorId: DOCTOR,
      status: 'SUSPENDED',
      actorId: ACTOR,
    });

    expect(result).toBeNull();
    expect(doctor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DOCTOR, deletedAt: null } }),
    );
    expect(doctor.update).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });

  it('setPracticeStatus returns the written status for a live doctor, and bumps the account', async () => {
    const { prisma, doctor, user } = prismaStub();
    doctor.findFirst.mockResolvedValue({ id: DOCTOR });
    doctor.update.mockResolvedValue({ practiceStatus: 'ACTIVE', userId: USER });

    await expect(
      new AdminDoctorRepository(prisma).setPracticeStatus({
        doctorId: DOCTOR,
        status: 'ACTIVE',
        actorId: ACTOR,
      }),
    ).resolves.toEqual({ practiceStatus: 'ACTIVE' });
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER }, data: { authzVersion: { increment: 1 } } }),
    );
  });

  it('setVerificationStatus writes only a live row and reports null when none matched', async () => {
    const { prisma, doctor, user } = prismaStub();

    const result = await new AdminDoctorRepository(prisma).setVerificationStatus({
      doctorId: DOCTOR,
      status: 'VERIFIED',
      actorId: ACTOR,
      verifiedAt: new Date(),
    });

    expect(result).toBeNull();
    expect(doctor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DOCTOR, deletedAt: null } }),
    );
    expect(doctor.update).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });

  it('setVerificationStatus echoes what it wrote for a live doctor', async () => {
    const { prisma, doctor } = prismaStub();
    const verifiedAt = new Date('2026-11-23T10:00:00Z');
    doctor.findFirst.mockResolvedValue({ id: DOCTOR });
    doctor.update.mockResolvedValue({ verificationStatus: 'VERIFIED', verifiedAt, userId: USER });

    await expect(
      new AdminDoctorRepository(prisma).setVerificationStatus({
        doctorId: DOCTOR,
        status: 'VERIFIED',
        actorId: ACTOR,
        verifiedAt,
      }),
    ).resolves.toEqual({ verificationStatus: 'VERIFIED', verifiedAt });
  });

  it('findDocument and decideDocument require the owning doctor to be live', async () => {
    const { prisma, doctorVerificationDocument } = prismaStub(0);
    const repository = new AdminDoctorRepository(prisma);

    await repository.findDocument(DOCTOR, DOCUMENT);
    expect(doctorVerificationDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DOCUMENT, doctorId: DOCTOR, deletedAt: null, doctor: { deletedAt: null } },
      }),
    );

    await expect(
      repository.decideDocument({ documentId: DOCUMENT, decision: 'approved', actorId: ACTOR }),
    ).resolves.toBe(false);
    expect(doctorVerificationDocument.update).not.toHaveBeenCalled();
    expect(doctorVerificationDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DOCUMENT, deletedAt: null, doctor: { deletedAt: null } },
      }),
    );
  });

  it('userIdFor does not resolve a deleted doctor', async () => {
    const { prisma, doctor } = prismaStub();

    await expect(new AdminDoctorRepository(prisma).userIdFor(DOCTOR)).resolves.toBeNull();
    expect(doctor.findUnique).not.toHaveBeenCalled();
    expect(doctor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DOCTOR, deletedAt: null } }),
    );
  });
});

describe('AvailabilityRepository — soft-deleted doctors', () => {
  it('doctorIdForUser and schedulingFor resolve only a live doctor', async () => {
    const { prisma, doctor } = prismaStub();
    const repository = new AvailabilityRepository(prisma);

    await expect(repository.doctorIdForUser(USER)).resolves.toBeNull();
    await expect(repository.schedulingFor(USER)).resolves.toBeNull();

    expect(doctor.findUnique).not.toHaveBeenCalled();
    for (const call of doctor.findFirst.mock.calls) {
      expect(call[0]).toMatchObject({ where: { userId: USER, deletedAt: null } });
    }
    expect(doctor.findFirst).toHaveBeenCalledTimes(2);
  });

  it('replaceGrid rolls back with 404 when the doctor was deleted meanwhile', async () => {
    const { prisma, doctor } = prismaStub(0);

    await expect(
      new AvailabilityRepository(prisma).replaceGrid({
        doctorId: DOCTOR,
        actorId: ACTOR,
        rows: [],
        defaultDurationMin: 30,
        bufferMin: 5,
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(doctor.update).not.toHaveBeenCalled();
    expect(doctor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DOCTOR, deletedAt: null } }),
    );
  });
});

describe('DoctorVerificationRepository — soft-deleted doctors', () => {
  it('doctorIdForUser resolves only a live doctor', async () => {
    const { prisma, doctor } = prismaStub();

    await expect(new DoctorVerificationRepository(prisma).doctorIdForUser(USER)).resolves.toBeNull();

    expect(doctor.findUnique).not.toHaveBeenCalled();
    expect(doctor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER, deletedAt: null } }),
    );
  });
});
