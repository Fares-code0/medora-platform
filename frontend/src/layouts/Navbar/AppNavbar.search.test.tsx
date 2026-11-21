import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { doctorNavigation } from '../navigation';
import { ShellSearchContext, type ShellSearchValue } from '../search-context';

import { AppNavbar } from './AppNavbar';

/**
 * The navbar search is an icon that opens the search, not a field parked in
 * the middle of the bar. These drive the real GlobalSearch inside it, so
 * they prove the presentation changed and the search did not.
 */

vi.mock('@/app/providers', () => ({ useCan: () => () => false }));
vi.mock('./AppBreadcrumb', () => ({ AppBreadcrumb: () => <nav>breadcrumb</nav> }));
vi.mock('./AvatarMenu', () => ({ AvatarMenu: () => <div>avatar</div> }));
vi.mock('./NotificationButton', () => ({ NotificationButton: () => <div>bell</div> }));

const RESULTS = [
  { id: 'p-1', label: 'Khaled Nassar', hint: 'Patient', path: '/doctor/patients/PT-1001' },
];

const shell: ShellSearchValue = {
  search: (term) =>
    term.trim() === ''
      ? []
      : RESULTS.filter((r) => r.label.toLowerCase().includes(term.trim().toLowerCase())),
};

function renderNavbar(searchPlaceholderKey = doctorNavigation.searchPlaceholderKey) {
  return render(
    <ShellSearchContext.Provider value={shell}>
      <MemoryRouter initialEntries={['/doctor/overview']}>
        <Routes>
          <Route
            path="/doctor/overview"
            element={
              <AppNavbar
                config={{ ...doctorNavigation, searchPlaceholderKey }}
                elevated={false}
                onMenuToggle={() => undefined}
              />
            }
          />
          <Route path="/doctor/patients/:id" element={<p>patient record</p>} />
        </Routes>
      </MemoryRouter>
    </ShellSearchContext.Provider>,
  );
}

describe('the navbar search', () => {
  it('shows an icon, not a field, until it is opened', () => {
    renderNavbar();

    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('combobox', { name: 'Global search' })).not.toBeInTheDocument();
  });

  it('opens on the icon with the field focused, and still searches', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox', { name: 'Global search' });
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');

    await user.type(input, 'khaled');
    await user.click(screen.getByRole('option', { name: /Khaled Nassar/ }));

    expect(await screen.findByText('patient record')).toBeInTheDocument();
  });

  it('closes on Escape and hands focus back to the icon', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(screen.getByRole('combobox', { name: 'Global search' }), 'kha');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: 'Global search' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Search' })).toHaveFocus();
  });

  it('closes from its own button', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: 'Global search' })).not.toBeInTheDocument();
    });
  });

  it('opens from the keyboard with Ctrl+K', async () => {
    const user = userEvent.setup();
    renderNavbar();

    await user.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('combobox', { name: 'Global search' })).toHaveFocus();
  });

  it('is not offered by a shell with no search index', () => {
    renderNavbar(null);

    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument();
  });
});
