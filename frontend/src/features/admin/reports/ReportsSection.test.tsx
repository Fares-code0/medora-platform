import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReportsSection } from './ReportsSection';

/**
 * Admin Reports at the surface (ADM-08 · UX §3.8).
 *
 * Run against the real deriving service, for the same reason ADM-07's page
 * tests are: the claims worth making here are about a report built from the
 * documents the platform actually holds — that the tabs serve different
 * widgets, that "view as table" shows the numbers the chart was drawn from,
 * that a widget with no source says so rather than saying "no data", and that
 * exporting is gated on the capability that governs writing to the audit
 * trail.
 *
 * No `PhiAccessProvider`: this screen renders aggregates and carries no
 * patient identifier anywhere, which is why nothing here goes through ADM-10.
 */

/** Flipped per test, the way the other admin harnesses gate capabilities. */
const capabilities = { current: ['logs.view', 'logs.export'] as readonly string[] };
const toasts: { variant: string; title: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => (permission: string) => capabilities.current.includes(permission),
  useToast: () => ({
    toast: (options: { variant: string; title: string }) => {
      toasts.push(options);
    },
  }),
}));

/*
 * jsdom ships <dialog> without the modal methods `Modal` calls, so the
 * schedule dialog would render permanently closed and every query into it
 * would miss. Only assigned where jsdom has nothing, the same rule
 * `src/test/setup.ts` applies to the stubs it owns.
 */
const dialogs = window.HTMLDialogElement.prototype as {
  showModal?: (this: HTMLDialogElement) => void;
  close?: (this: HTMLDialogElement) => void;
};
dialogs.showModal ??= function showModal(this: HTMLDialogElement) {
  this.open = true;
};
dialogs.close ??= function close(this: HTMLDialogElement) {
  this.open = false;
};

beforeEach(() => {
  window.localStorage.clear();
  capabilities.current = ['logs.view', 'logs.export'];
  toasts.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** @param search The query string a link into this page would carry. */
function renderReports(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/reports${search}`]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<ReportsSection />, { wrapper: Tree });
}

/**
 * The widget card carrying `title`, once the report has loaded.
 *
 * Climbs to the `Card` root rather than to the heading's immediate parent —
 * `closest('div')` stops at the header's own text wrapper, which contains
 * neither the chart nor the ⋯ menu, so every scoped query inside it would miss
 * for a reason that has nothing to do with the assertion being made.
 */
async function widgetTitled(title: string): Promise<HTMLElement> {
  return waitFor(
    () => {
      const heading = screen.getByRole('heading', { name: title });
      let node: HTMLElement | null = heading.parentElement;
      while (node !== null && !node.classList.contains('rounded-surface')) {
        node = node.parentElement;
      }
      if (node === null) throw new Error(`No widget card around "${title}"`);
      return node;
    },
    { timeout: 5000 },
  );
}

describe('report selection', () => {
  it('offers §3.8’s four reports and lands on Growth', async () => {
    renderReports();

    for (const label of ['Growth', 'Utilization', 'Clinical operations', 'System performance']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'Growth' })).toHaveAttribute('aria-selected', 'true');
    await widgetTitled('User growth');
  });

  it('seeds the tab, range and comparison from the URL', async () => {
    renderReports('?report=clinical&range=7d&compare=1');

    expect(screen.getByRole('tab', { name: 'Clinical operations' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Reporting range')).toHaveTextContent('Last 7 days');
    expect(screen.getByRole('switch', { name: 'Compare' })).toBeChecked();
    await widgetTitled('Response time to requests');
  });

  /*
   * An unrecognised parameter must be ignored rather than cast — a stale link
   * carrying `?report=revenue` should land on the default tab, not on a blank
   * page built from a report id that does not exist.
   */
  it('ignores a report or range the page does not have', async () => {
    renderReports('?report=revenue&range=forever');

    expect(screen.getByRole('tab', { name: 'Growth' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Reporting range')).toHaveTextContent('Last 30 days');
    await widgetTitled('User growth');
  });

  it('serves a different set of widgets on each tab', async () => {
    const user = userEvent.setup();
    renderReports();
    await widgetTitled('User growth');

    await user.click(screen.getByRole('tab', { name: 'Utilization' }));
    await widgetTitled('Peak hours');
    expect(screen.queryByRole('heading', { name: 'User growth' })).not.toBeInTheDocument();
  });
});

describe('widgets', () => {
  /*
   * The §3.8 P6 requirement, and the invariant the widget shell exists for:
   * the table is the chart's own dataset, annotation columns included. A table
   * assembled separately would be free to disagree with the bars above it.
   */
  it('shows the chart’s own numbers when switched to a table', async () => {
    const user = userEvent.setup();
    renderReports('?report=clinical');
    const card = await widgetTitled('Outcome rates by specialty');

    await user.click(within(card).getByRole('button', { name: /options/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'View as table' }));

    const table = await within(card).findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);

    expect(headers).toEqual([
      'Specialty',
      'No-show rate',
      'Completion',
      'Cancellation',
      'Concluded',
    ]);
  });

  /*
   * The three-valued availability where it reaches the reader. "No data for
   * this period" would tell an administrator to widen the range; no range will
   * ever fill this widget, and the copy has to say what would.
   */
  it('tells a widget with no source apart from an empty one', async () => {
    renderReports('?report=clinical');
    const card = await widgetTitled('Lab turnaround time');

    expect(within(card).getByText('No source for this yet')).toBeInTheDocument();
    expect(within(card).getByText(/laboratory service/i)).toBeInTheDocument();
    // Nothing to view or export, so the widget offers neither.
    expect(within(card).queryByRole('button', { name: /options/i })).not.toBeInTheDocument();
  });

  it('chips a widget whose window is not the global range', async () => {
    renderReports('?report=clinical&range=7d');
    const card = await widgetTitled('Prescription volume');

    expect(within(card).getByText(/^Last \d+ days$/)).toBeInTheDocument();
  });

  /*
   * On Growth rather than Utilization: the cumulative line has a figure in
   * both windows, where Utilization's widgets are all either range-free or
   * empty in the window before the seeded appointments — so that tab has
   * nothing to compare and the assertion would be about the fixture rather
   * than about the switch.
   */
  it('adds a previous-period comparison only when compare is on', async () => {
    const user = userEvent.setup();
    renderReports('?report=growth');
    await widgetTitled('User growth');

    expect(screen.queryByText(/vs previous period/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Compare' }));

    await waitFor(
      () => {
        expect(screen.getAllByText(/vs previous period|^was /).length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );
  }, 15000);

  /*
   * The bug the browser caught: with compare on, Prescription volume printed
   * "0% vs previous period" beside its own "Last 30 days" chip — a confident
   * delta on a figure the page's range cannot move.
   */
  it('withholds the comparison from a widget whose window is not the range', async () => {
    renderReports('?report=clinical&compare=1');
    const card = await widgetTitled('Prescription volume');

    expect(within(card).getByText(/^Last \d+ days$/)).toBeInTheDocument();
    expect(within(card).queryByText(/vs previous period/)).not.toBeInTheDocument();
  });

  it('drills a no-show into appointment oversight already filtered', async () => {
    renderReports('?report=clinical');
    const card = await widgetTitled('Outcome rates by specialty');

    expect(within(card).getByRole('link', { name: /Open the no-shows/ })).toHaveAttribute(
      'href',
      '/admin/appointments?status=no-show',
    );
  });
});

describe('exports', () => {
  it('exports one widget as CSV and says the export was logged', async () => {
    const user = userEvent.setup();
    renderReports();
    const card = await widgetTitled('User growth');

    await user.click(within(card).getByRole('button', { name: /options/i }));
    await user.click(await screen.findByRole('menuitem', { name: /Export this widget/ }));

    await waitFor(
      () => {
        expect(toasts.at(-1)?.title).toContain('User growth');
      },
      { timeout: 5000 },
    );
    expect(toasts.at(-1)?.variant).toBe('success');
  });

  /*
   * Reading the report is administrator-only by route and carries no
   * identifier. Taking it *out* writes a `data-export` row to the audit trail
   * and produces a file that outlives the session, which is what `logs.export`
   * governs on ADM-07 — so the gate sits on the export, not on the page.
   */
  it('withholds both exports from an administrator without logs.export', async () => {
    capabilities.current = ['logs.view'];
    renderReports();
    await widgetTitled('User growth');

    expect(screen.getByRole('button', { name: 'Export deck' })).toBeDisabled();
    expect(
      screen.getByText(/Exporting a report needs the Export logs capability/),
    ).toBeInTheDocument();
  });

  it('enables the deck export once the report has loaded', async () => {
    renderReports();
    await widgetTitled('User growth');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export deck' })).toBeEnabled();
    });
  });
});

describe('scheduled reports', () => {
  /*
   * §3.8's last line: "Scheduled-report failures notify the admin". There is
   * no notification service here, and a five-day-old failed delivery is a
   * standing condition rather than an event — so it surfaces as a banner that
   * survives a reload, which is what a real notification would mirror.
   */
  it('raises a standing banner for a schedule whose last run failed', async () => {
    renderReports();

    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent('A scheduled report failed to deliver');
    expect(alert).toHaveTextContent('Monthly utilization review');
    // The reason is on the row too, so it survives scrolling past the banner.
    expect(screen.getAllByText(/exceeded the 10 MB limit/).length).toBeGreaterThan(0);
  });

  it('opens the schedule dialog pre-filled from the tab on screen', async () => {
    const user = userEvent.setup();
    renderReports('?report=system&range=90d');
    await widgetTitled('API uptime & latency');

    await user.click(screen.getByRole('button', { name: 'Schedule' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Schedule name/)).toHaveValue('System performance report');
    expect(within(dialog).getByLabelText(/^Report/)).toHaveTextContent('System performance');
    expect(within(dialog).getByLabelText(/^Range/)).toHaveTextContent('Last 90 days');
  });

  it('refuses a schedule with no recipients and names what is missing', async () => {
    const user = userEvent.setup();
    renderReports();
    await widgetTitled('User growth');

    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    expect(await within(dialog).findByText('Add at least one recipient.')).toBeInTheDocument();
    // Still open — a refused submission must not look like a successful one.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('creates a schedule and lists it', async () => {
    const user = userEvent.setup();
    renderReports();
    await widgetTitled('User growth');

    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/Schedule name/));
    await user.type(within(dialog).getByLabelText(/Schedule name/), 'Board pack');
    await user.type(within(dialog).getByLabelText(/Recipients/), 'board@medora.health');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(
      () => {
        expect(screen.getByText('Board pack')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(toasts.at(-1)?.title).toBe('Schedule created');
  });
});
