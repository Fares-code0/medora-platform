import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MAIN_CONTENT_ID, SkipToContent } from './SkipToContent';

/**
 * Skip link — WCAG 2.1 §2.4.1 "Bypass Blocks".
 * Both shells put a long navigation region before the content, so keyboard
 * users must be able to jump past it. The link is visually hidden until it
 * receives focus, so it must never be `display: none` / `hidden`.
 */
describe('SkipToContent', () => {
  it('targets the shared main-content id', () => {
    render(<SkipToContent />);

    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
  });

  it('is the first element reachable by Tab', async () => {
    render(
      <>
        <SkipToContent />
        <nav>
          <a href="/patients">Patients</a>
        </nav>
      </>,
    );

    await userEvent.tab();

    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveFocus();
  });

  it('stays in the accessibility tree while visually hidden', () => {
    render(<SkipToContent />);

    const link = screen.getByRole('link', { name: /skip to main content/i });
    expect(link).not.toHaveAttribute('hidden');
    expect(link).not.toHaveAttribute('aria-hidden');
  });
});
