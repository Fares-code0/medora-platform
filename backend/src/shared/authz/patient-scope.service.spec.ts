import { HttpStatus, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import type { HospitalContextService } from './hospital-context.service';
import {
  HospitalPatientScopeShadow,
  type HospitalPatientScopeRepository,
  type LiveAssignmentScope,
} from './hospital-patient-scope.shadow';
import { PatientScopeService } from './patient-scope.service';
import { PLATFORM_ROLES } from './permission-catalogue';
import type { PatientAssignmentRepository, PlatformRole, Principal } from './authz.types';

/** Assignments the test controls, as `doctorUserId → patientIds`. */
class StubAssignments implements PatientAssignmentRepository {
  constructor(private readonly links: ReadonlyMap<string, readonly string[]>) {}

  isAssigned(doctorUserId: string, patientId: string): Promise<boolean> {
    return Promise.resolve((this.links.get(doctorUserId) ?? []).includes(patientId));
  }
}

const DOCTOR_A: Principal = { userId: 'dr-a', roleCode: 'doctor' };
const DOCTOR_B: Principal = { userId: 'dr-b', roleCode: 'doctor' };

function serviceWith(links: Record<string, readonly string[]>): PatientScopeService {
  return new PatientScopeService(new StubAssignments(new Map(Object.entries(links))));
}

describe('PatientScopeService — the care relationship', () => {
  let scope: PatientScopeService;

  beforeEach(() => {
    scope = serviceWith({ 'dr-a': ['PT-1001', 'PT-1002'], 'dr-b': ['PT-2001'] });
  });

  it('lets an assigned doctor reach their patient', async () => {
    expect(await scope.canReach(DOCTOR_A, 'PT-1001')).toBe(true);
    await expect(scope.assertCanReach(DOCTOR_A, 'PT-1002')).resolves.toBeUndefined();
  });

  it("refuses another doctor's patient", async () => {
    expect(await scope.canReach(DOCTOR_A, 'PT-2001')).toBe(false);
    expect(await scope.canReach(DOCTOR_B, 'PT-1001')).toBe(false);
  });

  it('refuses a patient nobody is assigned to', async () => {
    expect(await scope.canReach(DOCTOR_A, 'PT-9999')).toBe(false);
  });

  it('asks the repository with the principal, never with a name', async () => {
    // ADR-003 removed free-text doctor names so care scoping could not
    // be built on them; this asserts the anchor is the user id.
    const repository = new StubAssignments(new Map([['dr-a', ['PT-1001']]]));
    const spy = vi.spyOn(repository, 'isAssigned');

    await new PatientScopeService(repository).canReach(DOCTOR_A, 'PT-1001');

    expect(spy).toHaveBeenCalledWith('dr-a', 'PT-1001');
  });
});

describe('PatientScopeService — out of scope is 404, not 403', () => {
  // A 403 confirms the patient exists, so walking PT-1000, PT-1001, …
  // against a 403/404 split would disclose the roster without opening a
  // chart. ADR-022's consequences require this test.
  let scope: PatientScopeService;

  beforeEach(() => {
    scope = serviceWith({ 'dr-a': ['PT-1001'] });
  });

  it('throws 404 for a patient assigned to someone else', async () => {
    try {
      await scope.assertCanReach(DOCTOR_B, 'PT-1001');
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect((error as AppException).code).toBe('not_found');
    }
  });

  it('throws the identical error for a patient that does not exist', async () => {
    // The whole point: the two cases must be indistinguishable.
    const mine = await scope.assertCanReach(DOCTOR_B, 'PT-1001').catch((e: unknown) => e);
    const absent = await scope.assertCanReach(DOCTOR_B, 'PT-9999').catch((e: unknown) => e);

    expect((mine as AppException).getStatus()).toBe((absent as AppException).getStatus());
    expect((mine as AppException).message).toBe((absent as AppException).message);
    expect((mine as AppException).code).toBe((absent as AppException).code);
  });

  it('leaks no patient identifier in the refusal', async () => {
    // MG §11.6 — no PHI in error messages.
    try {
      await scope.assertCanReach(DOCTOR_B, 'PT-1001');
      expect.unreachable('expected a refusal');
    } catch (error) {
      const serialized = JSON.stringify({
        message: (error as AppException).message,
        code: (error as AppException).code,
        detail: (error as AppException).detail,
      });

      expect(serialized).not.toContain('PT-1001');
      expect(serialized).not.toContain('dr-b');
    }
  });
});

describe('PatientScopeService — a capability is not a care relationship', () => {
  // Reconciliation §5 rule 5: authorization never asks "is this the
  // admin". patients.view gets an administrator the masked directory,
  // not a chart.
  it('gives no scope to any non-doctor role, however privileged', async () => {
    const scope = serviceWith({ 'u-1': ['PT-1001'] });

    for (const role of PLATFORM_ROLES) {
      const principal: Principal = { userId: 'u-1', roleCode: role };
      const expected = role === 'doctor';

      expect(await scope.canReach(principal, 'PT-1001'), role).toBe(expected);
    }
  });

  it('refuses an administrator even when the assignment row would match', async () => {
    const scope = serviceWith({ 'admin-1': ['PT-1001'] });
    const admin: Principal = { userId: 'admin-1', roleCode: 'admin' };

    await expect(scope.assertCanReach(admin, 'PT-1001')).rejects.toBeInstanceOf(AppException);
  });

  it('never consults a permission set — it takes none', () => {
    // Structural rather than behavioural: `canReach` has no parameter
    // through which a capability could be passed, so no future edit can
    // special-case one without changing the signature.
    expect(PatientScopeService.prototype.canReach.length).toBe(2);
  });
});

describe('PatientScopeService — repository failure', () => {
  it('propagates rather than allowing', async () => {
    // Failing closed: an unreachable assignments table must not become
    // "no restriction applies".
    const failing: PatientAssignmentRepository = {
      isAssigned: () => Promise.reject(new Error('database down')),
    };
    const scope = new PatientScopeService(failing);

    await expect(scope.canReach(DOCTOR_A, 'PT-1001')).rejects.toThrow('database down');
  });

  it('does not even ask when the role cannot hold a relationship', async () => {
    const failing: PatientAssignmentRepository = {
      isAssigned: () => Promise.reject(new Error('should not be called')),
    };
    const scope = new PatientScopeService(failing);
    const role: PlatformRole = 'reception';

    expect(await scope.canReach({ userId: 'u-1', roleCode: role }, 'PT-1001')).toBe(false);
  });
});

describe('PatientScopeService — Phase 22 shadow comparison never changes a decision', () => {
  type Compare = HospitalPatientScopeShadow['compare'];

  /** A shadow whose verdict is forced, to prove the legacy rule alone decides. */
  function shadowReturning(compare: Compare): {
    shadow: HospitalPatientScopeShadow;
    spy: ReturnType<typeof vi.fn>;
  } {
    const spy = vi.fn(compare);
    // `admit` always grants a slot here; the C1 cap has its own cases below.
    return {
      shadow: {
        admit: () => () => undefined,
        compare: spy,
      } as unknown as HospitalPatientScopeShadow,
      spy,
    };
  }

  const LINKS = { 'dr-a': ['PT-1001'], 'admin-1': ['PT-1001'], 'u-1': ['PT-1001'] };
  const CASES: readonly [Principal, string][] = [
    [DOCTOR_A, 'PT-1001'],
    [DOCTOR_A, 'PT-2001'],
    [DOCTOR_B, 'PT-1001'],
    ...PLATFORM_ROLES.map((role): [Principal, string] => [
      { userId: 'u-1', roleCode: role },
      'PT-1001',
    ]),
    [{ userId: 'admin-1', roleCode: 'admin' }, 'PT-1001'],
    [{ userId: 'u-1', roleCode: 'unknown-role' }, 'PT-1001'],
  ];

  const SHADOWS: Record<string, Compare> = {
    'always allows': (_p, _id, legacy) =>
      Promise.resolve({
        legacyAllowed: legacy,
        shadow: { allowed: true, hospitalId: 'h' },
        outcome: legacy ? 'agree_allow' : 'legacy_deny_shadow_allow',
      }),
    'always denies': (_p, _id, legacy) =>
      Promise.resolve({
        legacyAllowed: legacy,
        shadow: { allowed: false, reason: 'no_care_assignment' },
        outcome: legacy ? 'legacy_allow_shadow_deny' : 'agree_deny',
      }),
    throws: () => Promise.reject(new Error('shadow down')),
    'throws synchronously': () => {
      throw new Error('shadow sync failure');
    },
  };

  async function decisions(scope: PatientScopeService): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const [principal, patientId] of CASES) {
      out.push(await scope.canReach(principal, patientId));
      out.push(
        await scope.assertCanReach(principal, patientId).then(
          () => 'reached',
          (error: unknown) =>
            error instanceof AppException ? [error.getStatus(), error.message] : error,
        ),
      );
    }
    return out;
  }

  it.each(Object.keys(SHADOWS))(
    'returns exactly the legacy decisions when the shadow %s',
    async (name) => {
      const legacy = await decisions(serviceWith(LINKS));
      const { shadow } = shadowReturning(SHADOWS[name]!);
      const withShadow = new PatientScopeService(
        new StubAssignments(new Map(Object.entries(LINKS))),
        shadow,
      );

      expect(await decisions(withShadow)).toEqual(legacy);
    },
  );

  it('pins the legacy decision table itself', async () => {
    // Regression anchor: only the assigned doctor reaches; every other
    // principal is a 404 identical to a missing patient.
    const scope = serviceWith(LINKS);
    const reached: string[] = [];
    for (const [principal, patientId] of CASES) {
      if (await scope.canReach(principal, patientId)) {
        reached.push(principal.userId + ':' + principal.roleCode + ':' + patientId);
      }
    }
    expect(reached).toEqual(['dr-a:doctor:PT-1001', 'u-1:doctor:PT-1001']);
  });

  it('hands the shadow the legacy verdict after the legacy rule has decided', async () => {
    const { shadow, spy } = shadowReturning(SHADOWS['always denies']!);
    const scope = new PatientScopeService(
      new StubAssignments(new Map(Object.entries(LINKS))),
      shadow,
    );

    await scope.canReach(DOCTOR_A, 'PT-1001');
    await scope.canReach(DOCTOR_A, 'PT-2001');

    expect(spy.mock.calls).toEqual([
      [DOCTOR_A, 'PT-1001', true],
      [DOCTOR_A, 'PT-2001', false],
    ]);
  });

  it('never runs the shadow when the legacy repository fails, and still propagates', async () => {
    const { shadow, spy } = shadowReturning(SHADOWS['always allows']!);
    const failing: PatientAssignmentRepository = {
      isAssigned: () => Promise.reject(new Error('database down')),
    };
    const scope = new PatientScopeService(failing, shadow);

    await expect(scope.canReach(DOCTOR_A, 'PT-1001')).rejects.toThrow('database down');
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the canReach signature free of any context or capability parameter', () => {
    expect(PatientScopeService.prototype.canReach.length).toBe(2);
    expect(PatientScopeService.prototype.assertCanReach.length).toBe(2);
  });
});

describe('PatientScopeService — the shadow is detached from the decision (audit F1)', () => {
  const ASSIGNED = { 'dr-a': ['PT-1001'] };
  /** Resolves to 'blocked' if `work` has not settled within `ms` — a hang detector. */
  async function settlesWithin<T>(work: Promise<T>, ms = 250): Promise<T | 'blocked'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blocked = new Promise<'blocked'>((done) => {
      timer = setTimeout(() => done('blocked'), ms);
    });
    try {
      return await Promise.race([work, blocked]);
    } finally {
      clearTimeout(timer);
    }
  }
  /** Lets queued microtasks and the next macrotask run, so late rejections surface. */
  async function flush(): Promise<void> {
    await new Promise((done) => setImmediate(done));
    await new Promise((done) => setTimeout(done, 10));
  }
  function serviceWithShadow(compare: (...args: unknown[]) => unknown): {
    scope: PatientScopeService;
    compareSpy: ReturnType<typeof vi.fn>;
  } {
    const compareSpy = vi.fn(compare);
    const scope = new PatientScopeService(new StubAssignments(new Map(Object.entries(ASSIGNED))), {
      admit: () => () => undefined,
      compare: compareSpy,
    } as unknown as HospitalPatientScopeShadow);
    return { scope, compareSpy };
  }
  const never = (): Promise<never> => new Promise<never>(() => undefined);

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('canReach returns the legacy result although the comparison never settles', async () => {
    const { scope, compareSpy } = serviceWithShadow(never);

    expect(await settlesWithin(scope.canReach(DOCTOR_A, 'PT-1001'))).toBe(true);
    expect(await settlesWithin(scope.canReach(DOCTOR_A, 'PT-2001'))).toBe(false);
    // The comparison really was started, with the legacy verdict.
    expect(compareSpy.mock.calls).toEqual([
      [DOCTOR_A, 'PT-1001', true],
      [DOCTOR_A, 'PT-2001', false],
    ]);
  });

  it('assertCanReach resolves or 404s exactly as before although the comparison never settles', async () => {
    const { scope } = serviceWithShadow(never);

    expect(await settlesWithin(scope.assertCanReach(DOCTOR_A, 'PT-1001'))).toBeUndefined();
    const refused = await settlesWithin(
      scope.assertCanReach(DOCTOR_A, 'PT-2001').then(
        () => 'reached',
        (error: unknown) => error,
      ),
    );
    expect(refused).toBeInstanceOf(AppException);
    expect((refused as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it('a synchronous throw from the comparison does not affect the decision and is logged', async () => {
    const { scope, compareSpy } = serviceWithShadow(() => {
      throw new Error('shadow exploded synchronously');
    });

    expect(await settlesWithin(scope.canReach(DOCTOR_A, 'PT-1001'))).toBe(true);
    await expect(scope.assertCanReach(DOCTOR_A, 'PT-2001')).rejects.toBeInstanceOf(AppException);
    expect(compareSpy).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('Patient scope shadow comparison unavailable');
  });

  it('an asynchronous rejection does not affect the decision and is handled after the decision returns', async () => {
    let reject: (reason: unknown) => void = () => undefined;
    const { scope } = serviceWithShadow(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );

    expect(await settlesWithin(scope.canReach(DOCTOR_A, 'PT-1001'))).toBe(true);
    // The decision is already returned; only now does the shadow fail.
    reject(new Error('shadow query failed late'));
    await flush();

    expect(warn).toHaveBeenCalledWith('Patient scope shadow comparison unavailable');
  });

  it('produces no unhandled promise rejection, synchronous or asynchronous', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const rejecting = serviceWithShadow(() => Promise.reject(new Error('async failure')));
      const throwing = serviceWithShadow(() => {
        throw new Error('sync failure');
      });
      for (let i = 0; i < 5; i += 1) {
        await rejecting.scope.canReach(DOCTOR_A, 'PT-1001');
        await rejecting.scope.assertCanReach(DOCTOR_A, 'PT-1001');
        await throwing.scope.canReach(DOCTOR_A, 'PT-2001');
      }
      await flush();
    } finally {
      process.off('unhandledRejection', listener);
    }

    expect(unhandled).toEqual([]);
  });

  it('runs no comparison at all when the shadow is disabled (not provided)', async () => {
    // HOSPITAL_SCOPE_SHADOW_COMPARISON=false makes the module provide no
    // shadow (authz.module.ts); the PostgreSQL switch-off test proves the
    // wiring. Here: with no shadow, nothing is started and nothing is logged.
    const assignments = new StubAssignments(new Map(Object.entries(ASSIGNED)));
    const isAssigned = vi.spyOn(assignments, 'isAssigned');
    const scope = new PatientScopeService(assignments);

    expect(await scope.canReach(DOCTOR_A, 'PT-1001')).toBe(true);
    await expect(scope.assertCanReach(DOCTOR_A, 'PT-2001')).rejects.toBeInstanceOf(AppException);
    await flush();

    expect(isAssigned).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * C1 (#26): the in-flight cap and slot accounting, with the real shadow class
 * and a repository whose every call the test settles by hand — a hung query,
 * a timeout (`57014`) and a failure are each a promise the test controls.
 */
describe('PatientScopeService — shadow resource bounds (C1)', () => {
  const ASSIGNED = { 'dr-a': ['PT-1001'] };
  const SCOPED: LiveAssignmentScope = {
    hospitalId: 'h-a',
    hospitalMedicalRecordId: 'hmr-a',
    doctorEmploymentId: 'emp-a',
    employmentEndedAt: null,
    hospitalActive: true,
  };
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  interface Pending {
    resolve: (rows: readonly LiveAssignmentScope[]) => void;
    reject: (error: unknown) => void;
  }

  function bounded(maxInFlight: number) {
    const pending: Pending[] = [];
    const repository: HospitalPatientScopeRepository = {
      liveAssignmentScopes: () =>
        new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    };
    const contexts = {
      forRequest: () =>
        Promise.resolve({
          kind: 'hospital',
          hospitalId: 'h-a',
          hospitalName: 'A',
          source: 'doctor_employment',
        }),
    } as unknown as HospitalContextService;
    const shadow = new HospitalPatientScopeShadow(contexts, repository, { maxInFlight });
    const scope = new PatientScopeService(
      new StubAssignments(new Map(Object.entries(ASSIGNED))),
      shadow,
    );
    return { shadow, scope, pending };
  }

  const flush = (): Promise<void> => new Promise((done) => setImmediate(done));

  it('skips, without queuing, once the cap is reached — and the decision returns at once', async () => {
    const { shadow, scope, pending } = bounded(2);

    for (let i = 0; i < 5; i += 1) {
      await expect(scope.canReach(DOCTOR_A, 'PT-1001')).resolves.toBe(true);
    }
    await flush();

    expect(pending).toHaveLength(2);
    expect(shadow.load()).toEqual({ inFlight: 2, skipped: 3, maxInFlight: 2 });
  });

  it('releases the slot after a successful comparison', async () => {
    const { shadow, scope, pending } = bounded(1);

    await scope.canReach(DOCTOR_A, 'PT-1001');
    await flush();
    expect(shadow.load().inFlight).toBe(1);

    pending[0]?.resolve([SCOPED]);
    await flush();

    expect(shadow.load().inFlight).toBe(0);
    await scope.canReach(DOCTOR_A, 'PT-1001');
    await flush();
    expect(pending).toHaveLength(2);
  });

  it('releases the slot after a failed comparison, and logs it', async () => {
    const { shadow, scope, pending } = bounded(1);

    await scope.canReach(DOCTOR_A, 'PT-1001');
    await flush();
    pending[0]?.reject(new Error('connection reset'));
    await flush();

    expect(shadow.load().inFlight).toBe(0);
    expect(warn).toHaveBeenCalledWith('Patient scope shadow comparison unavailable');
  });

  it('releases the slot when the statement timeout cancels the shadow query (57014)', async () => {
    const { shadow, scope, pending } = bounded(1);

    await expect(scope.canReach(DOCTOR_A, 'PT-1001')).resolves.toBe(true);
    await flush();
    pending[0]?.reject(
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
    );
    await flush();

    expect(shadow.load().inFlight).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('releases the slot when the comparison throws synchronously', async () => {
    const { shadow, scope } = bounded(1);
    vi.spyOn(shadow, 'compare').mockImplementation(() => {
      throw new Error('sync failure');
    });

    await expect(scope.canReach(DOCTOR_A, 'PT-1001')).resolves.toBe(true);

    expect(shadow.load().inFlight).toBe(0);
  });

  it('keeps a hung comparison counted, so hung work stays bounded by the cap', async () => {
    const { shadow, scope, pending } = bounded(1);

    await scope.canReach(DOCTOR_A, 'PT-1001'); // never settled by the test
    await flush();
    await expect(scope.canReach(DOCTOR_B, 'PT-1001')).resolves.toBe(false);
    await expect(scope.assertCanReach(DOCTOR_B, 'PT-1001')).rejects.toBeInstanceOf(AppException);
    await flush();

    expect(pending).toHaveLength(1);
    expect(shadow.load()).toMatchObject({ inFlight: 1, skipped: 2 });

    // Once the database answers (or times it out), the slot comes back.
    pending[0]?.resolve([]);
    await flush();
    expect(shadow.load().inFlight).toBe(0);
  });

  it('never lets a slot go negative or be released twice', () => {
    const { shadow } = bounded(1);
    const release = shadow.admit();

    release?.();
    release?.();

    expect(shadow.load().inFlight).toBe(0);
    expect(shadow.admit()).not.toBeNull();
  });

  it('returns the legacy decisions unchanged whether the shadow runs, is skipped or hangs', async () => {
    const { scope } = bounded(1);
    const cases: [Principal, string, boolean][] = [
      [DOCTOR_A, 'PT-1001', true],
      [DOCTOR_A, 'PT-2001', false],
      [DOCTOR_B, 'PT-1001', false],
      [{ userId: 'adm', roleCode: 'admin' }, 'PT-1001', false],
    ];

    for (const [principal, patient, expected] of cases) {
      await expect(scope.canReach(principal, patient)).resolves.toBe(expected);
    }
  });
});
