import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { APP_NAME } from '@/constants';

import { formatDocumentTitle, useDocumentTitle } from './useDocumentTitle';

/**
 * Document title — WCAG 2.1 §2.4.2 "Page Titled".
 * Every route in the app rendered the bare product name, so browser
 * history, tab switching and screen-reader page announcements could not
 * distinguish one screen from another.
 */

function Probe({ title }: { title: string | null }) {
  useDocumentTitle(title);
  return null;
}

afterEach(() => {
  document.title = '';
});

describe('formatDocumentTitle', () => {
  it('puts the page name first so truncated tabs stay distinguishable', () => {
    expect(formatDocumentTitle('Patients')).toBe(`Patients · ${APP_NAME}`);
  });

  it('falls back to the bare product name when a page has no title', () => {
    expect(formatDocumentTitle(null)).toBe(APP_NAME);
    expect(formatDocumentTitle('')).toBe(APP_NAME);
    expect(formatDocumentTitle('   ')).toBe(APP_NAME);
  });

  it('does not repeat the product name when the page is already named for it', () => {
    expect(formatDocumentTitle(APP_NAME)).toBe(APP_NAME);
  });
});

describe('useDocumentTitle', () => {
  it('writes the formatted title to the document', () => {
    render(<Probe title="Lab result" />);

    expect(document.title).toBe(`Lab result · ${APP_NAME}`);
  });

  it('updates the title when the page changes', () => {
    const { rerender } = render(<Probe title="Patients" />);
    expect(document.title).toBe(`Patients · ${APP_NAME}`);

    rerender(<Probe title="Appointments" />);

    expect(document.title).toBe(`Appointments · ${APP_NAME}`);
  });

  it('restores the previous title on unmount so nested shells do not leak', () => {
    document.title = 'Outer';
    const { unmount } = render(<Probe title="Inner" />);
    expect(document.title).toBe(`Inner · ${APP_NAME}`);

    unmount();

    expect(document.title).toBe('Outer');
  });
});

describe('formatDocumentTitle — titles that already name the product', () => {
  it('does not append the suffix twice', () => {
    // `login.title` is "Sign in to Medora" and its four translations name the
    // product too. Appending anyway produced "Sign in to Medora · Medora".
    expect(formatDocumentTitle('Sign in to Medora')).toBe('Sign in to Medora');
  });

  it('matches the product name as a whole word, not a substring', () => {
    expect(formatDocumentTitle('Medorable results')).toBe(`Medorable results · ${APP_NAME}`);
  });

  it('is case-insensitive, because a translation may not capitalise it', () => {
    expect(formatDocumentTitle('welcome to medora')).toBe('welcome to medora');
  });

  it('still suffixes an ordinary page name', () => {
    expect(formatDocumentTitle('Patients')).toBe(`Patients · ${APP_NAME}`);
  });
});
