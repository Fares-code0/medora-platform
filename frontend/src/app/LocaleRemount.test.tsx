import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, LocaleSwitcher, formatDate, setFormatLocale } from '@/i18n';

import { LocaleRemount } from './LocaleRemount';

/**
 * A language change reaches every formatted date (DEC-009). Most dates are
 * formatted by plain functions that subscribe to nothing, so the routed tree
 * is remounted under the new language — and the picker keeps focus, and
 * cached queries are refetched in case they formatted while fetching.
 */

const MOMENT = '2026-03-12T14:30:00';

afterEach(() => {
  window.localStorage.clear();
  setFormatLocale('en');
});

/** A plain function's output, with no hook of its own — the case that needs the remount. */
function FormattedDate() {
  return <p data-testid="date">{formatDate(MOMENT)}</p>;
}

function renderApp(client: QueryClient) {
  return render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <LocaleRemount>
          <LocaleSwitcher />
          <FormattedDate />
        </LocaleRemount>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('LocaleRemount', () => {
  it('re-renders formatted dates in the new language, Latin digits, and keeps focus on the picker', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const user = userEvent.setup();
    renderApp(client);

    expect(screen.getByTestId('date')).toHaveTextContent('Mar 12, 2026');
    expect(invalidate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    await user.click(screen.getByRole('option', { name: 'العربية' }));

    await waitFor(() => {
      expect(screen.getByTestId('date')).toHaveTextContent('12 مارس 2026');
    });
    expect(screen.getByTestId('date').textContent).not.toMatch(/[٠-٩۰-۹]/);
    expect(invalidate).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveFocus();
    });
  });
});
