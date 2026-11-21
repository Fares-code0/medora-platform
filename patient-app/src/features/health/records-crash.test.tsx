import { useEffect } from 'react';

import { Text } from 'react-native';

import { ErrorBoundary } from '@/bootstrap/ErrorBoundary';
import { renderWithProviders } from '@/test/render';
import { clearLogSinks, logger } from '@/utils/logger';
import { installCrashReporting, resetMonitoring, type CrashReport } from '@/utils/monitoring';

/**
 * W-04's acceptance criterion, tested literally: *a deliberate crash on a
 * records screen produces a report containing no PHI.*
 *
 * `monitoring.test.ts` proves each part of the pipeline in isolation.
 * This one proves the parts are wired together in the order that matters
 * — a crash inside a component rendering clinical data, caught by the
 * real `ErrorBoundary`, delivered to a real sink — because every unit in
 * that chain can be correct while the chain leaks. The specific way it
 * would leak is a boundary that passes the `Error` straight to a
 * provider SDK, which is the one line this test would fail on.
 *
 * The crash is thrown the way records crashes actually happen: a render
 * that interpolates the row it could not handle into its own message.
 */

/** Values taken from the health fixtures, so this is the real leak. */
const PHI = ['Penicillin', 'Amoxicillin', 'Hypertension', 'Fatima Al-Sayed'];

function ExplodingAllergyRow(): never {
  throw new Error(`Unknown severity "critical" for allergen Penicillin (Fatima Al-Sayed)`);
}

/**
 * The section, in the two states a records screen actually goes through:
 * it renders and logs what it rendered, and then a later render throws.
 *
 * Mounting it already-broken would produce a report with an empty
 * breadcrumb trail — a render that throws never commits, so its effects
 * never run — and would prove nothing about whether the trail is
 * redacted. The order below is the one a patient hits: the list came
 * back, it drew, and the next row was one the code could not handle.
 */
function RecordsSection({ exploding }: { readonly exploding: boolean }) {
  useEffect(() => {
    logger.info('Rendered allergy list', {
      allergen: 'Penicillin',
      medicationName: 'Amoxicillin',
      conditionName: 'Hypertension',
      count: 3,
    });
  }, []);

  return (
    <>
      <Text>Allergies</Text>
      {exploding ? <ExplodingAllergyRow /> : null}
    </>
  );
}

/** Mounts the section, then breaks it. Returns the render result. */
function crashTheRecordsScreen() {
  const result = renderWithProviders(
    <ErrorBoundary>
      <RecordsSection exploding={false} />
    </ErrorBoundary>,
  );
  result.rerender(
    <ErrorBoundary>
      <RecordsSection exploding />
    </ErrorBoundary>,
  );
  return result;
}

describe('a deliberate crash on a records screen (W-04)', () => {
  let reports: CrashReport[];

  beforeEach(() => {
    reports = [];
    resetMonitoring();
    clearLogSinks();
    installCrashReporting({
      sinks: [
        (report) => {
          reports.push(report);
        },
      ],
    });
    // React logs the caught error itself, through `console.error`, with
    // the original message. That is React's own development output on a
    // developer's machine, not something this app sends anywhere, and
    // silencing it keeps the suite's output readable.
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    resetMonitoring();
    clearLogSinks();
    jest.restoreAllMocks();
  });

  it('recovers into the fallback rather than a white screen', () => {
    const { getByTestId } = crashTheRecordsScreen();

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
  });

  it('produces exactly one report', () => {
    crashTheRecordsScreen();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.kind).toBe('render');
    expect(reports[0]?.fatal).toBe(false);
  });

  it('contains no PHI anywhere in the payload', () => {
    crashTheRecordsScreen();

    const serialised = JSON.stringify(reports[0]);
    for (const secret of PHI) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('still says enough to find the render that threw', () => {
    crashTheRecordsScreen();

    const report = reports[0];
    expect(report?.name).toBe('Error');
    // React gives the component path; it is developer-authored names.
    expect(report?.componentStack).toContain('ExplodingAllergyRow');
    // And the breadcrumb that preceded it, with its clinical fields gone
    // but its shape intact.
    expect(report?.breadcrumbs).toContainEqual({
      level: 'info',
      message: 'Rendered allergy list',
      context: {
        allergen: '[redacted]',
        medicationName: '[redacted]',
        conditionName: '[redacted]',
        count: 3,
      },
    });
  });
});
