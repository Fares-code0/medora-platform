import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FeatureErrorBoundary } from './FeatureErrorBoundary';

/**
 * Found by injecting a render crash into `/doctor/reports` and opening it.
 *
 * The router's single top-level `errorElement` caught it — no white screen,
 * which is the important half and was already true. What it also did was take
 * the sidebar, the navbar, the breadcrumb and the bell with it, leaving one
 * link back to the dashboard as the only way onward. A crash in one feature is
 * not a reason to remove the navigation from the other twelve.
 */

function Boom({ throws }: { throws: boolean }): React.JSX.Element {
  if (throws) throw new Error('injected render crash');
  return <p>the feature</p>;
}

// React logs a caught error to the console; the boundary re-logs it on
// purpose. Neither is a test failure, and both would otherwise bury the run.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  consoleError.mockRestore();
});

describe('FeatureErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws={false} />
      </FeatureErrorBoundary>,
    );

    expect(screen.getByText('the feature')).toBeInTheDocument();
  });

  it('catches a crash and titles the failure, rather than blanking', () => {
    render(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws />
      </FeatureErrorBoundary>,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: "This page couldn't be loaded" }),
    ).toBeInTheDocument();
  });

  it('says the rest of the app still works, because it does', () => {
    // The copy is load-bearing. The router's full-page version had to tell the
    // user to go back to the dashboard; this one is rendered with the whole
    // menu still on screen, and saying so is what makes the menu worth looking
    // at.
    render(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws />
      </FeatureErrorBoundary>,
    );

    expect(screen.getByText(/rest of Medora is unaffected/i)).toBeInTheDocument();
  });

  it('clears the error when the route changes', () => {
    // The defect this prevents: an error boundary latches, so without a reset
    // a user who crashed one page and navigated away would see the error under
    // working chrome — which reads as "every page is broken".
    const { rerender } = render(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws />
      </FeatureErrorBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();

    rerender(
      <FeatureErrorBoundary resetKey="/doctor/patients">
        <Boom throws={false} />
      </FeatureErrorBoundary>,
    );

    expect(screen.getByText('the feature')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('stays in the error state while the route is unchanged', () => {
    const { rerender } = render(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws />
      </FeatureErrorBoundary>,
    );

    rerender(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws />
      </FeatureErrorBoundary>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('offers a retry that re-renders the feature', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws />
      </FeatureErrorBoundary>,
    );

    // A transient failure — the retry is for the case where re-rendering
    // succeeds, which is why it exists alongside the navigation.
    rerender(
      <FeatureErrorBoundary resetKey="/doctor/reports">
        <Boom throws={false} />
      </FeatureErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('the feature')).toBeInTheDocument();
  });
});
