import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Collapsible } from './Collapsible';

function Harness({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      id="analytics"
      title="Analytics"
      caption="Practice pulse and appointment trend"
      summary="2 charts"
      open={open}
      onOpenChange={setOpen}
    >
      <a href="/doctor/reports">Inside link</a>
    </Collapsible>
  );
}

describe('Collapsible', () => {
  it('exposes its state through aria-expanded', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Analytics/ });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('points aria-controls at the panel it actually controls', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Analytics/ });

    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).toBeInTheDocument();
  });

  // The four discoverability requirements: a closed section must read as
  // closed, never as absent or broken.
  it('keeps title, caption and summary visible while closed', () => {
    render(<Harness />);

    expect(screen.getByText('Analytics')).toBeVisible();
    expect(screen.getByText('Practice pulse and appointment trend')).toBeVisible();
    expect(screen.getByText('2 charts')).toBeVisible();
  });

  it('keeps closed content mounted so opening is instant', () => {
    render(<Harness />);

    // Present in the DOM...
    expect(screen.getByText('Inside link')).toBeInTheDocument();
  });

  it('renders the title at the requested heading level', () => {
    render(<Harness />);

    // Regex, not an exact string: the heading wraps the trigger button, so
    // its accessible name is title + caption + summary concatenated.
    expect(screen.getByRole('heading', { level: 2, name: /Analytics/ })).toBeInTheDocument();
  });

  it('opens on click and reports the change once', async () => {
    const onOpenChange = vi.fn();
    render(
      <Collapsible id="activity" title="Activity" open={false} onOpenChange={onOpenChange}>
        <p>Body</p>
      </Collapsible>,
    );

    await userEvent.click(screen.getByRole('button', { name: /Activity/ }));

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('is operable from the keyboard', async () => {
    render(<Harness />);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /Analytics/ })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /Analytics/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('Collapsible under reduced motion', () => {
  /**
   * The panel must animate through a CSS transition, not a Framer prop.
   * globals.css collapses CSS transitions to 0.01ms for BOTH
   * `prefers-reduced-motion` and the app's own `html[data-reduce-motion='on']`
   * switch, whereas Framer's `reducedMotion: "always"` does not stop height
   * animations at all. Reimplementing this with `m.div` would silently break
   * DX-05, so the transition class is asserted here.
   *
   * Real focus containment is NOT asserted here: jsdom never loads the Tailwind
   * stylesheet, so `visibility: hidden` is never computed and a focus-order test
   * would pass or fail for reasons unrelated to this component. That behaviour
   * was verified in a browser and is recorded in FRONTEND_CHECKLIST §10.1.
   */
  it('animates through CSS and flips its state attribute', async () => {
    const { container } = render(<Harness />);
    const panel = container.querySelector('[data-collapsible-panel]');

    expect(panel?.className).toMatch(/transition-\[grid-template-rows/);

    expect(panel).toHaveAttribute('data-state', 'closed');
    expect(panel).toHaveClass('invisible');

    await userEvent.click(screen.getByRole('button', { name: /Analytics/ }));

    expect(panel).toHaveAttribute('data-state', 'open');
    expect(panel).toHaveClass('visible');
  });
});
