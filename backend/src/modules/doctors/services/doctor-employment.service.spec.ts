import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { Prisma } from '../../../generated/prisma/client';
import type { AuditEvent, TransactionalAuditWriter } from '../../../shared/audit';
import type {
  DoctorEmploymentRepository,
  EmploymentRow,
  EndOutcome,
  EndedEmployment,
  WithinTransaction,
} from '../repositories/doctor-employment.repository';

import { DoctorEmploymentService } from './doctor-employment.service';

/**
 * The employment lifecycle's decisions (OD-12, #54), with the repository
 * and the transactional audit writer stubbed. The transaction, the session
 * revocation and the database's one-active rule are proven against
 * PostgreSQL in `test/doctor-employment-lifecycle.e2e-spec.ts`.
 */

const DOCTOR = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const HOSPITAL = '33333333-3333-4333-8333-333333333333';
const DEPARTMENT = '44444444-4444-4444-8444-444444444444';
const EMPLOYMENT = '55555555-5555-4555-8555-555555555555';
const TX = { marker: 'tx' } as unknown as Prisma.TransactionClient;

const ADMIN: AuthenticatedUser = {
  id: '66666666-6666-4666-8666-666666666666',
  publicId: 'usr_admin',
  role: 'admin',
  permissions: ['doctors.manage'],
  sessionId: '77777777-7777-4777-8777-777777777777',
};

function employmentRow(overrides: Partial<EmploymentRow> = {}): EmploymentRow {
  return {
    id: EMPLOYMENT,
    doctorId: DOCTOR,
    hospitalId: HOSPITAL,
    hospitalDepartmentId: null,
    startedAt: new Date('2026-11-01T08:00:00.000Z'),
    endedAt: null,
    hospital: { publicId: 'hsp_one', name: 'One Hospital' },
    department: null,
    ...overrides,
  };
}

interface Setup {
  readonly service: DoctorEmploymentService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly recorded: { tx: unknown; event: AuditEvent }[];
}

function setup(
  options: {
    doctor?: { id: string; userId: string } | null;
    hospital?: { id: string; publicId: string; name: string; status: string } | null;
    department?: { id: string } | null;
    startError?: Error;
    endOutcome?: 'ended' | 'not_found' | 'already_ended';
  } = {},
): Setup {
  const recorded: { tx: unknown; event: AuditEvent }[] = [];
  const audit = {
    recordWithin: vi.fn((tx: unknown, event: AuditEvent) => {
      recorded.push({ tx, event });
      return Promise.resolve();
    }),
  } as unknown as TransactionalAuditWriter;

  const ended: EndedEmployment = {
    employment: employmentRow({ endedAt: new Date('2026-11-23T10:00:00.000Z') }),
    userId: USER,
    revokedAssignments: 2,
    revokedSessions: 3,
    legacyAssignmentsUntouched: 1,
  };

  const repository = {
    findDoctor: vi
      .fn()
      .mockResolvedValue(
        options.doctor === undefined ? { id: DOCTOR, userId: USER } : options.doctor,
      ),
    findHospital: vi
      .fn()
      .mockResolvedValue(
        options.hospital === undefined
          ? { id: HOSPITAL, publicId: 'hsp_one', name: 'One Hospital', status: 'ACTIVE' }
          : options.hospital,
      ),
    findDepartment: vi
      .fn()
      .mockResolvedValue(
        options.department === undefined ? { id: DEPARTMENT } : options.department,
      ),
    listFor: vi.fn().mockResolvedValue([employmentRow()]),
    start: vi.fn(
      async (
        input: { hospitalDepartmentId: string | null },
        within: WithinTransaction<EmploymentRow>,
      ) => {
        if (options.startError !== undefined) throw options.startError;
        const row = employmentRow({ hospitalDepartmentId: input.hospitalDepartmentId });
        await within(TX, row);
        return row;
      },
    ),
    end: vi.fn(
      async (
        _doctorId: string,
        _employmentId: string,
        within: WithinTransaction<EndedEmployment>,
      ): Promise<EndOutcome> => {
        const kind = options.endOutcome ?? 'ended';
        if (kind !== 'ended') return { kind };
        await within(TX, ended);
        return { kind: 'ended', ...ended };
      },
    ),
  };

  const service = new DoctorEmploymentService(
    repository as unknown as DoctorEmploymentRepository,
    audit,
  );

  return { service, repository, recorded };
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('DoctorEmploymentService.start', () => {
  it('creates the employment and audits it on the same transaction, metadata only', async () => {
    const { service, repository, recorded } = setup();

    const view = await service.start(ADMIN, DOCTOR, {
      hospitalId: 'hsp_one',
      hospitalDepartmentId: DEPARTMENT,
    });

    expect(repository.start).toHaveBeenCalledWith(
      { doctorId: DOCTOR, hospitalId: HOSPITAL, hospitalDepartmentId: DEPARTMENT },
      expect.any(Function),
    );
    expect(repository.findDepartment).toHaveBeenCalledWith(HOSPITAL, DEPARTMENT);
    expect(view).toMatchObject({
      id: EMPLOYMENT,
      doctorId: DOCTOR,
      hospital: { id: 'hsp_one', name: 'One Hospital' },
      endedAt: null,
      active: true,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tx).toBe(TX);
    expect(recorded[0]?.event).toEqual({
      action: 'doctor.employment_started',
      actor: { userId: ADMIN.id, role: 'admin', sessionId: ADMIN.sessionId },
      entityType: 'doctor',
      entityId: DOCTOR,
      metadata: {
        employmentId: EMPLOYMENT,
        hospitalId: HOSPITAL,
        hospitalDepartmentId: DEPARTMENT,
      },
    });
  });

  it('starts without a department', async () => {
    const { service, repository } = setup();

    await service.start(ADMIN, DOCTOR, { hospitalId: 'hsp_one' });

    expect(repository.findDepartment).not.toHaveBeenCalled();
    expect(repository.start).toHaveBeenCalledWith(
      expect.objectContaining({ hospitalDepartmentId: null }),
      expect.any(Function),
    );
  });

  it('answers 404 for an unknown or soft-deleted doctor', async () => {
    const { service, repository } = setup({ doctor: null });

    const error = await rejection(service.start(ADMIN, DOCTOR, { hospitalId: 'hsp_one' }));

    expect(error.getStatus()).toBe(404);
    expect(repository.start).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown or soft-deleted hospital', async () => {
    const { service, repository } = setup({ hospital: null });

    const error = await rejection(service.start(ADMIN, DOCTOR, { hospitalId: 'hsp_none' }));

    expect(error.getStatus()).toBe(404);
    expect(repository.start).not.toHaveBeenCalled();
  });

  it('answers 409 hospital_inactive for a hospital that is not ACTIVE', async () => {
    const { service, repository } = setup({
      hospital: { id: HOSPITAL, publicId: 'hsp_one', name: 'One', status: 'SUSPENDED' },
    });

    const error = await rejection(service.start(ADMIN, DOCTOR, { hospitalId: 'hsp_one' }));

    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('hospital_inactive');
    expect(repository.start).not.toHaveBeenCalled();
  });

  it('answers 422 for a department that is not in that hospital', async () => {
    const { service, repository } = setup({ department: null });

    const error = await rejection(
      service.start(ADMIN, DOCTOR, { hospitalId: 'hsp_one', hospitalDepartmentId: DEPARTMENT }),
    );

    expect(error.getStatus()).toBe(422);
    expect(error.code).toBe('validation_failed');
    expect(repository.start).not.toHaveBeenCalled();
  });

  it('maps the one-active-employment unique violation to 409 employment_active', async () => {
    const { service } = setup({
      startError: new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });

    const error = await rejection(service.start(ADMIN, DOCTOR, { hospitalId: 'hsp_one' }));

    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('employment_active');
  });

  it('lets any other failure through unchanged', async () => {
    const boom = new Error('connection lost');
    const { service } = setup({ startError: boom });

    await expect(service.start(ADMIN, DOCTOR, { hospitalId: 'hsp_one' })).rejects.toBe(boom);
  });
});

describe('DoctorEmploymentService.end', () => {
  it('reports the revocation counts and audits ids and counts only', async () => {
    const { service, recorded } = setup();

    const result = await service.end(ADMIN, DOCTOR, EMPLOYMENT);

    expect(result).toEqual({
      employment: expect.objectContaining({
        id: EMPLOYMENT,
        endedAt: '2026-11-23T10:00:00.000Z',
        active: false,
      }) as unknown,
      revokedAssignments: 2,
      revokedSessions: 3,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.tx).toBe(TX);
    expect(recorded[0]?.event).toEqual({
      action: 'doctor.employment_ended',
      actor: { userId: ADMIN.id, role: 'admin', sessionId: ADMIN.sessionId },
      entityType: 'doctor',
      entityId: DOCTOR,
      metadata: {
        employmentId: EMPLOYMENT,
        hospitalId: HOSPITAL,
        hospitalDepartmentId: null,
        revokedAssignments: 2,
        revokedSessions: 3,
        legacyAssignmentsUntouched: 1,
      },
    });
  });

  it('answers 404 for an unknown employment', async () => {
    const { service, recorded } = setup({ endOutcome: 'not_found' });

    const error = await rejection(service.end(ADMIN, DOCTOR, EMPLOYMENT));

    expect(error.getStatus()).toBe(404);
    expect(recorded).toHaveLength(0);
  });

  it('answers 409 invalid_status_transition for an employment already ended', async () => {
    const { service, recorded } = setup({ endOutcome: 'already_ended' });

    const error = await rejection(service.end(ADMIN, DOCTOR, EMPLOYMENT));

    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('invalid_status_transition');
    expect(recorded).toHaveLength(0);
  });
});

describe('DoctorEmploymentService.list', () => {
  it('answers 404 for an unknown doctor', async () => {
    const { service, repository } = setup({ doctor: null });

    const error = await rejection(service.list(DOCTOR));

    expect(error.getStatus()).toBe(404);
    expect(repository.listFor).not.toHaveBeenCalled();
  });

  it('projects each employment with the hospital public id', async () => {
    const { service } = setup();

    await expect(service.list(DOCTOR)).resolves.toEqual([
      {
        id: EMPLOYMENT,
        doctorId: DOCTOR,
        hospital: { id: 'hsp_one', name: 'One Hospital' },
        hospitalDepartment: null,
        startedAt: '2026-11-01T08:00:00.000Z',
        endedAt: null,
        active: true,
      },
    ]);
  });
});
