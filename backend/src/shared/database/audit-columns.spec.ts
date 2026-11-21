import { describe, expect, it } from 'vitest';

import { auditCreate, auditSoftDelete, auditUpdate } from './audit-columns';

describe('audit column helpers (RM M4.2)', () => {
  const actor = '11111111-1111-4111-8111-111111111111';

  it('sets both columns on create', () => {
    expect(auditCreate(actor)).toEqual({ createdBy: actor, updatedBy: actor });
  });

  it('never touches createdBy on update', () => {
    // Overwriting `createdBy` would erase who authored a clinical record
    // the first time anyone edits it.
    expect(auditUpdate(actor)).toEqual({ updatedBy: actor });
    expect(Object.keys(auditUpdate(actor))).not.toContain('createdBy');
  });

  it('records the deleter as the last person to touch the row', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');

    // "Who deleted this record" is exactly the question asked of a
    // deleted clinical record, so a soft delete carries `updatedBy` too.
    expect(auditSoftDelete(actor, now)).toEqual({ deletedAt: now, updatedBy: actor });
  });

  it('accepts a null actor for system actions', () => {
    // A scheduled retention sweep has no user. Null means the platform
    // acted; it never means "unknown".
    expect(auditCreate(null)).toEqual({ createdBy: null, updatedBy: null });
    expect(auditSoftDelete(null, new Date(0)).updatedBy).toBeNull();
  });
});
