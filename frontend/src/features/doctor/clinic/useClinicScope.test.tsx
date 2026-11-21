import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UNSCOPED } from '@/features/shared-domain/clinic-scope';
import type { SessionUser } from '@/types/auth';

import { useClinicScope } from './useClinicScope';

/**
 * RM M40.5 — the clinic scope reads the signed-in session and nothing else.
 * A live session names no clinic, so a doctor's board fails closed rather
 * than widening to every clinic; clinic state planted in browser storage
 * changes none of it.
 */

let user: SessionUser | null = null;
vi.mock('@/app/providers', () => ({ useAuth: () => ({ user }) }));

const doctor: SessionUser = {
  id: 'usr_doc',
  name: 'Dr. Real',
  email: 'real@example.test',
  role: 'doctor',
  permissions: [],
};

afterEach(() => {
  user = null;
  window.localStorage.clear();
});

describe('useClinicScope', () => {
  it('is nothing when signed out', () => {
    expect(renderHook(() => useClinicScope()).result.current).toBeNull();
  });

  it('fails closed for a doctor whose session names no clinic, whatever storage says', () => {
    window.localStorage.setItem('medora.admin.clinic.v1', '{"clinicId":"clinic-meadowbrook"}');
    window.localStorage.setItem('medora.session', '{"user":{"clinicId":"clinic-meadowbrook"}}');
    user = doctor;

    expect(renderHook(() => useClinicScope()).result.current).toBeNull();
  });

  it('narrows to the clinic and doctor the session names', () => {
    user = { ...doctor, clinicId: 'clinic-a' };
    expect(renderHook(() => useClinicScope()).result.current).toEqual({
      clinicId: 'clinic-a',
      doctorId: 'usr_doc',
    });
  });

  it('is unscoped for an administrator — a display rule, not a grant', () => {
    user = { ...doctor, role: 'admin' };
    expect(renderHook(() => useClinicScope()).result.current).toBe(UNSCOPED);
  });
});
