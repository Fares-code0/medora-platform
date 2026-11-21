import { describe, expect, it } from 'vitest';

import { JobRegistry } from './job-registry.service';
import { dailyAtUtc, everyMinutes } from './job-schedule';
import { DEFAULT_RETRY } from './retry-policy';
import { isRunnable, type BlockedJob, type RunnableJob } from './job.types';

const runnable = (name: string): RunnableJob => ({
  name,
  summary: 'a sweep',
  schedule: everyMinutes(5),
  retry: DEFAULT_RETRY,
  timeoutMs: 60_000,
  handler: () => Promise.resolve({ touched: 0 }),
});

const blocked = (name: string): BlockedJob => ({
  name,
  summary: 'a sweep with nothing behind it',
  schedule: dailyAtUtc(4, 0),
  blocked: { reason: 'nothing produces the artefact', unblockedBy: 'M99' },
});

/**
 * The registry (RM M30.1).
 *
 * > 🔒 Exit gate M30: all periodic behavior runs from the registry, none
 * > ad hoc.
 */
describe('JobRegistry', () => {
  it('rejects a duplicate name rather than merging', () => {
    // Two definitions under one name is a copy-paste that would run one
    // and silently hide the other.
    const registry = new JobRegistry();
    registry.register(runnable('a.b'));

    expect(() => {
      registry.register(runnable('a.b'));
    }).toThrow(/already registered/);
  });

  it('refuses a registration after boot', () => {
    // A late registration adds a schedule the boot log never printed
    // and the jobs screen was built without.
    const registry = new JobRegistry();
    registry.seal();

    expect(() => {
      registry.register(runnable('a.b'));
    }).toThrow(/registered after boot/);
    expect(registry.isSealed).toBe(true);
  });

  it('validates the schedule and the retry policy at registration', () => {
    const registry = new JobRegistry();

    expect(() => {
      registry.register({ ...runnable('a.b'), schedule: { kind: 'every', ms: 10 } });
    }).toThrow(/minimum is one minute/);
    expect(() => {
      registry.register({ ...runnable('a.c'), retry: { ...DEFAULT_RETRY, attempts: 0 } });
    }).toThrow(/at least one is required/);
    expect(() => {
      registry.register({ ...runnable('a.d'), timeoutMs: 10 });
    }).toThrow(/needs at least a second/);
  });

  it('validates a blocked job’s schedule too', () => {
    // A blocked job still declares a cadence, and it is still printed.
    const registry = new JobRegistry();

    expect(() => {
      registry.register({ ...blocked('a.b'), schedule: { kind: 'dailyAtUtc', hour: 99, minute: 0 } });
    }).toThrow(/invalid daily time/);
  });

  it('lists blocked and runnable together, name-ordered', () => {
    // `all()` is what the operator's screen reads: a blocked schedule
    // that did not appear would look like a schedule nobody wrote.
    const registry = new JobRegistry();
    registry.register(runnable('z.late'));
    registry.register(blocked('a.early'));

    expect(registry.all().map((job) => job.name)).toEqual(['a.early', 'z.late']);
    expect(registry.runnable().map((job) => job.name)).toEqual(['z.late']);
  });

  it('never hands a blocked job back as runnable', () => {
    // The type makes this impossible to get wrong at a call site; the
    // test is here because the lookup is the one place that narrows.
    const registry = new JobRegistry();
    registry.register(blocked('a.early'));

    expect(registry.find('a.early')).not.toBeNull();
    expect(registry.findRunnable('a.early')).toBeNull();
    expect(registry.findRunnable('nope')).toBeNull();
  });

  it('narrows on the handler, so a definition with both fails closed', () => {
    const both = { ...runnable('a.b'), blocked: blocked('a.b').blocked };
    const neither = { name: 'a.c', summary: '', schedule: everyMinutes(5) };

    expect(isRunnable(both)).toBe(true);
    expect(isRunnable(neither as unknown as RunnableJob)).toBe(false);
  });
});
