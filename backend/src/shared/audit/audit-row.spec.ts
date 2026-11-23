import { describe, expect, it } from 'vitest';

import { auditRowOf } from './audit-row';
import type { AuditEvent } from './audit.types';

/**
 * `audit_events.hospital_id` (OD-12, #54).
 *
 * The column is written only when the caller names a hospital, so every
 * call site that predates `AuditEvent.hospitalId` files its row exactly as
 * before — column NULL. The database half (the column is written for the
 * employment events and NULL for others) is in
 * `test/doctor-employment-lifecycle.e2e-spec.ts`.
 */
const HOSPITAL = '33333333-3333-4333-8333-333333333333';

const EVENT: AuditEvent = {
  action: 'doctor.employment_ended',
  actor: { userId: '0b0c3a3e-3d1e-4c43-9d55-0f2f0e1d2c3b', role: 'admin' },
  entityType: 'doctor',
  entityId: '11111111-1111-4111-8111-111111111111',
  occurredAt: new Date('2026-11-23T12:00:00Z'),
};

describe('auditRowOf: hospital id', () => {
  it('writes the hospital id the caller names', () => {
    expect(auditRowOf({ ...EVENT, hospitalId: HOSPITAL }).hospitalId).toBe(HOSPITAL);
  });

  it('leaves the column unset when the caller names none', () => {
    expect(auditRowOf(EVENT)).not.toHaveProperty('hospitalId');
  });

  it('leaves the column unset rather than lose the row over a malformed id', () => {
    // `uuid` would refuse the insert, and a refused insert is a lost event.
    expect(auditRowOf({ ...EVENT, hospitalId: 'hsp_one' })).not.toHaveProperty('hospitalId');
  });

  it('changes nothing else about the row', () => {
    const { hospitalId, ...rest } = auditRowOf({ ...EVENT, hospitalId: HOSPITAL });

    expect(hospitalId).toBe(HOSPITAL);
    expect(rest).toEqual(auditRowOf(EVENT));
  });
});
