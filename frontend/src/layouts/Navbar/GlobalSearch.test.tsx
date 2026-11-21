import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ShellSearchContext, type ShellSearchValue } from '../search-context';

import { GlobalSearch } from './GlobalSearch';

/**
 * D-26. The panel existed before this; what it lacked was an index on the
 * doctor side and a keyboard, and what it got wrong was claiming "No
 * matches" over sources that had not loaded.
 *
 * These drive the shell against a stub value rather than a real index, so
 * they assert the shell's half of the contract: that a `pending` index is
 * never reported as an empty result set, and that a search opened with ⌘K
 * can be completed without reaching for the mouse.
 */

const RESULTS = [
  { id: 'p-1', label: 'Khaled Nassar', hint: 'Patient · MRN 4482-19', path: '/doctor/patients/PT-1001' },
  { id: 'p-2', label: 'Nour Ali', hint: 'Patient · MRN 4483-20', path: '/doctor/patients/PT-1002' },
  { id: 'n-1', label: 'Labs', hint: 'Go to · Clinical', path: '/doctor/labs' },
];

function value(overrides: Partial<ShellSearchValue> = {}): ShellSearchValue {
  return {
    search: (term) =>
      term.trim() === ''
        ? []
        : RESULTS.filter((r) => r.label.toLowerCase().includes(term.trim().toLowerCase())),
    ...overrides,
  };
}

function renderSearch(shell: ShellSearchValue) {
  return render(
    <ShellSearchContext.Provider value={shell}>
      <MemoryRouter initialEntries={['/doctor/overview']}>
        <Routes>
          <Route path="/doctor/overview" element={<GlobalSearch placeholder="Search…" />} />
          <Route path="/doctor/patients/:id" element={<p>patient record</p>} />
          <Route path="/doctor/labs" element={<p>labs screen</p>} />
        </Routes>
      </MemoryRouter>
    </ShellSearchContext.Provider>,
  );
}

describe('the shell search panel', () => {
  it('opens results for a term and navigates on click', async () => {
    renderSearch(value());

    await userEvent.type(screen.getByRole('combobox', { name: 'Global search' }), 'khaled');
    await userEvent.click(screen.getByRole('option', { name: /Khaled Nassar/ }));

    expect(screen.getByText('patient record')).toBeInTheDocument();
  });

  it('says it is still searching rather than that nothing matched', async () => {
    // The defect this guards: three queries behind the doctor index take a
    // few hundred ms, and during them the roster is empty. Announcing "No
    // matches for Khaled" about a patient mid-fetch is a false claim.
    renderSearch(value({ search: () => [], pending: true }));

    await userEvent.type(screen.getByRole('combobox', { name: 'Global search' }), 'khaled');

    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
  });

  it('says nothing matched only once the index has settled', async () => {
    renderSearch(value({ search: () => [], pending: false }));

    await userEvent.type(screen.getByRole('combobox', { name: 'Global search' }), 'zzzz');

    expect(screen.getByRole('status')).toHaveTextContent('No matches for “zzzz”.');
  });

  it('is completable from the keyboard alone, which is what ⌘K promises', async () => {
    renderSearch(value());

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('combobox', { name: 'Global search' })).toHaveFocus();

    await userEvent.keyboard('a');
    // The top hit is active on open, so Enter alone opens it — one ArrowDown
    // steps to the second, "Nour Ali".
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveTextContent('Nour Ali');

    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('patient record')).toBeInTheDocument();
  });

  it('keeps the caret in the field and marks the active option for a screen reader', async () => {
    renderSearch(value());
    const input = screen.getByRole('combobox', { name: 'Global search' });

    await userEvent.type(input, 'a');
    await userEvent.keyboard('{ArrowDown}');

    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).not.toBeNull();
    expect(screen.getAllByRole('option').find((o) => o.id === activeId)).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('clears and closes on Escape, per SearchInput\u2019s own contract (DS \u00a78.28)', async () => {
    // Asserted against the design system rather than the ARIA pattern: the
    // atom already owns "Escape clears", and a field with two Escape
    // meanings is worse than one that matches every other search box.
    renderSearch(value());
    const input = screen.getByRole('combobox', { name: 'Global search' });

    await userEvent.type(input, 'khaled');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });
});

describe('the pointer and the keyboard competing for the active option', () => {
  /**
   * Found by driving the real browser, not by reading the code.
   *
   * The rows tracked `mouseenter`, which fires when the panel opens or
   * re-renders UNDER a cursor that has not moved. So: click anything, press
   * ⌘K, type, press Enter — and you opened whichever row happened to sit
   * beneath a pointer you never touched, instead of the top hit. In a live
   * page the search panel opens at x≥600, which is exactly where a hand
   * that just clicked something tends to be resting.
   *
   * `mousemove` fires only when the mouse is actually moved, so the pointer
   * takes the selection when it is being used and never when it is resting.
   */
  it('ignores a cursor the panel merely opened underneath', async () => {
    renderSearch(value());

    await userEvent.type(screen.getByRole('combobox', { name: 'Global search' }), 'a');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    // The panel appearing under a stationary pointer — no movement.
    fireEvent.mouseEnter(options[2]!);

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('still hands the selection over when the mouse actually moves', async () => {
    renderSearch(value());

    await userEvent.type(screen.getByRole('combobox', { name: 'Global search' }), 'a');
    fireEvent.mouseMove(screen.getAllByRole('option')[2]!);

    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false');
  });
});
