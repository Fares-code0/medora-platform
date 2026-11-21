import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installInterruptHandlers } from './reencrypt-signals';

/** SIGTERM / SIGINT handling of `npm run crypto:reencrypt` (review finding R5). */
describe('installInterruptHandlers', () => {
  let source: EventEmitter;
  let controller: AbortController;
  let lines: string[];
  let exits: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    source = new EventEmitter();
    controller = new AbortController();
    lines = [];
    exits = [];
    installInterruptHandlers(
      source,
      controller,
      (line) => lines.push(line),
      (code) => exits.push(code),
      1_000,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('the first SIGTERM asks the run to stop, with the signal as the reason, and does not exit', () => {
    source.emit('SIGTERM');
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('SIGTERM');
    expect(exits).toEqual([]);
    expect(lines.join('\n')).toContain('stopping before the next write and recording the outcome');
  });

  it('a second signal exits at once with 128 + the signal number', () => {
    source.emit('SIGINT');
    source.emit('SIGINT');
    expect(exits).toEqual([130]);
    expect(lines.join('\n')).toContain('keeps only its "started" audit record');
  });

  it('exits when the run does not stop within the grace period', () => {
    source.emit('SIGTERM');
    vi.advanceTimersByTime(999);
    expect(exits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(exits).toEqual([143]);
  });
});
