import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteAnnouncer } from './RouteAnnouncer';

/**
 * The three behaviours that decide whether a route announcer works at all.
 * Each is a way the pattern is commonly got wrong, and each is invisible
 * without a screen reader — which is why they are asserted rather than
 * eyeballed.
 */

describe('RouteAnnouncer', () => {
  it('renders the live region before there is anything to announce', () => {
    // A region added to the DOM with its content already in place is not
    // reliably announced: the announcement is triggered by a mutation *inside*
    // an existing region. So the element must exist from the first render,
    // empty.
    render(<RouteAnnouncer title="Patients" />);

    const region = screen.getByTestId('route-announcer');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region.textContent).toBe('');
  });

  it('says nothing on first render, because the browser already announced the document', () => {
    render(<RouteAnnouncer title="Overview" />);

    expect(screen.getByTestId('route-announcer').textContent).toBe('');
  });

  it('announces the new page after a navigation', () => {
    const { rerender } = render(<RouteAnnouncer title="Overview" />);
    rerender(<RouteAnnouncer title="Patients" />);

    expect(screen.getByTestId('route-announcer').textContent).toBe('Patients');
  });

  it('stays quiet when the title has not changed', () => {
    // A re-render is not a navigation. Re-announcing on every render of the
    // shell would make the region chatter through unrelated state changes.
    const { rerender } = render(<RouteAnnouncer title="Overview" />);
    rerender(<RouteAnnouncer title="Patients" />);
    rerender(<RouteAnnouncer title="Patients" />);

    expect(screen.getByTestId('route-announcer').textContent).toBe('Patients');
  });

  it('is visually hidden, so it costs no layout', () => {
    render(<RouteAnnouncer title={null} />);

    expect(screen.getByTestId('route-announcer')).toHaveClass('sr-only');
  });

  it('clears rather than repeating when a route has no name', () => {
    // `null` is a route with no `handle.crumb`. Announcing the *previous*
    // page's name there would be worse than silence: it would say the reader
    // is somewhere they just left.
    const { rerender } = render(<RouteAnnouncer title="Overview" />);
    rerender(<RouteAnnouncer title="Patients" />);
    rerender(<RouteAnnouncer title={null} />);

    expect(screen.getByTestId('route-announcer').textContent).toBe('');
  });
});
