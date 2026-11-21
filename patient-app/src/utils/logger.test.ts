import { addLogSink, clearLogSinks, logger, redact, type LogRecord } from '@/utils/logger';

/**
 * The redacting logger — checklist T-04.
 *
 * `security.test.ts` asserts `redact()`'s deny-list, which is the half
 * that stops a disclosure. This is the other half: the plumbing that
 * makes the deny-list unavoidable.
 *
 * Two properties matter and neither is about redaction.
 *
 * **A sink is handed the redacted payload, never the caller's object.**
 * That is why crash reporting registers here rather than on `console`
 * (W-04) — a reporter wired to `console` would see the arguments before
 * `redact()` ran, which is the one bypass this module exists to prevent
 * in the consumer that most needs it.
 *
 * **A sink that throws does not take the caller down.** The caller is
 * usually already on an error path, and a crash reporter that crashes the
 * app it reports on is worse than no reporter.
 */

const spies: jest.SpyInstance[] = [];

function silence(): Record<string, jest.SpyInstance> {
  const made = {
    log: jest.spyOn(console, 'log').mockImplementation(() => {}),
    info: jest.spyOn(console, 'info').mockImplementation(() => {}),
    warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
    error: jest.spyOn(console, 'error').mockImplementation(() => {}),
  };
  spies.push(...Object.values(made));
  return made;
}

function collect(): LogRecord[] {
  const records: LogRecord[] = [];
  addLogSink((record) => records.push(record));
  return records;
}

afterEach(() => {
  clearLogSinks();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe('each level reaches its own console method', () => {
  it('routes info, warn and error', () => {
    const consoles = silence();

    logger.info('opened');
    logger.warn('slow');
    logger.error('broke');

    expect(consoles['info']).toHaveBeenCalledWith('[medora] opened', '');
    expect(consoles['warn']).toHaveBeenCalledWith('[medora] slow', '');
    expect(consoles['error']).toHaveBeenCalledWith('[medora] broke', '');
  });

  it('prefixes every line, so a device log can be filtered to this app', () => {
    const consoles = silence();

    logger.info('anything');

    expect(String(consoles['info']?.mock.calls[0]?.[0])).toMatch(/^\[medora] /);
  });

  it('passes an empty string rather than undefined when there is no context', () => {
    // `console.info(line, undefined)` prints the word "undefined" on a
    // device, which is noise in every line that carries no context.
    const consoles = silence();

    logger.info('no context');

    expect(consoles['info']).toHaveBeenCalledWith('[medora] no context', '');
  });
});

describe('what a sink is given', () => {
  it("receives the redacted context, never the caller's object", () => {
    silence();
    const records = collect();
    const context = { patientName: 'Fatima Al-Sayed', appointmentId: 'APT-1' };

    logger.info('Rendered', context);

    expect(records[0]?.context).toEqual({
      patientName: '[redacted]',
      appointmentId: 'APT-1',
    });
    // And the caller's own object is untouched — redaction is a copy,
    // not a mutation, so a screen does not lose the data it is rendering.
    expect(context.patientName).toBe('Fatima Al-Sayed');
  });

  it('receives the level and the developer-authored message', () => {
    silence();
    const records = collect();

    logger.warn('Lab result withheld', { orderId: 'LAB-7' });

    expect(records[0]).toEqual({
      level: 'warn',
      message: 'Lab result withheld',
      context: { orderId: 'LAB-7' },
    });
  });

  it('receives undefined context when the caller passed none', () => {
    silence();
    const records = collect();

    logger.info('bare');

    expect(records[0]?.context).toBeUndefined();
  });

  it('reaches every registered sink', () => {
    silence();
    const first = collect();
    const second = collect();

    logger.error('once');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('stops at a removed sink', () => {
    silence();
    const records: LogRecord[] = [];
    const remove = addLogSink((record) => records.push(record));
    remove();

    logger.error('after removal');

    expect(records).toEqual([]);
  });

  it('survives a sink that throws, and still reaches the others', () => {
    silence();
    addLogSink(() => {
      throw new Error('the reporter is down');
    });
    const records = collect();

    expect(() => logger.error('boom')).not.toThrow();
    expect(records).toHaveLength(1);
  });
});

describe('debug lines and the development build (T-04)', () => {
  /**
   * `write()` drops a `debug` line entirely outside development, and the
   * reason is in its own comment: a breadcrumb trail that exists only in
   * development is worse than none, because it reads as complete. The
   * consequence a test has to hold is that it does not reach a **sink**
   * either — a crash reporter that received debug breadcrumbs in a
   * release build would be receiving them from a code path nobody
   * reviews for PHI.
   */
  const dev = globalThis as { __DEV__?: boolean };
  const original = dev.__DEV__;

  afterEach(() => {
    dev.__DEV__ = original;
  });

  it('writes a debug line in development, console and sink alike', () => {
    dev.__DEV__ = true;
    const consoles = silence();
    const records = collect();

    logger.debug('booting', { email: 'sara@example.com' });

    expect(consoles['log']).toHaveBeenCalledWith('[medora] booting', {
      email: '[redacted]',
    });
    expect(records).toHaveLength(1);
  });

  it('drops it entirely outside development — console and sink', () => {
    dev.__DEV__ = false;
    const consoles = silence();
    const records = collect();

    logger.debug('booting');

    expect(consoles['log']).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it('keeps every other level outside development', () => {
    // Only `debug` is gated. A warning that vanished in a release build
    // would be the opposite mistake.
    dev.__DEV__ = false;
    silence();
    const records = collect();

    logger.info('opened');
    logger.warn('slow');
    logger.error('broke');

    expect(records.map((record) => record.level)).toEqual(['info', 'warn', 'error']);
  });
});

describe('redact stops descending', () => {
  it('replaces anything deeper than four levels rather than walking it', () => {
    // Not a performance guard. A structure this deep in a log line is
    // something nobody wrote deliberately — a serialised response, a
    // cyclic-ish object graph — and the safe reading of "I do not know
    // what this is" is to redact it rather than to print it.
    const deep = { a: { b: { c: { d: { email: 'sara@example.com' } } } } };

    const copy = redact(deep) as { a: { b: { c: { d: unknown } } } };

    // The boundary, stated exactly: `a` `b` `c` are walked, and the
    // fourth level down is replaced whole rather than descended into —
    // so the `email` beneath it is never reached, let alone matched
    // against the deny-list.
    expect(copy.a.b.c.d).toBe('[redacted]');
    expect(JSON.stringify(copy)).not.toContain('sara@example.com');
  });

  it('applies the same cutoff inside an array', () => {
    const deep = { a: [{ b: [{ c: [{ d: 'value' }] }] }] };

    expect(JSON.stringify(redact(deep))).toContain('[redacted]');
  });
});

describe('redact is a copy', () => {
  it('leaves the original object alone', () => {
    const original = { email: 'sara@example.com', nested: { dob: '1984-03-11' } };

    const copy = redact(original) as { email: string; nested: { dob: string } };

    expect(copy.email).toBe('[redacted]');
    expect(original.email).toBe('sara@example.com');
    expect(original.nested.dob).toBe('1984-03-11');
  });
});
