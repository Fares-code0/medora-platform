import { describe, expect, it } from 'vitest';

import {
  type AuditRetentionApplication,
  EXIT_NO_WINDOW,
  runAuditRetentionCommand,
} from './audit-retention.command';

function fakeApplication(retentionDays: () => Promise<number>) {
  const calls = { sweep: [] as number[], closed: 0 };
  const app: AuditRetentionApplication = {
    retentionEntitled: () => Promise.resolve(true),
    retentionDays,
    sweep: (_now, days) => {
      calls.sweep.push(days);
      return Promise.resolve({ created: [], dropped: [], deferred: [], retentionDays: days } as never);
    },
    close: () => {
      calls.closed += 1;
      return Promise.resolve();
    },
  };
  return { app, calls };
}

function output() {
  const lines = { log: [] as string[], error: [] as string[] };
  return { lines, out: { log: (l: string) => lines.log.push(l), error: (l: string) => lines.error.push(l) } };
}

describe('runAuditRetentionCommand — the retention window', () => {
  it('refuses, without sweeping, when the administrator window cannot be read', async () => {
    const { app, calls } = fakeApplication(() => Promise.reject(new Error('settings unreachable')));
    const { lines, out } = output();
    expect(await runAuditRetentionCommand('postgresql://maintenance', () => Promise.resolve(app), out)).toBe(
      EXIT_NO_WINDOW,
    );
    expect(calls.sweep).toEqual([]);
    expect(calls.closed).toBe(1);
    expect(lines.error.join('\n')).toContain('settings unreachable');
  });

  it('sweeps with exactly the window it read', async () => {
    const { app, calls } = fakeApplication(() => Promise.resolve(400));
    const { out } = output();
    expect(await runAuditRetentionCommand('postgresql://maintenance', () => Promise.resolve(app), out)).toBe(0);
    expect(calls.sweep).toEqual([400]);
    expect(calls.closed).toBe(1);
  });
});
