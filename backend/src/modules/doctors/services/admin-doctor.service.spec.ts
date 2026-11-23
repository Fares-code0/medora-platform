import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import type {
  AdminDoctorDetailRow,
  AdminDoctorRepository,
} from '../repositories/admin-doctor.repository';

import { AdminDoctorService } from './admin-doctor.service';

/**
 * A soft-deleted doctor is 404 on every admin route (ADR-022), and a
 * 404 changes nothing: no write, no audit row, no notification.
 *
 * Two ways the repository says "gone": `findById` returns null (deleted
 * before the request), or a guarded write matches no row (deleted
 * between the read and the write).
 */

const DOCTOR = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';

const ACTOR: AuthenticatedUser = {
  id: '44444444-4444-4444-8444-444444444444',
  publicId: 'usr_admin',
  role: 'admin',
  permissions: ['doctors.manage', 'doctors.verify'],
} as unknown as AuthenticatedUser;

function liveRow(): AdminDoctorDetailRow {
  return {
    id: DOCTOR,
    verificationDocuments: ['medical_license', 'degree_certificate', 'national_id'].map(
      (kind) => ({ kind, decision: 'approved' }),
    ),
  } as unknown as AdminDoctorDetailRow;
}

function serviceWith(options: { found: boolean; writeMatches: boolean }) {
  const repository = {
    findById: vi.fn().mockResolvedValue(options.found ? liveRow() : null),
    upcomingAppointmentCount: vi.fn().mockResolvedValue(0),
    setPracticeStatus: vi.fn(({ status }: { status: string }) =>
      Promise.resolve(options.writeMatches ? { practiceStatus: status } : null),
    ),
    setVerificationStatus: vi.fn(
      ({ status, verifiedAt }: { status: string; verifiedAt: Date | null }) =>
        Promise.resolve(options.writeMatches ? { verificationStatus: status, verifiedAt } : null),
    ),
    findDocument: vi
      .fn()
      .mockResolvedValue(
        options.found ? { id: DOCUMENT, kind: 'medical_license', decision: 'pending' } : null,
      ),
    decideDocument: vi.fn().mockResolvedValue(options.writeMatches),
    userIdFor: vi.fn().mockResolvedValue('55555555-5555-4555-8555-555555555555'),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = {
    publish: vi.fn().mockResolvedValue(undefined),
    publishWithin: vi.fn().mockResolvedValue(undefined),
  };

  const service = new AdminDoctorService(
    repository as unknown as AdminDoctorRepository,
    audit,
    activity,
    outbox,
  );

  return { service, repository, audit, activity, outbox };
}

const ROUTES: readonly [string, (service: AdminDoctorService) => Promise<unknown>][] = [
  ['detail', (s) => s.detail(DOCTOR)],
  ['verify', (s) => s.verify(ACTOR, DOCTOR)],
  ['reject', (s) => s.reject(ACTOR, DOCTOR, { reason: 'Licence does not match' })],
  [
    'request-documents',
    (s) =>
      s.requestDocuments(ACTOR, DOCTOR, { kinds: ['national_id'], reason: 'Scan unreadable' }),
  ],
  ['suspend', (s) => s.suspend(ACTOR, DOCTOR, { reason: 'Licence under review' })],
  ['reactivate', (s) => s.reactivate(ACTOR, DOCTOR)],
  [
    'approve document',
    (s) =>
      s.approveDocument(ACTOR, DOCTOR, DOCUMENT, {
        authentic: true,
        current: true,
        identityMatch: true,
      }),
  ],
  ['reject document', (s) => s.rejectDocument(ACTOR, DOCTOR, DOCUMENT, { reason: 'Expired' })],
];

describe('AdminDoctorService — a soft-deleted doctor', () => {
  it.each(ROUTES)('%s answers 404 and writes nothing', async (_name, call) => {
    const { service, repository, audit, activity, outbox } = serviceWith({
      found: false,
      writeMatches: false,
    });

    await expect(call(service)).rejects.toMatchObject({ status: 404 });

    expect(repository.setPracticeStatus).not.toHaveBeenCalled();
    expect(repository.setVerificationStatus).not.toHaveBeenCalled();
    expect(repository.decideDocument).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
    expect(outbox.publish).not.toHaveBeenCalled();
  });

  it.each(ROUTES.filter(([name]) => name !== 'detail'))(
    '%s answers 404 without an audit row when the doctor is deleted mid-request',
    async (_name, call) => {
      const { service, audit, activity, outbox } = serviceWith({
        found: true,
        writeMatches: false,
      });

      await expect(call(service)).rejects.toMatchObject({ status: 404 });

      expect(audit.record).not.toHaveBeenCalled();
      expect(activity.record).not.toHaveBeenCalled();
      expect(outbox.publish).not.toHaveBeenCalled();
    },
  );
});

describe('AdminDoctorService — a live doctor', () => {
  it('suspends and records the decision', async () => {
    const { service, repository, audit } = serviceWith({ found: true, writeMatches: true });

    await expect(service.suspend(ACTOR, DOCTOR, { reason: 'Licence under review' })).resolves
      .toEqual({ doctorId: DOCTOR, practiceStatus: 'suspended', affectedAppointments: 0 });

    expect(repository.setPracticeStatus).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'doctor.suspend', entityId: DOCTOR }),
    );
  });

  it('verifies when every required document is approved', async () => {
    const { service, audit } = serviceWith({ found: true, writeMatches: true });

    await expect(service.verify(ACTOR, DOCTOR)).resolves.toMatchObject({
      doctorId: DOCTOR,
      verificationStatus: 'verified',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'doctor.verify' }),
    );
  });
});
