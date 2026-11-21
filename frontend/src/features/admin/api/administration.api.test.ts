import { beforeEach, describe, expect, it } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { administrationApi, auditEvents, DEFAULT_CLINIC } from './administration.api';

/**
 * The clinic store — Phase B.
 *
 * Before this, every admin collection was a `readonly` const with no write
 * path at all, and the two sections that looked editable (Announcements,
 * Templates) mutated local `useState` that was discarded on navigation.
 * These tests pin the contract the sections now rely on: edits persist, and
 * each mutation resolves to the FULL patched collection so the query layer
 * can seed its cache instead of refetching.
 */

const STORAGE_KEY = 'medora.admin.clinic.v1';

function newDepartment(name: string) {
  return {
    name,
    description: 'Added by a test',
    status: 'active',
    headStaffId: '',
    staffCount: 0,
  } as const;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('reads', () => {
  it('serves the seeded baseline when nothing is stored', async () => {
    await expect(administrationApi.staff.list()).resolves.toEqual(DEFAULT_CLINIC.staff);
  });

  it('falls back to the baseline when storage holds junk', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json');

    await expect(administrationApi.rooms.list()).resolves.toEqual(DEFAULT_CLINIC.rooms);
  });

  it('defaults a collection that is absent from an older stored document', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ staff: [] }));

    await expect(administrationApi.staff.list()).resolves.toEqual([]);
    // Not a hole — the collection the old document never knew about.
    await expect(administrationApi.holidays.list()).resolves.toEqual(DEFAULT_CLINIC.holidays);
  });
});

describe('create', () => {
  it('returns the full collection with the new record at the head', async () => {
    const before = DEFAULT_CLINIC.departments.length;

    const next = await administrationApi.departments.create(newDepartment('Radiology'));

    expect(next).toHaveLength(before + 1);
    expect(next[0]?.name).toBe('Radiology');
  });

  it('assigns an id that does not collide with an existing one', async () => {
    const first = await administrationApi.departments.create(newDepartment('A'));
    const second = await administrationApi.departments.create(newDepartment('B'));

    const ids = second.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });

  it('persists, so a later read sees the record', async () => {
    await administrationApi.departments.create(newDepartment('Radiology'));

    const reread = await administrationApi.departments.list();
    expect(reread.some((d) => d.name === 'Radiology')).toBe(true);
  });
});

describe('update', () => {
  it('patches only the targeted record', async () => {
    const target = DEFAULT_CLINIC.staff[0];
    if (!target) throw new Error('seed has no staff');

    const next = await administrationApi.staff.update(target.id, { status: 'on-leave' });

    expect(next.find((s) => s.id === target.id)?.status).toBe('on-leave');
    expect(next.find((s) => s.id === target.id)?.name).toBe(target.name);
    const others = next.filter((s) => s.id !== target.id);
    expect(others).toEqual(DEFAULT_CLINIC.staff.filter((s) => s.id !== target.id));
  });

  it('is a no-op for an unknown id rather than throwing', async () => {
    await expect(administrationApi.staff.update('nope', { status: 'on-leave' })).resolves.toEqual(
      DEFAULT_CLINIC.staff,
    );
  });
});

describe('remove', () => {
  it('drops the record and persists the deletion', async () => {
    const target = DEFAULT_CLINIC.rooms[0];
    if (!target) throw new Error('seed has no rooms');

    const next = await administrationApi.rooms.remove(target.id);

    expect(next.some((r) => r.id === target.id)).toBe(false);
    await expect(administrationApi.rooms.list()).resolves.toEqual(next);
  });
});

describe('workingSchedule', () => {
  it('edits a weekday in place, keyed by day rather than id', async () => {
    const next = await administrationApi.workingSchedule.setDay('Sat', { open: false });

    expect(next.find((d) => d.day === 'Sat')?.open).toBe(false);
    expect(next).toHaveLength(DEFAULT_CLINIC.workingSchedule.length);
  });
});

describe('resetClinic', () => {
  it('restores every collection to the seeded baseline', async () => {
    await administrationApi.staff.remove(DEFAULT_CLINIC.staff[0]?.id ?? '');
    await administrationApi.resetClinic();

    await expect(administrationApi.staff.list()).resolves.toEqual(DEFAULT_CLINIC.staff);
  });
});

describe('getAuditEvents', () => {
  /*
   * `AuditEvent.target` is free text rendered on the admin home page (Task
   * 7's activity feed) with no masking and no capability check in front of
   * it — the audit log is not a PHI-gated surface, so nothing downstream of
   * this read protects a patient's name. `PhiAccessProvider.test.tsx` already
   * pins the write side: an audit line the app itself writes for a reveal
   * names the record, never the patient. This is the same contract checked
   * from the read side, over every seeded event, so a future seed with a
   * patient's full name in `target` fails here instead of shipping to the
   * home page.
   *
   * Names come from `MOCK_PATIENTS`, the canonical patient roster, rather
   * than being hardcoded — so this keeps checking the right names as the
   * seed data changes instead of silently going stale.
   */
  it('never lets a seeded target carry a patient name', async () => {
    const events = await administrationApi.getAuditEvents();
    expect(events.length).toBeGreaterThan(0);
    /*
     * This test derives the expected ids from `auditEvents` rather than
     * hardcoding them, because `getAuditEvents()` projects seeded events
     * through `AUDIT_FEED_TYPES` allowlist. A seeded event whose action
     * matches no known prefix classifies as `'other'` (a fallback in
     * `classifyAuditAction`), which is not in the allowlist. Such an event
     * vanishes silently from both ADM-01's home feed and ADM-09's audit
     * panel. By deriving the assertion from the seed, a future seed with an
     * unknown action prefix fails here instead of shipping with a broken
     * projection that test iterations never noticed.
     */
    const ids = events.map((event) => event.id);
    const expectedIds = auditEvents.map((event) => event.id);
    expect(ids).toEqual(expect.arrayContaining(expectedIds));
    const patientNames = MOCK_PATIENTS.map((patient) => patient.name);
    expect(patientNames.length).toBeGreaterThan(0);

    for (const event of events) {
      for (const name of patientNames) {
        expect(event.target).not.toContain(name);
      }
    }
  });
});
