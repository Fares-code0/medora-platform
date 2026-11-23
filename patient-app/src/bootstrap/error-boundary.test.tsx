import { type ReactNode } from 'react';

import { fireEvent } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { renderWithProviders } from '@/test/render';

import { ErrorBoundary } from './ErrorBoundary';

/**
 * The global render-crash boundary — checklist R-05, and the first gap
 * `docs/COVERAGE.md` §4 names: *"it is the screen a patient sees when
 * everything else has failed, and nothing has ever rendered it."*
 *
 * Four things are asserted, in the order they matter:
 *
 * 1. **Nothing the crash carried reaches the patient's screen.** A render
 *    crash inside a records screen throws with PHI in the message often
 *    enough that showing it is a disclosure (T-04). The fallback is fixed
 *    copy.
 * 2. **Nothing the crash carried reaches a log sink either**, beyond the
 *    developer-authored component stack.
 * 3. **The patient can get out.** A boundary with no working recovery is
 *    a white screen with better typography.
 * 4. **The emergency route survives the crash.** Whatever else has
 *    failed, the screen still says how to get urgent help (N-01).
 */

/** A child that throws on demand, so a real render error drives the tree. */
function Crasher({ throwing, message }: { throwing: () => boolean; message: string }) {
  if (throwing()) throw new Error(message);
  return <RNText testID="crasher-content">Appointments</RNText>;
}

/**
 * React logs a caught render error to `console.error` itself, on top of
 * whatever the boundary logs. Both are captured here rather than mocking
 * `logger`: the redaction the PHI assertions depend on lives *inside*
 * `logger`, and a mock of it would assert nothing about what actually
 * reaches a sink.
 */
function captureConsoleError() {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  return {
    /** The boundary's own line, or `undefined` if it never logged. */
    medoraCall: () =>
      spy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].startsWith('[medora] Render crash'),
      ),
  };
}

function renderBoundary(
  child: ReactNode,
  options: { mode?: 'light' | 'dark'; onReset?: () => void; locale?: 'en' | 'ar' } = {},
) {
  const { mode = 'light', onReset, locale = 'en' } = options;
  return renderWithProviders(
    <ErrorBoundary {...(onReset === undefined ? {} : { onReset })}>{child}</ErrorBoundary>,
    { mode, locale },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('when nothing has crashed', () => {
  it('renders its children and no fallback', () => {
    const { getByTestId, queryByTestId } = renderBoundary(
      <Crasher throwing={() => false} message="unused" />,
    );

    expect(getByTestId('crasher-content')).toBeTruthy();
    expect(queryByTestId('error-boundary-fallback')).toBeNull();
  });
});

describe('when a child throws during render', () => {
  it('replaces the tree with the fallback instead of unmounting to a white screen', () => {
    captureConsoleError();

    const { getByTestId, queryByTestId } = renderBoundary(
      <Crasher throwing={() => true} message="Cannot read properties of undefined" />,
    );

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(queryByTestId('crasher-content')).toBeNull();
  });

  it('never renders the thrown message, which can quote a PHI value (T-04)', () => {
    captureConsoleError();

    // The shape a real render crash takes inside a records screen: the
    // value that broke the render is interpolated into the message.
    const { queryByText } = renderBoundary(
      <Crasher throwing={() => true} message="Unknown severity for allergen Penicillin" />,
    );

    expect(queryByText(/Penicillin/)).toBeNull();
    expect(queryByText(/allergen/i)).toBeNull();
  });

  it('still tells the patient how to get urgent help (N-01)', () => {
    captureConsoleError();

    const { getByText } = renderBoundary(<Crasher throwing={() => true} message="boom" />);

    expect(getByText(/emergency number/i)).toBeTruthy();
  });

  it('says nothing the patient entered was sent, because that is the question they will have', () => {
    captureConsoleError();

    const { getByText } = renderBoundary(<Crasher throwing={() => true} message="boom" />);

    expect(getByText(/Nothing you entered was sent/i)).toBeTruthy();
  });

  it('renders the fallback in dark mode too — it is inside the ThemeProvider for that reason', () => {
    captureConsoleError();

    const { getByTestId } = renderBoundary(<Crasher throwing={() => true} message="boom" />, {
      mode: 'dark',
    });

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
  });
});

describe('what the crash puts in the log (T-04, W-04)', () => {
  it('logs the component stack, which is developer-authored file and component names', () => {
    const console = captureConsoleError();

    renderBoundary(<Crasher throwing={() => true} message="boom" />);

    const call = console.medoraCall();
    expect(call).toBeDefined();
    const context = call?.[1] as Record<string, unknown>;
    expect(typeof context.componentStack).toBe('string');
    // File and component names this repository wrote — enough to find
    // the render that threw, and carrying nothing about the patient.
    expect(context.componentStack).toContain('ErrorBoundary.tsx');
    expect(context.componentStack).toContain('error-boundary.test.tsx');
  });

  it("redacts the thrown message: the logger's deny-list covers any key containing 'message'", () => {
    const console = captureConsoleError();

    renderBoundary(<Crasher throwing={() => true} message="Penicillin 500mg" />);

    const context = console.medoraCall()?.[1] as Record<string, unknown>;
    // This is the behaviour, not an aspiration: `errorMessage` normalises
    // to `errormessage`, which contains `message`, so `redact()` replaces
    // it before the line reaches a sink. Locked in deliberately — a
    // render crash carries whatever the thrower interpolated, and the
    // safe side of that is the redacted one. Widening it is an owner
    // decision, and this test is where it would have to be argued.
    expect(context.errorMessage).toBe('[redacted]');
    expect(JSON.stringify(context)).not.toContain('Penicillin');
  });

  it('logs nothing else — not the props, not the state, not the error cause', () => {
    const console = captureConsoleError();

    renderBoundary(<Crasher throwing={() => true} message="boom" />);

    const context = console.medoraCall()?.[1] as Record<string, unknown>;
    expect(Object.keys(context).sort()).toEqual(['componentStack', 'errorMessage']);
  });

  it('survives a React build that supplies no component stack', () => {
    const console = captureConsoleError();
    const boundary = new ErrorBoundary({ children: null });

    boundary.componentDidCatch(new Error('boom'), { componentStack: null });

    const context = console.medoraCall()?.[1] as Record<string, unknown>;
    expect(context.componentStack).toBe('(unavailable)');
  });
});

describe('recovery (R-05 — "with recovery" is the half that is easy to skip)', () => {
  it('re-renders the children when the cause has gone', () => {
    captureConsoleError();
    let throwing = true;

    const { getByTestId, queryByTestId } = renderBoundary(
      <Crasher throwing={() => throwing} message="boom" />,
      {
        onReset: () => {
          throwing = false;
        },
      },
    );

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
    fireEvent.press(getByTestId('error-boundary-retry'));

    expect(queryByTestId('error-boundary-fallback')).toBeNull();
    expect(getByTestId('crasher-content')).toBeTruthy();
  });

  it('shows the fallback again rather than looping when the cause is still there', () => {
    captureConsoleError();

    const { getByTestId } = renderBoundary(<Crasher throwing={() => true} message="boom" />);

    fireEvent.press(getByTestId('error-boundary-retry'));

    expect(getByTestId('error-boundary-fallback')).toBeTruthy();
  });
});

describe('the fallback under a screen reader (S-02, S-07)', () => {
  it('announces the whole message as one live region', () => {
    captureConsoleError();

    const { getByTestId } = renderBoundary(<Crasher throwing={() => true} message="boom" />);

    const message = getByTestId('error-boundary-message');
    expect(message.props.accessible).toBe(true);
    expect(message.props.accessibilityLiveRegion).toBe('polite');
    expect(message.props.accessibilityLabel).toMatch(/ran into a problem/i);
    expect(message.props.accessibilityLabel).toMatch(/emergency number/i);
  });

  it('keeps Try again focusable in its own right, outside the grouped message', () => {
    captureConsoleError();

    const { getByTestId } = renderBoundary(<Crasher throwing={() => true} message="boom" />);

    const retry = getByTestId('error-boundary-retry');
    expect(retry.props.accessibilityRole).toBe('button');
    expect(retry.props.accessibilityLabel).toBe('Try again');
  });
});

/**
 * The crash screen in Arabic — W-10 translation approval, 2026-11-23.
 *
 * It reads the provider's locale when there is one and the stored
 * preference when there is not (`useOptionalT`), so it still renders with
 * no provider above it. Its body is an urgent-help line, and the Arabic
 * of it awaits the clinical reviewer (docs/SIGNOFF.md).
 */
describe('the fallback in Arabic', () => {
  it('says the same two sentences in Arabic, and Try again in Arabic', () => {
    captureConsoleError();

    const { getByTestId, getByText, queryByText } = renderBoundary(
      <Crasher throwing={() => true} message="boom" />,
      { locale: 'ar' },
    );

    expect(getByText('واجه ميدورا مشكلة')).toBeTruthy();
    expect(getByTestId('error-boundary-message').props.accessibilityLabel).toMatch(
      /رقم الطوارئ المحلي/,
    );
    expect(getByTestId('error-boundary-retry').props.accessibilityLabel).toBe('حاول مرة أخرى');
    expect(queryByText(/ran into a problem/i)).toBeNull();
  });

  it('keeps the English fallback word for word', () => {
    captureConsoleError();

    const { getByText } = renderBoundary(<Crasher throwing={() => true} message="boom" />);

    expect(getByText('Medora ran into a problem')).toBeTruthy();
    expect(
      getByText(
        'This screen stopped working. Nothing you entered was sent. If you need urgent help, call your local emergency number.',
      ),
    ).toBeTruthy();
    expect(getByText('Try again')).toBeTruthy();
  });
});
