import type { ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { LOCALES, loadCatalogue } from '@/i18n';
import { LocaleContext } from '@/i18n/locale-context';

import { PasswordStrengthMeter } from './PasswordStrengthMeter';

/**
 * NEW-34. Settings → Account and the auth pages each rendered their own
 * strength meter, and only the auth copy was translated: changing a password
 * in Arabic read "Password strength: Fair". There is now one meter, and these
 * pin that it speaks the reader's language. That the auth pages render this
 * same component is `features/auth/components/strength-meter.test.ts`'s.
 */

function Arabic({ children }: { children: ReactNode }) {
  return (
    <LocaleContext.Provider
      value={{ locale: 'ar', dir: 'rtl', setLocale: () => undefined, locales: LOCALES }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

beforeAll(async () => {
  await loadCatalogue('ar');
});

describe('PasswordStrengthMeter', () => {
  it('renders nothing while the field is empty', () => {
    const { container } = render(<PasswordStrengthMeter password="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the strength in words, announced politely, with the bar hidden from assistive tech', () => {
    const { container } = render(<PasswordStrengthMeter password="abc" />);
    const label = screen.getByText(/Password strength/);
    expect(label).toHaveTextContent('Password strength: Very weak');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('scores with the platform rules: five rules and twelve characters is very strong', () => {
    const { rerender } = render(<PasswordStrengthMeter password="Abcdefg1!" />);
    expect(screen.getByText(/Password strength/)).toHaveTextContent('Strong');
    rerender(<PasswordStrengthMeter password="Abcdefghij1!" />);
    expect(screen.getByText(/Password strength/)).toHaveTextContent('Very strong');
  });

  it('speaks the reader’s language — the Settings meter used to be English-only', () => {
    render(<PasswordStrengthMeter password="abc" />, { wrapper: Arabic });
    expect(screen.getByText(/قوة كلمة المرور/)).toHaveTextContent('قوة كلمة المرور: ضعيفة جدًا');
    expect(screen.queryByText(/Password strength/)).toBeNull();
  });
});
