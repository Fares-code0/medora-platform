import fs from 'node:fs';
import path from 'node:path';

import { CURRENT_APP_VERSION } from '@/features/app-version/version';
import { clearLogSinks, logger } from '@/utils/logger';
import {
  installCrashReporting,
  registerCrashSink,
  reportCrash,
  resetMonitoring,
  stackFrames,
  toReport,
  type CrashReport,
} from '@/utils/monitoring';

/**
 * W-04 — crash reporting, and the one guarantee it exists to make.
 *
 * The acceptance criterion is negative: a report must not contain PHI.
 * A negative is only testable against a concrete leak, so every
 * assertion below plants a specific piece of patient data in the place a
 * real crash would put it — the message, the stack header, a log context,
 * a caller's own context object — and then asserts on the *whole*
 * serialised report rather than on the field it was planted in. A test
 * that only checked the field it planted would pass a reporter that
 * copied the message into a second key.
 */

/** The things a records screen would leak, if the pipeline let it. */
const PHI = ['Penicillin', 'Amoxicillin 500mg', 'PT-4417', 'Fatima Al-Sayed', '1984-03-11'];

function expectNoPhi(report: CrashReport): void {
  const serialised = JSON.stringify(report);
  for (const secret of PHI) {
    expect(serialised).not.toContain(secret);
  }
}

/** A stack in the shape Hermes and V8 both produce. */
function withStack(error: Error, frames: readonly string[]): Error {
  error.stack = `${error.name}: ${error.message}\n${frames.map((f) => `    ${f}`).join('\n')}`;
  return error;
}

beforeEach(() => {
  resetMonitoring();
  clearLogSinks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  resetMonitoring();
  clearLogSinks();
  jest.restoreAllMocks();
});

describe('the message never leaves (W-04)', () => {
  it('omits the error message entirely, rather than redacting it', () => {
    const report = toReport(new Error('Unknown severity for allergen Penicillin'), {
      kind: 'render',
    });

    expect(report.name).toBe('Error');
    expect(Object.keys(report)).not.toContain('message');
    expectNoPhi(report);
  });

  it('strips the message out of the stack header', () => {
    const error = withStack(new TypeError("Cannot read property 'value' of Amoxicillin 500mg"), [
      'at LabResultRow (src/features/health/components/LabResultRow.tsx:31:9)',
      'at renderWithHooks (node_modules/react/cjs/react.js:11:2)',
    ]);

    const report = toReport(error, { kind: 'render' });

    expect(report.frames).toEqual([
      'at LabResultRow (src/features/health/components/LabResultRow.tsx:31:9)',
      'at renderWithHooks (node_modules/react/cjs/react.js:11:2)',
    ]);
    expectNoPhi(report);
  });

  it('keeps nothing from a message that contains its own newlines', () => {
    // The failure this guards: removing the header by finding the first
    // newline would leave the second line of a multi-line message in
    // place, and the second line is where an interpolated value lands.
    const error = withStack(new Error('Validation failed:\nallergen = Penicillin'), [
      'at parseAllergy (src/features/health/service.ts:14:3)',
    ]);

    expect(stackFrames(error)).toEqual(['at parseAllergy (src/features/health/service.ts:14:3)']);
    expectNoPhi(toReport(error, { kind: 'render' }));
  });

  it('does not mistake a message line for a stack frame', () => {
    // A frame requires a trailing `:line:col`. An email or an address in
    // a leftover message line has neither, so neither survives the
    // filter even when the header removal could not match.
    const error = new Error('boom');
    error.stack = [
      'SomeOtherEngine wrote this header differently',
      'patient@example.com wrote in',
      '    at HealthRecordsScreen (src/features/health/screens/HealthRecordsScreen.tsx:8:1)',
    ].join('\n');

    expect(stackFrames(error)).toEqual([
      'at HealthRecordsScreen (src/features/health/screens/HealthRecordsScreen.tsx:8:1)',
    ]);
  });

  it('reports a thrown non-Error without its text', () => {
    const report = toReport('Fatima Al-Sayed has no chart', { kind: 'unhandled' });

    expect(report.name).toBe('NonError');
    expect(report.frames).toEqual([]);
    expect(report.fatal).toBe(true);
    expectNoPhi(report);
  });

  it('has no stack when the engine gave none', () => {
    const error = new Error('boom');
    delete (error as { stack?: string }).stack;

    expect(stackFrames(error)).toEqual([]);
  });
});

describe('context and breadcrumbs are redacted by key', () => {
  it('redacts a caller-supplied context exactly as a log line is', () => {
    const report = toReport(new Error('boom'), {
      kind: 'handled',
      context: { patientName: 'Fatima Al-Sayed', appointmentId: 'APT-2001' },
    });

    expect(report.context).toEqual({
      patientName: '[redacted]',
      appointmentId: 'APT-2001',
    });
    expectNoPhi(report);
  });

  it('collects log lines as breadcrumbs, already redacted', () => {
    installCrashReporting({ sinks: [] });

    logger.info('Opened health records', { patientName: 'Fatima Al-Sayed' });
    logger.warn('Lab result withheld', { labResultValue: 12.4, orderId: 'LAB-7' });

    const report = reportCrash(new Error('boom'), { kind: 'render' });

    expect(report.breadcrumbs).toEqual([
      { level: 'info', message: 'Opened health records', context: { patientName: '[redacted]' } },
      {
        level: 'warn',
        message: 'Lab result withheld',
        context: { labResultValue: '[redacted]', orderId: 'LAB-7' },
      },
    ]);
    expectNoPhi(report);
  });

  it('keeps the trail bounded', () => {
    installCrashReporting({ sinks: [] });
    for (let i = 0; i < 40; i += 1) logger.info(`step ${i}`);

    const report = reportCrash(new Error('boom'), { kind: 'render' });

    expect(report.breadcrumbs).toHaveLength(20);
    expect(report.breadcrumbs[0]?.message).toBe('step 20');
    expect(report.breadcrumbs.at(-1)?.message).toBe('step 39');
  });

  it('does not collect the breadcrumbs a sink writes while delivering', () => {
    // Without the re-entrancy guard, a sink that logs an error turns one
    // crash into a trail that grows on every subsequent report.
    installCrashReporting({ sinks: [() => logger.error('sink wrote this')] });

    reportCrash(new Error('first'), { kind: 'render' });
    const second = reportCrash(new Error('second'), { kind: 'render' });

    expect(second.breadcrumbs).toEqual([]);
  });
});

describe('delivery', () => {
  it('hands every sink the same report', () => {
    const a = jest.fn();
    const b = jest.fn();
    registerCrashSink(a);
    registerCrashSink(b);

    const report = reportCrash(new Error('boom'), { kind: 'handled' });

    expect(a).toHaveBeenCalledWith(report);
    expect(b).toHaveBeenCalledWith(report);
  });

  it('is a no-op with no sink registered, rather than inventing a destination', () => {
    expect(() => reportCrash(new Error('boom'), { kind: 'handled' })).not.toThrow();
  });

  it('survives a sink that throws, and still reaches the others', () => {
    const good = jest.fn();
    registerCrashSink(() => {
      throw new Error('the reporter is down');
    });
    registerCrashSink(good);

    expect(() => reportCrash(new Error('boom'), { kind: 'handled' })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a removed sink', () => {
    const sink = jest.fn();
    const remove = registerCrashSink(sink);
    remove();

    reportCrash(new Error('boom'), { kind: 'handled' });

    expect(sink).not.toHaveBeenCalled();
  });

  it('stamps the build the report came from', () => {
    const report = toReport(new Error('boom'), { kind: 'render' });

    expect(report.appVersion).toBe(CURRENT_APP_VERSION);
    expect(report.appEnv).toBe('development');
  });
});

describe('the engine handler is chained, not replaced', () => {
  type Handler = (error: unknown, isFatal?: boolean) => void;

  it('reports an unhandled error and then lets the previous handler run', () => {
    const previous = jest.fn();
    let current: Handler = previous;
    const holder = globalThis as { ErrorUtils?: unknown };
    holder.ErrorUtils = {
      getGlobalHandler: () => current,
      setGlobalHandler: (h: Handler) => {
        current = h;
      },
    };

    const sink = jest.fn();
    const uninstall = installCrashReporting({ sinks: [sink] });

    const error = new Error('Amoxicillin 500mg');
    current(error, true);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(error, true);
    const report = sink.mock.calls[0]?.[0] as CrashReport;
    expect(report.kind).toBe('unhandled');
    expect(report.fatal).toBe(true);
    expectNoPhi(report);

    uninstall();
    expect(current).toBe(previous);
    delete holder.ErrorUtils;
  });

  it('installs cleanly where there is no ErrorUtils at all', () => {
    const holder = globalThis as { ErrorUtils?: unknown };
    const saved = holder.ErrorUtils;
    delete holder.ErrorUtils;

    expect(() => installCrashReporting({ sinks: [] })()).not.toThrow();

    if (saved !== undefined) holder.ErrorUtils = saved;
  });
});

describe('it is installed before the first render', () => {
  // A crash inside the provider stack's own mount is the crash most
  // worth reporting, and an effect-based install would miss it. Asserted
  // on the source because `index.ts` is the entry point Metro runs, not
  // a module a test can import without registering a root component.
  const entry = fs.readFileSync(path.join(__dirname, '..', '..', 'index.ts'), 'utf8');

  it('calls installCrashReporting from index.ts', () => {
    expect(entry).toContain('installCrashReporting()');
  });

  it('calls it before registerRootComponent', () => {
    expect(entry.indexOf('installCrashReporting()')).toBeLessThan(
      entry.indexOf('registerRootComponent(App)'),
    );
  });
});
