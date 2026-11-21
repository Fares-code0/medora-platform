import { describe, expect, it, beforeEach, vi } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { administrationApi } from '../../api/administration.api';
import { EMPTY_FILTERS, PAGE_SIZE } from '../logs';

import { logsApi } from './logs.api';

/**
 * The service exists to make one stream out of trails four other modules
 * keep. The claims worth pinning: the aggregate really does span all five
 * §3.7 categories, `total` is a post-filter count rather than the page
 * length, an export writes its own event, and nothing here can change an
 * event.
 */

beforeEach(() => {
  window.localStorage.clear();
});

const ALL = { filters: EMPTY_FILTERS, sort: 'newest' as const, offset: 0, limit: PAGE_SIZE };

describe('aggregation', () => {
  it('covers all five §3.7 categories', async () => {
    const page = await logsApi.list({ ...ALL, limit: 5000 });
    const categories = new Set(page.rows.map((r) => r.category));

    expect([...categories].sort()).toEqual([
      'admin-activity',
      'authentication',
      'security',
      'system',
      'user-action',
    ]);
  });

  it('carries a real IP on doctor sign-ins and none on appointment transitions', async () => {
    const page = await logsApi.list({ ...ALL, limit: 5000 });

    expect(page.rows.some((r) => r.category === 'authentication' && r.ip !== null)).toBe(true);
    expect(page.rows.every((r) => r.category !== 'user-action' || r.ip === null)).toBe(true);
  });

  it('never puts a patient name in any rendered field', async () => {
    const page = await logsApi.list({ ...ALL, limit: 5000 });
    const names = MOCK_PATIENTS.map((p) => p.name);

    /*
     * Every string the UI renders, not just `target` and `summary`: the
     * drawer prints `actor` and every payload value verbatim, so a name in a
     * seeded `detail` would reach the screen with nothing standing in its way.
     */
    for (const row of page.rows) {
      const rendered = [row.target, row.summary, row.actor, ...Object.values(row.payload)].map(
        (value) => String(value),
      );
      for (const name of names) {
        for (const value of rendered) {
          expect(value).not.toContain(name);
        }
      }
    }
  });

  /*
   * The trap this service is shaped around. `administrationApi.getAuditEvents`
   * already folds the PHI access log into the audit feed, so an aggregate that
   * read *both* it and the raw PHI log would carry every reveal twice — once
   * as `phi:…` and once as `legacy:aud-phi-…`, two different ids that no
   * dedupe could pair up. Counting the reveals against the PHI log itself is
   * the only assertion that catches it.
   */
  it('counts a PHI reveal once, not once per feed that carries it', async () => {
    await administrationApi.phiAccess.record({
      actor: 'Marcus Reed',
      subjectId: 'PT-1004',
      subjectLabel: 'Queue ticket A-104',
      category: 'safety-investigation',
      reason: 'Reviewing a reported medication error.',
      durationMinutes: 15,
    });

    const revealed = await logsApi.list({
      ...ALL,
      limit: 5000,
      filters: { ...EMPTY_FILTERS, type: 'phi-revealed' },
    });
    const log = await administrationApi.phiAccess.list();

    expect(log).toHaveLength(1);
    expect(revealed.total).toBe(1);
  });
});

describe('pagination', () => {
  it('reports the post-filter total independently of the page size', async () => {
    const first = await logsApi.list({ ...ALL, limit: 10 });
    const second = await logsApi.list({ ...ALL, limit: 25 });

    expect(first.rows).toHaveLength(10);
    expect(second.rows).toHaveLength(25);
    expect(first.total).toBe(second.total);
    expect(first.total).toBeGreaterThan(25);
  });

  it('pages without repeating or skipping a row', async () => {
    const a = await logsApi.list({ ...ALL, offset: 0, limit: 10 });
    const b = await logsApi.list({ ...ALL, offset: 10, limit: 10 });
    const ids = new Set([...a.rows, ...b.rows].map((r) => r.id));

    expect(ids.size).toBe(20);
  });

  it('narrows total when a filter is applied', async () => {
    const all = await logsApi.list(ALL);
    const critical = await logsApi.list({
      ...ALL,
      filters: { ...EMPTY_FILTERS, severity: 'critical' },
    });

    expect(critical.total).toBeLessThan(all.total);
    expect(critical.rows.every((r) => r.severity === 'critical')).toBe(true);
  });

  /*
   * The seeded System corpus is index-driven rather than random precisely so
   * that paging is stable: two reads of the same page must be the same page,
   * or an investigator scrolling the log is reading a different log each time.
   */
  it('serves the same rows in the same order on a repeated read', async () => {
    const first = await logsApi.list({ ...ALL, offset: 20, limit: 10 });
    const again = await logsApi.list({ ...ALL, offset: 20, limit: 10 });

    expect(again.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
  });
});

describe('the actor filter’s options', () => {
  it('spans the whole log, not just the page the reader is on', async () => {
    // The actor filter matches exactly, so its options are a closed list. Read
    // off the page on screen it would offer only whoever acted most recently
    // — and an investigation that starts "what did this person do" would not
    // find the person.
    const actors = await logsApi.actors();
    const firstPage = await logsApi.list(ALL);
    const onPage = new Set(firstPage.rows.map((r) => r.actor));

    // Positive control: page one genuinely does not carry every actor, so the
    // difference between the two lists is a real one.
    expect(actors.length).toBeGreaterThan(onPage.size);
    expect([...onPage].every((actor) => actors.includes(actor))).toBe(true);
    // A closed list with a duplicate would render two identical options.
    expect(new Set(actors).size).toBe(actors.length);
  });
});

describe('export', () => {
  /*
   * The export runs for real, all the way to `utils/export`. jsdom implements
   * no navigation, so the anchor that hands the file over logs an
   * unimplemented-navigation error; this silences that one click and nothing
   * else, and `restoreMocks` puts the method back after each test.
   */
  beforeEach(() => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('appends its own event, so the export appears in the log it came from', async () => {
    const before = await logsApi.list({
      ...ALL,
      filters: { ...EMPTY_FILTERS, type: 'data-export' },
    });

    await logsApi.exportEvents('csv', EMPTY_FILTERS, 'Marcus Reed');

    const after = await logsApi.list({
      ...ALL,
      filters: { ...EMPTY_FILTERS, type: 'data-export' },
    });
    expect(after.total).toBe(before.total + 1);
  });

  /*
   * The trap this test exists to catch: `exportEvents` ignoring the filters it
   * was handed and writing out the whole aggregate instead. In a PHI-governed
   * app that is not a coverage gap, it is a silent over-disclosure — an
   * administrator who asked for a filtered slice would receive the entire
   * audit trail with nothing on screen saying so. `severity: 'critical'` is
   * confirmed non-vacuous first: `list()` must report fewer critical rows
   * than the unfiltered total, or this assertion would pass however the
   * export behaved.
   */
  it('exports exactly the filtered rows, not the whole aggregate', async () => {
    const filters = { ...EMPTY_FILTERS, severity: 'critical' as const };

    const listed = await logsApi.list({ ...ALL, filters });
    const all = await logsApi.list(ALL);
    expect(listed.total).toBeGreaterThan(0);
    expect(listed.total).toBeLessThan(all.total);

    const exported = await logsApi.exportEvents('csv', filters, 'Marcus Reed');

    expect(exported).toBe(listed.total);
  });

  /*
   * §3.7 wants the export logged, not merely counted: the row has to name who
   * ran it and how much left the building, or it cannot answer the question a
   * reviewer brings to it.
   */
  it('records the actor and the row count on the event it writes', async () => {
    const exported = await logsApi.exportEvents('json', EMPTY_FILTERS, 'Priya Nair');

    const page = await logsApi.list({
      ...ALL,
      limit: 5000,
      filters: { ...EMPTY_FILTERS, type: 'data-export', actor: 'Priya Nair' },
    });
    const row = page.rows[0];

    expect(row).toBeDefined();
    expect(row?.actor).toBe('Priya Nair');
    expect(row?.payload.rowCount).toBe(exported);
    expect(row?.payload.format).toBe('json');
  });
});

describe('saved views', () => {
  it('persists across a reload', async () => {
    await logsApi.createView('Critical 7d', { ...EMPTY_FILTERS, severity: 'critical' });

    const views = await logsApi.savedViews();
    expect(views.map((v) => v.name)).toContain('Critical 7d');
  });

  it('ships §3.7’s two seeded views', async () => {
    const views = await logsApi.savedViews();

    expect(views.map((v) => v.name)).toEqual(
      expect.arrayContaining(['Failed logins 7d', 'Admin PHI access']),
    );
  });

  it('removes only the view asked for', async () => {
    const created = await logsApi.createView('Doomed', { ...EMPTY_FILTERS, severity: 'warning' });
    const target = created.find((view) => view.name === 'Doomed');

    expect(target).toBeDefined();
    const remaining = await logsApi.deleteView(target?.id ?? '');

    expect(remaining.map((v) => v.name)).not.toContain('Doomed');
    expect(remaining.map((v) => v.name)).toContain('Failed logins 7d');
  });
});

describe('read-only', () => {
  it('exposes no way to change or remove an event', () => {
    // §3.7: logs are read-only for everyone including admins. Making that a
    // type error rather than a policy is the point — there is nothing to call.
    const surface = Object.keys(logsApi);

    expect(surface).not.toContain('update');
    expect(surface).not.toContain('remove');
    expect(surface).not.toContain('delete');
    expect(surface.filter((k) => /event/i.test(k) && k !== 'exportEvents')).toEqual([]);
  });
});
