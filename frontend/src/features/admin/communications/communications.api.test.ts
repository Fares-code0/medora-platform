import { beforeEach, describe, expect, it } from 'vitest';

import { logsApi } from '../logs/api/logs.api';

import { communicationsApi } from './communications.api';

beforeEach(() => {
  window.localStorage.clear();
});

describe('the service surface', () => {
  it('exposes no verb that edits or deletes an access-log entry', () => {
    // Asserted as an exact key set, following ADM-07. The access log is the
    // record of who read private messages; a service that can rewrite it is
    // not an audit trail, and "we just won't call it" is not a guarantee.
    expect(Object.keys(communicationsApi).sort()).toEqual([
      'closeAccess',
      'list',
      'openAccess',
      'resolveFlag',
      'setFlagStatus',
    ]);
  });
});

describe('openAccess', () => {
  it('appends exactly one entry per gated read', async () => {
    const before = await communicationsApi.list();

    await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });
    const after = await communicationsApi.list();

    expect(after.accessLog.length).toBe(before.accessLog.length + 1);
  });

  it('returns the entry whose id is the banner reference', async () => {
    const entry = await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'legal-request',
      reason: 'Documented request from the compliance team',
      actor: 'Dr. Amelia Chen',
    });

    const document = await communicationsApi.list();
    const logged = document.accessLog.find((row) => row.id === entry.id);

    expect(logged).toBeDefined();
    expect(logged?.outcome).toBeNull();
    expect(logged?.closedAt).toBeNull();
  });

  it('writes a log event under the same id as the access entry', async () => {
    const entry = await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'legal-request',
      reason: 'Documented request from the compliance team',
      actor: 'Dr. Amelia Chen',
    });

    const events = await logsApi.list({
      filters: {
        query: '',
        actorRole: 'all',
        // 'all', not '': `matchesFilters` treats only the literal 'all' as
        // "no actor filter" (see `EMPTY_FILTERS`) — an empty string still
        // requires an exact, unmatchable `event.actor === ''` and would
        // filter this row straight back out.
        actor: 'all',
        type: 'communication-content-accessed',
        severity: 'all',
        from: '',
        to: '',
        ip: '',
      },
      sort: 'newest',
      offset: 0,
      limit: 50,
    });

    // One identifier, not two. The ref an admin reads on screen is the row an
    // auditor finds in the log.
    expect(events.rows.some((row) => row.id === entry.id)).toBe(true);
  });

  it('refuses a reason under the floor rather than trusting the dialog', async () => {
    await expect(
      communicationsApi.openAccess({
        conversationId: 'cv-referral',
        category: 'safety-flag',
        reason: 'too short',
        actor: 'Dr. Amelia Chen',
      }),
    ).rejects.toThrow();
  });
});

describe('closeAccess', () => {
  it('closes an open entry as completed', async () => {
    const entry = await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });

    await communicationsApi.closeAccess({ id: entry.id, outcome: 'completed' });
    const document = await communicationsApi.list();

    expect(document.accessLog.find((row) => row.id === entry.id)?.outcome).toBe(
      'completed',
    );
  });

  it('records an interrupted session as incomplete', async () => {
    const entry = await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });

    await communicationsApi.closeAccess({ id: entry.id, outcome: 'incomplete' });
    const document = await communicationsApi.list();

    expect(document.accessLog.find((row) => row.id === entry.id)?.outcome).toBe(
      'incomplete',
    );
  });
});

describe('resolveFlag', () => {
  it('records the decision, the reason and who made it', async () => {
    const before = await communicationsApi.list();
    const [flag] = before.flags;
    if (flag === undefined) throw new Error('the seed must produce at least one flag');

    const after = await communicationsApi.resolveFlag({
      flagId: flag.id,
      resolution: 'dismissed',
      note: 'Patient was contacted by phone the same day.',
      decidedBy: 'Dr. Amelia Chen',
    });

    const resolved = after.flags.find((row) => row.id === flag.id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolution).toBe('dismissed');
    expect(resolved?.decidedBy).toBe('Dr. Amelia Chen');
  });

  it('refuses to resolve without a note', async () => {
    const before = await communicationsApi.list();
    const [flag] = before.flags;
    if (flag === undefined) throw new Error('the seed must produce at least one flag');

    await expect(
      communicationsApi.resolveFlag({
        flagId: flag.id,
        resolution: 'dismissed',
        note: '   ',
        decidedBy: 'Dr. Amelia Chen',
      }),
    ).rejects.toThrow();
  });
});

describe('the shared conversation store', () => {
  it('is never written by this service', async () => {
    const key = 'medora.messaging.v1';
    await communicationsApi.list();
    const snapshot = window.localStorage.getItem(key);

    await communicationsApi.openAccess({
      conversationId: 'cv-referral',
      category: 'quality-audit',
      reason: 'Sampling response times for the quarterly review',
      actor: 'Dr. Amelia Chen',
    });
    const [flag] = (await communicationsApi.list()).flags;
    if (flag === undefined) throw new Error('the seed must produce at least one flag');
    await communicationsApi.setFlagStatus({
      flagId: flag.id,
      status: 'under-review',
      decidedBy: 'Dr. Amelia Chen',
    });

    expect(window.localStorage.getItem(key)).toBe(snapshot);
  });
});
