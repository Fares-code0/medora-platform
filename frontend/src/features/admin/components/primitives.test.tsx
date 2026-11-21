import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Panel } from './primitives';

/**
 * Panel heading level — DS §3.4 "never skip levels".
 * Panels sit directly beneath the page h1 that SectionShell renders, so h2
 * is the default. h3/h4 are for panels nested under a further heading.
 */
describe('Panel', () => {
  it('renders its title as an h2 by default, directly beneath the page h1', () => {
    render(<Panel title="Clinic pulse">body</Panel>);

    expect(screen.getByRole('heading', { name: 'Clinic pulse', level: 2 })).toBeInTheDocument();
  });

  it('honors headingAs for panels nested under a further heading', () => {
    render(
      <Panel title="Clinic pulse" headingAs="h3">
        body
      </Panel>,
    );

    expect(screen.getByRole('heading', { name: 'Clinic pulse', level: 3 })).toBeInTheDocument();
  });
});
