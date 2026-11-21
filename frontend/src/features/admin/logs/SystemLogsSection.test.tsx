import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logsApi } from './api/logs.api';
import { LogDetailDrawer } from './LogDetailDrawer';
import { PAGE_SIZE, RETENTION_DAYS } from './logs';
import type { LogEvent } from './logs.types';
import { LogTable, type LogTableProps } from './LogTable';
import { SystemLogsSection } from './SystemLogsSection';

/**
 * System Logs at the surface (ADM-07 · UX §3.7).
 *
 * The page-level tests run against the real aggregating service, because the
 * claims worth making here are about a log built from the trails the platform
 * actually keeps: that rows with no address say so, that paging asks the
 * service for the next window rather than slicing one already held, and that
 * a pivot reaches the query.
 *
 * The row-rendering claims are made against `LogTable` directly with a
 * two-row fixture. A page-level assertion that "some cell somewhere reads —"
 * cannot tell a missing IP from a missing device, and the point of the em
 * dash is that each absence is stated on its own.
 *
 * No `PhiAccessProvider` here, unlike every other admin harness: this page
 * renders no patient identifiers. `target` is a licence number, an MRN, an
 * appointment reference or a masked subject label by construction, and
 * `administration.api.test.ts` enforces that over the whole corpus.
 */

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => true,
  useToast: () => ({ toast: () => undefined }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

/*
 * jsdom ships <dialog> without the modal methods `Drawer` calls, so the detail
 * drawer would render permanently closed and every query into it would miss.
 * Only assigned where jsdom has nothing, the same rule `src/test/setup.ts`
 * applies to the stubs it owns — this one stays here because the drawer is
 * this screen's, not every screen's.
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

/** @param search The query string an ADM-01 "Investigate" link would carry. */
function renderLogs(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/logs${search}`]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <SystemLogsSection />
    </Tree>,
  );
}

/* ── Row fixtures ─────────────────────────────────────────────── */

const WITH_SOURCE: LogEvent = {
  id: 'login:d1:l1',
  at: '2026-08-14T09:15:22.481Z',
  category: 'authentication',
  type: 'login-succeeded',
  severity: 'info',
  actor: 'Dr. Yara Hassan',
  actorRole: 'doctor',
  target: 'LIC-4471',
  action: 'Sign-in succeeded',
  summary: 'Sign-in succeeded from Cairo, EG',
  ip: '203.0.113.9',
  device: 'Chrome 128 on macOS',
  payload: { result: 'success' },
};

/** A platform-monitor row: nobody signed in, so there is no address at all. */
const WITHOUT_SOURCE: LogEvent = {
  id: 'system:integration-failed:0',
  at: '2026-08-14T03:02:11.007Z',
  category: 'system',
  type: 'integration-failed',
  severity: 'critical',
  actor: 'Platform monitor',
  actorRole: 'system',
  target: 'int-lab-bridge',
  action: 'Integration failed',
  summary: 'Laboratory bridge rejected a results batch',
  ip: null,
  device: null,
  payload: { httpStatus: 502 },
};

function renderTable(rows: readonly LogEvent[], overrides: Partial<LogTableProps> = {}) {
  const props = {
    rows,
    isLoading: false,
    isError: false,
    onRetry: () => undefined,
    onPivot: () => undefined,
    onOpen: () => undefined,
    ...overrides,
  };
  return render(<LogTable {...props} />);
}

/**
 * `iso` as the table is expected to print it: the reader's own zone, to the
 * millisecond.
 *
 * Derived through `Intl` rather than through the same `Date` getters
 * `formatTimestamp` uses, so this is an independent statement about which
 * clock the column speaks rather than a second copy of the formatter — which
 * would agree with a column rendered in any zone at all. The milliseconds are
 * read off the ISO string, where they are the same number in every zone.
 */
function localStamp(iso: string): string {
  const shown = new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso));
  const ms = /\.(\d{3})Z$/.exec(iso)?.[1] ?? '000';
  return `${shown}.${ms}`;
}

/** The `<tr>` carrying `summary`, narrowed so a structural change fails loudly. */
function rowFor(summary: string): HTMLElement {
  const row = screen.getByText(summary).closest('tr');
  if (!(row instanceof HTMLElement)) throw new Error(`No row for "${summary}"`);
  return row;
}

describe('the log table', () => {
  it('renders the §3.7 columns', async () => {
    renderLogs();

    const table = await screen.findByRole('table', { name: /system log/i });
    for (const header of ['Timestamp', 'Severity', 'Actor', 'Event', 'Summary', 'IP / device']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('shows an em dash where a source carries no IP, rather than implying one', async () => {
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('states the absent IP and the absent device separately, never a blank cell', () => {
    // The page-level assertion above is satisfied by a single em dash anywhere
    // in the table. "IP / device" is two facts in one column, and a row from a
    // source that records neither has to say so twice — otherwise a blank half
    // reads as a value that failed to load rather than one that never existed.
    renderTable([WITH_SOURCE, WITHOUT_SOURCE]);

    const absent = rowFor(WITHOUT_SOURCE.summary);
    expect(within(absent).getAllByText('—')).toHaveLength(2);

    // The contrast is what makes the dashes legible as a deliberate choice.
    const present = rowFor(WITH_SOURCE.summary);
    expect(within(present).queryByText('—')).not.toBeInTheDocument();
    expect(within(present).getByText('203.0.113.9')).toBeInTheDocument();
    expect(within(present).getByText('Chrome 128 on macOS')).toBeInTheDocument();
  });

  it('tints a critical row so it is findable by scanning, not only by reading badges', () => {
    renderTable([WITH_SOURCE, WITHOUT_SOURCE]);

    expect(rowFor(WITHOUT_SOURCE.summary)).toHaveClass('bg-error-subtle');
    expect(rowFor(WITH_SOURCE.summary)).not.toHaveClass('bg-error-subtle');
  });

  it('prints the timestamp to the millisecond, mono and tabular', () => {
    // §3.7 asks for millisecond precision: two events a few hundred
    // milliseconds apart are a sequence, and a minute-resolution clock makes
    // them look simultaneous.
    //
    // In the reader's own zone, not UTC — the From/To filters are
    // `datetime-local` fields and can speak no other clock, and a column an
    // investigator cannot type back into the filters is a column they can be
    // misled by. `logs.test.ts` pins that round trip across four zones.
    renderTable([WITH_SOURCE]);

    const stamp = screen.getByText(localStamp(WITH_SOURCE.at));
    expect(stamp).toHaveClass('font-mono', 'tabular-nums');
    // The instant itself is not lost to the local rendering: the machine-
    // readable original stays on the element for anything that needs it.
    expect(stamp).toHaveAttribute('datetime', WITH_SOURCE.at);
  });

  it('offers no way to edit or delete an event', async () => {
    // §3.7: read-only for everyone including admins.
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('states the retention policy', async () => {
    renderLogs();

    expect(await screen.findByText(/retained for 365 days/i)).toBeInTheDocument();
    // Read from the domain constant, not from a second copy of the number: a
    // caption promising a window the service does not apply is worse than no
    // caption at all.
    expect(
      screen.getByText(new RegExp(`retained for ${String(RETENTION_DAYS)} days`, 'i')),
    ).toBeInTheDocument();
  });

  it('keeps the panel standing while the log loads, rather than an empty table', async () => {
    // The envelope lives inside the Panel, the shape every ADM-01 widget
    // settled on — the heading and frame stay put while the query is in
    // flight. An empty table rendered against `data ?? []` would say the
    // platform has no events when nothing has been read yet.
    renderLogs();

    expect(screen.getByText('Event stream')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /system log/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no events match/i)).not.toBeInTheDocument();

    // Positive control: the rows genuinely arrive, so the absences above were
    // measured during the loading window.
    expect(await screen.findByRole('table', { name: /system log/i })).toBeInTheDocument();
  });

  it('attributes a failed read to the panel it belongs to, with a retry', async () => {
    vi.spyOn(logsApi, 'list').mockRejectedValue(new Error('log service unreachable'));
    renderLogs();

    const panel = await screen.findByRole('region', { name: 'Event stream' });
    expect(await within(panel).findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The page keeps its own caption: the retention policy is a fact about the
    // log, not about this read of it.
    expect(screen.getByText(/retained for 365 days/i)).toBeInTheDocument();
  });
});

describe('following a trail', () => {
  it('offers the actor, the event type and the IP as pivots, carrying the filter value', async () => {
    const user = userEvent.setup();
    const onPivot = vi.fn();
    renderTable([WITH_SOURCE], { onPivot });

    await user.click(screen.getByRole('button', { name: 'Filter by actor Dr. Yara Hassan' }));
    await user.click(
      screen.getByRole('button', { name: 'Filter by event type Sign-in succeeded' }),
    );
    await user.click(screen.getByRole('button', { name: 'Filter by IP 203.0.113.9' }));

    expect(onPivot.mock.calls).toEqual([
      ['actor', 'Dr. Yara Hassan'],
      // The taxonomy id, not the label on screen — this value goes into
      // `LogFilters.type`, which is compared against `LogEvent.type`.
      ['type', 'login-succeeded'],
      ['ip', '203.0.113.9'],
    ]);
  });

  it('opens the row it was asked to open', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderTable([WITH_SOURCE, WITHOUT_SOURCE], { onOpen });

    await user.click(screen.getByRole('button', { name: /view detail for integration failed/i }));

    expect(onOpen).toHaveBeenCalledWith(WITHOUT_SOURCE);
  });

  it('asks the service to narrow to the pivoted value, rather than filtering the page it holds', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(logsApi, 'list');
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const pivot = within(table).getAllByRole('button', { name: /filter by actor/i })[0];
    if (pivot === undefined) throw new Error('the table rendered no actor pivot');
    const actor = pivot.textContent ?? '';
    await user.click(pivot);

    await waitFor(() => {
      const request = list.mock.calls.at(-1)?.[0];
      expect(request?.filters.actor).toBe(actor);
      // Back to the first page: the narrowed result is shorter than the one
      // that was on screen.
      expect(request?.offset).toBe(0);
    });
  });
});

describe('filtering and pivot', () => {
  it('narrows the table by severity', async () => {
    const user = userEvent.setup();
    renderLogs();
    const unfiltered = await screen.findByRole('table', { name: /system log/i });
    // Positive control: the page starts with more than one severity on it, so
    // the disappearance asserted below is this filter's doing and not the
    // corpus happening to be all critical.
    expect(within(unfiltered).getAllByText('Info').length).toBeGreaterThan(0);

    // The design-system Select is a button + listbox, not a native <select>:
    // `user.selectOptions` throws "Value not found in options" against it.
    await user.click(screen.getByRole('combobox', { name: /severity/i }));
    await user.click(await screen.findByRole('option', { name: /critical/i }));

    // Pre-existing flake (predates ADM-06b, belongs to ADM-07): this waits
    // out one real `logsApi.list` round trip through the mock's own 260ms
    // latency, and until it resolves the table is still showing the
    // unfiltered rows — including several "Info" badges — so an early
    // retry inside the loop finds more than one and `queryByText` throws on
    // the ambiguity rather than just reporting "not gone yet". Testing
    // Library's 1000ms default `waitFor` budget is tight for a single
    // 260ms call on a machine running the whole suite in parallel, even
    // though nothing here is actually stuck; 20000ms matches the precedent
    // set by the sibling dialog test in CommunicationsSection.test.tsx.
    await waitFor(() => {
      // Scoped to the table: the Select's own trigger now reads "Critical"
      // too, and a page-wide text match would be satisfied by that alone —
      // which is to say, by a filter wired to nothing.
      const table = within(screen.getByRole('table', { name: /system log/i }));
      expect(table.queryByText('Info')).not.toBeInTheDocument();
      expect(table.queryByText('Warning')).not.toBeInTheDocument();
    }, { timeout: 20000 });
    const rows = within(screen.getByRole('table', { name: /system log/i }));
    expect(rows.getAllByRole('row').length).toBeGreaterThan(1);
    expect(rows.getAllByText('Critical').length).toBeGreaterThan(0);
    // Matches the waitFor's own 20000ms above — Vitest's 5000ms test-level
    // default would otherwise kill the test before that budget is used.
  }, 20000);

  it('pivots on an IP, filtering to it', async () => {
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const pivot = within(table).getAllByRole('button', { name: /filter by IP/i })[0];
    const ip = pivot?.textContent ?? '';
    if (pivot) await user.click(pivot);

    await waitFor(() => {
      expect(screen.getByLabelText(/IP address/i)).toHaveValue(ip);
    });
  });

  it('names the actor a pivot filtered to, even before the name list arrives', async () => {
    // The actor options are a separate read. A pivot is the fastest way into
    // that filter and does not wait for it, so the selected name is unioned
    // into the options — otherwise the trigger falls back to its placeholder
    // and a filtered table reads as an unfiltered one.
    vi.spyOn(logsApi, 'actors').mockReturnValue(new Promise<readonly string[]>(() => undefined));
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const pivot = within(table).getAllByRole('button', { name: /filter by actor/i })[0];
    if (pivot === undefined) throw new Error('the table rendered no actor pivot');
    const actor = pivot.textContent ?? '';
    await user.click(pivot);

    // The trigger is a button whose label is the current choice, not an
    // <option> — `toHaveValue` has nothing to read here.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Actor' })).toHaveTextContent(actor);
    });
  });

  it('lets the reader back out of a pivot they followed into a dead end', async () => {
    // A filter that arrived from a table cell has to be removable from the
    // bar. Without that, the only way out of a trail is a page reload — and
    // an investigator who cannot widen a search has lost the log, not a
    // filter.
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const pivot = within(table).getAllByRole('button', { name: /filter by IP/i })[0];
    if (pivot === undefined) throw new Error('the table rendered no IP pivot');
    const ip = pivot.textContent ?? '';
    await user.click(pivot);
    await waitFor(() => {
      expect(screen.getByLabelText(/IP address/i)).toHaveValue(ip);
    });

    await user.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(screen.getByLabelText(/IP address/i)).toHaveValue('');
    // Back to `EMPTY_FILTERS`: with nothing set there is nothing to clear.
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeDisabled();
  });

  it('returns to the first page when a filter narrows the result', async () => {
    // `page` is 1-based, matching `Pagination`; the service takes an offset.
    // Leaving the reader on page 2 of a result that now has one page shows an
    // empty table, which reads as "no matches" rather than "wrong page".
    const user = userEvent.setup();
    const list = vi.spyOn(logsApi, 'list');
    const requests = () => list.mock.calls.map(([request]) => request);
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    // Positive control: the reader really is off the first page before the
    // filter changes, so the assertion below is measuring a reset.
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(requests().map((request) => request.offset)).toContain(PAGE_SIZE);
    });

    await user.click(screen.getByRole('combobox', { name: /severity/i }));
    await user.click(await screen.findByRole('option', { name: /warning/i }));

    await waitFor(() => {
      expect(requests().some((request) => request.filters.severity === 'warning')).toBe(true);
    });
    // Every read of the narrowed set starts at the top of it — not just the
    // last one, which a later refetch could have supplied.
    expect(
      requests()
        .filter((request) => request.filters.severity === 'warning')
        .every((request) => request.offset === 0),
    ).toBe(true);
  });

  it('asks the service for the chosen sort, from the first page', async () => {
    // A re-sort reorders the whole result: page 2 of "newest first" is not
    // page 2 of "oldest first", so the reader goes back to the top.
    const user = userEvent.setup();
    const list = vi.spyOn(logsApi, 'list');
    const requests = () => list.mock.calls.map(([request]) => request);
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    expect(requests().every((request) => request.sort === 'newest')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(requests().map((request) => request.offset)).toContain(PAGE_SIZE);
    });

    await user.click(screen.getByRole('combobox', { name: /sort order/i }));
    await user.click(await screen.findByRole('option', { name: /oldest first/i }));

    await waitFor(() => {
      expect(requests().some((request) => request.sort === 'oldest')).toBe(true);
    });
    expect(
      requests()
        .filter((request) => request.sort === 'oldest')
        .every((request) => request.offset === 0),
    ).toBe(true);
  });

  it('tells an over-filtered investigator how to widen it', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    await user.type(screen.getByRole('searchbox', { name: /search/i }), 'zzzz-no-such-event');

    expect(await screen.findByText(/no events match — widen the time range/i)).toBeInTheDocument();
  });
});

describe('paging', () => {
  it('asks the service for the next window instead of holding the whole log', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(logsApi, 'list');
    const requests = () => list.mock.calls.map(([request]) => request);
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    // Positive control: the seeded platform genuinely has more than one page,
    // so the Next button below is enabled and the click is a real page change.
    expect(requests().map((request) => request.offset)).toContain(0);
    const nextPage = screen.getByRole('button', { name: 'Next page' });
    expect(nextPage).toBeEnabled();

    await user.click(nextPage);

    await waitFor(() => {
      expect(requests().map((request) => request.offset)).toContain(PAGE_SIZE);
    });
    // Never a wider window than the page it draws: `PAGE_SIZE` is what makes
    // "hold one page, not the log" true on this side of the seam.
    expect(requests().every((request) => request.limit === PAGE_SIZE)).toBe(true);
  });
});

/* ── The detail drawer ────────────────────────────────────────── */

function renderDrawer(event: LogEvent, onClose: () => void = () => undefined): HTMLElement {
  render(<LogDetailDrawer event={event} onClose={onClose} />);
  return screen.getByRole('dialog');
}

/**
 * The `<dd>` beside `label`, as text. Reading the pair rather than asserting
 * the value appears *somewhere* in the drawer is the difference between "the
 * IP is stated" and "that string is on screen": `203.0.113.9` is in the
 * payload too, and an em dash under the wrong label is a lie about a
 * different field.
 */
function factValue(scope: HTMLElement, label: string): string {
  const term = within(scope).getByText(label);
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement) || value.tagName !== 'DD') {
    throw new Error(`No <dd> beside "${label}"`);
  }
  return value.textContent ?? '';
}

/**
 * Replaces `navigator.clipboard` for one test. jsdom implements none, and
 * `userEvent.setup()` installs a stub of its own — so this has to be defined
 * *after* setup, and is removed again below. Asserting only that a copy
 * button exists would pass against a button wired to nothing.
 */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

describe('the detail drawer', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('opens the row it was asked about, and swaps the grid for the raw record', async () => {
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The second row, not the first: a drawer wired to `rows[0]` would open
    // with the right shape and the wrong event, and the timestamp in the
    // control's own label is what tells the two apart.
    const control = within(table).getAllByRole('button', { name: /view detail/i })[1];
    if (control === undefined) throw new Error('the table rendered fewer than two rows');
    const label = control.getAttribute('aria-label') ?? '';
    const stamp = label.slice(label.lastIndexOf(' at ') + ' at '.length);
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    await user.click(control);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/event id/i)).toBeInTheDocument();
    expect(factValue(drawer, 'Timestamp')).toBe(stamp);
    // The raw record is behind the toggle, so the assertion after the click
    // measures a switch rather than something that was on screen all along.
    expect(within(drawer).queryByText(/^\{/)).not.toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: /raw json/i }));

    expect(within(drawer).getByText(/^\{/)).toBeInTheDocument();
    // And it replaces the grid rather than being appended under it: the point
    // of the raw view is reading the record without this component's gloss.
    expect(within(drawer).queryByText(/event id/i)).not.toBeInTheDocument();
  });

  it('states every field, including the ones the table has no column for', () => {
    const drawer = renderDrawer(WITH_SOURCE);

    expect(factValue(drawer, 'Event ID')).toBe('login:d1:l1');
    expect(factValue(drawer, 'Timestamp')).toBe(localStamp(WITH_SOURCE.at));
    expect(factValue(drawer, 'Category')).toBe('Authentication');
    expect(factValue(drawer, 'Event')).toBe('Sign-in succeeded');
    expect(factValue(drawer, 'Severity')).toBe('Info');
    expect(factValue(drawer, 'Actor')).toBe('Dr. Yara Hassan');
    expect(factValue(drawer, 'Actor role')).toBe('Doctor');
    expect(factValue(drawer, 'Target')).toBe('LIC-4471');
    expect(factValue(drawer, 'IP address')).toBe('203.0.113.9');
    expect(factValue(drawer, 'Device')).toBe('Chrome 128 on macOS');
  });

  it('states an absent IP and an absent device separately, never a blank field', () => {
    // The table's rule, kept: opening a drawer does not invent an address for
    // a row whose source never recorded one.
    const drawer = renderDrawer(WITHOUT_SOURCE);

    expect(factValue(drawer, 'IP address')).toBe('—');
    expect(factValue(drawer, 'Device')).toBe('—');
  });

  it("lists the payload under the source's own field names", () => {
    // Not prettified: an investigator matching this against a server log needs
    // the key that log uses. Values are stringified, so a numeric status is
    // legible rather than absent.
    const drawer = renderDrawer(WITHOUT_SOURCE);

    expect(within(drawer).getByText('httpStatus').tagName).toBe('DT');
    expect(factValue(drawer, 'httpStatus')).toBe('502');
  });

  it('shows the whole event in the raw view, not a re-spelling of the grid', async () => {
    // The grid is this component's reading of the record; the raw view is the
    // record. A toggle that re-rendered the same ten fields would satisfy "a
    // raw JSON button exists" and be worth nothing in a security report.
    const user = userEvent.setup();
    const drawer = renderDrawer(WITH_SOURCE);

    await user.click(within(drawer).getByRole('button', { name: 'Raw JSON' }));

    const raw = within(drawer).getByText(/^\{/);
    expect(raw.tagName).toBe('PRE');
    const parsed: unknown = JSON.parse(raw.textContent ?? '');
    expect(parsed).toEqual(WITH_SOURCE);
  });

  it('copies an incident reference naming both the event and the instant', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    stubClipboard(writeText);
    const drawer = renderDrawer(WITH_SOURCE);

    await user.click(within(drawer).getByRole('button', { name: /copy incident reference/i }));

    // Spelled out rather than rebuilt from the fixture: a reference assembled
    // the same way the component assembles it would agree with any format,
    // including one no other system can look an event up by.
    expect(writeText).toHaveBeenCalledWith('login:d1:l1 @ 2026-08-14T09:15:22.481Z');
    expect(await within(drawer).findByText(/copied/i)).toBeInTheDocument();
  });

  it('survives a browser that refuses the clipboard, with the reference still readable', async () => {
    // Outside a secure context there is no `navigator.clipboard` at all, and
    // an unguarded call would take the drawer down with it.
    const user = userEvent.setup();
    Reflect.deleteProperty(navigator, 'clipboard');
    const drawer = renderDrawer(WITH_SOURCE);

    await user.click(within(drawer).getByRole('button', { name: /copy incident reference/i }));

    expect(within(drawer).getByText(/could not copy/i)).toBeInTheDocument();
    expect(within(drawer).getByText('login:d1:l1 @ 2026-08-14T09:15:22.481Z')).toBeInTheDocument();
  });

  it('closes, keeping no event behind it', async () => {
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    const [control] = within(table).getAllByRole('button', { name: /view detail/i });
    if (control === undefined) throw new Error('the table rendered no detail control');
    await user.click(control);
    const drawer = await screen.findByRole('dialog');

    await user.click(within(drawer).getByRole('button', { name: /^close$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

/* ── Saved views and export ───────────────────────────────────── */

/**
 * The saved-view list is keyed by name, and each row carries a delete control
 * naming the same view — so an unanchored `/criticals/i` matches two buttons.
 * The queries below are anchored for that reason, not for tidiness.
 */
const DAY_MS = 86_400_000;

/** The pager's post-filter count — the number the export has to match. */
function totalOnScreen(): number {
  const summary = screen.getByText(/showing .* of \d+/i).textContent ?? '';
  const match = /of (\d+)/.exec(summary);
  if (match?.[1] === undefined) throw new Error(`no total in "${summary}"`);
  return Number(match[1]);
}

/** jsdom's `Blob` has no `text()`, but `FileReader` reads it. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // `readAsText` resolves to a string or to null; an ArrayBuffer here
      // would mean the file was read as bytes, which is not what was asked.
      const text = reader.result;
      if (typeof text !== 'string') reject(new Error('the export did not read back as text'));
      else resolve(text);
    };
    reader.onerror = () => reject(new Error('the exported blob could not be read'));
    reader.readAsText(blob);
  });
}

/** One column of an exported JSON row, without asserting the whole shape. */
function columnOf(row: unknown, column: string): unknown {
  if (typeof row !== 'object' || row === null) return undefined;
  return Object.entries(row).find(([key]) => key === column)?.[1];
}

/**
 * Every flow below is two service round trips deep — a mutation, then the
 * refetch its invalidation triggers — and the mock service charges 260 ms a
 * call on top of aggregating four trails. Testing Library's one-second
 * default is shorter than that on a machine running the whole suite, so these
 * blocks wait longer before calling a slow read a failure. Restored after each
 * test so nothing else in the file inherits the longer patience.
 */
const SERVICE_ROUND_TRIPS_MS = 5000;
const LIBRARY_DEFAULT_MS = 1000;

describe('saved views', () => {
  beforeEach(() => {
    configure({ asyncUtilTimeout: SERVICE_ROUND_TRIPS_MS });
    // Saved views live in `localStorage`, which outlives a render. Without
    // this, a view created in one test is in the picker for the next one.
    window.localStorage.clear();
  });

  afterEach(() => {
    configure({ asyncUtilTimeout: LIBRARY_DEFAULT_MS });
  });

  it('applies a seeded view to the filters, and to the query behind them', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(logsApi, 'list');
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(await screen.findByRole('button', { name: /^admin phi access$/i }));

    await waitFor(() => {
      // The DS Select is a button whose label reflects the selection, so read
      // its text rather than a form value.
      expect(screen.getByRole('combobox', { name: /event type/i })).toHaveTextContent(
        /identifier revealed/i,
      );
    });
    // And the service was asked for that narrower log. Without this, a picker
    // that only moved the trigger's label would pass: this page holds one page
    // of a server-side filtered result, so the filter has to reach the request
    // or the table on screen is still the unfiltered one.
    await waitFor(() => {
      expect(list.mock.calls.at(-1)?.[0].filters.type).toBe('phi-revealed');
    });
    expect(list.mock.calls.at(-1)?.[0].offset).toBe(0);
  }, 20_000);

  it('applies the seeded seven-day window as a value the From field can hold', async () => {
    /*
     * The regression this pins. The seed used to store `from` as a full ISO
     * instant ending in `Z`; the HTML value-sanitisation algorithm blanks that
     * in a `datetime-local` input, so applying "Failed logins 7d" left the
     * table filtered by a window the bar rendered as empty — and the reader
     * had no way to see, widen or clear it.
     */
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(await screen.findByRole('button', { name: /^failed logins 7d$/i }));

    const field = screen.getByLabelText('From');
    if (!(field instanceof HTMLInputElement)) throw new Error('From is not an input');
    await waitFor(() => {
      expect(field.value).not.toBe('');
    });

    // Local wall clock, to the minute — the only shape the field can hold.
    expect(field.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    /*
     * And it means seven days, not seven days shifted by the reader's UTC
     * offset: `new Date('2026-08-10T03:05')` resolves locally, so a seed
     * written as UTC wall clock would land hours off on any machine that is
     * not on UTC.
     *
     * The slack has to clear the field's own precision, and it is asymmetric
     * because the truncation only ever runs one way. `toDateTimeLocalValue`
     * drops seconds, so the value parsed back sits up to 60s EARLIER than the
     * instant that was seeded, and `elapsed` carries that on top of the real
     * seed-to-assertion gap. A flat minute either side spent the whole budget
     * on truncation with nothing left for the test itself, and CI duly failed
     * whenever the seed landed late in a minute: 604860846 against a 604860000
     * ceiling, which is ~59.9s of truncation plus ~0.9s of elapsed time.
     *
     * A minute for the truncation, a minute for the clock. Two minutes is
     * still an order of magnitude below the smallest UTC-offset shift this is
     * guarding against, so nothing the assertion catches has been given away.
     */
    const TRUNCATION_MS = 60_000;
    const CLOCK_MS = 60_000;
    const elapsed = Date.now() - new Date(field.value).getTime();
    expect(elapsed).toBeGreaterThan(7 * DAY_MS - CLOCK_MS);
    expect(elapsed).toBeLessThan(7 * DAY_MS + TRUNCATION_MS + CLOCK_MS);
    // Longer than the five seconds the waits above are given, so a seed the
    // field cannot hold fails on the blank value it left rather than on the
    // clock running out around it.
  }, 20_000);

  it('saves the current filters as a new view, filters and all', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    // The design-system Select is a button + listbox, not a native <select>:
    // `user.selectOptions` throws "Value not found in options" against it.
    await user.click(screen.getByRole('combobox', { name: /severity/i }));
    await user.click(await screen.findByRole('option', { name: /critical/i }));
    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(screen.getByRole('button', { name: /save current filters/i }));
    await user.type(screen.getByRole('textbox', { name: /view name/i }), 'Criticals');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('button', { name: /^criticals$/i })).toBeInTheDocument();

    /*
     * A view that stored only its name would satisfy the assertion above and
     * be worth nothing: the filters are the whole point. Clearing and
     * re-applying is the only way to see what was actually kept.
     */
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /severity/i })).toHaveTextContent(
        /all severities/i,
      );
    });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(await screen.findByRole('button', { name: /^criticals$/i }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /severity/i })).toHaveTextContent(/critical/i);
    });
  }, 20_000);

  it('removes only the view it was asked to remove', async () => {
    const user = userEvent.setup();
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });

    await user.click(screen.getByRole('button', { name: /saved views/i }));
    await user.click(await screen.findByRole('button', { name: /delete saved view admin phi/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^admin phi access$/i })).not.toBeInTheDocument();
    });
    // The other seeded view is untouched — a delete wired to the wrong id, or
    // to the whole list, would empty the picker instead.
    expect(screen.getByRole('button', { name: /^failed logins 7d$/i })).toBeInTheDocument();
  }, 20_000);
});

describe('export', () => {
  beforeEach(() => {
    configure({ asyncUtilTimeout: SERVICE_ROUND_TRIPS_MS });
    window.localStorage.clear();
    /*
     * The export runs for real, all the way through `utils/export`. jsdom
     * implements no navigation, so the anchor that hands the file over raises
     * an unimplemented-navigation error; this silences that one click and
     * nothing else.
     */
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    configure({ asyncUtilTimeout: LIBRARY_DEFAULT_MS });
  });

  it('logs its own export, so it shows up in the log it came from', async () => {
    const user = userEvent.setup();
    renderLogs();
    const table = await screen.findByRole('table', { name: /system log/i });

    /*
     * Counted rather than merely looked for: the corpus already carries a
     * seeded 'Exported patient summary', which the taxonomy classifies as
     * `data-export` and the table prints as "Data exported". Asserting the
     * label appears *somewhere* would pass against an Export button wired to
     * nothing at all.
     */
    const before = within(table).queryAllByText('Data exported').length;

    await user.click(screen.getByRole('button', { name: /^export$/i }));
    await user.click(await screen.findByRole('menuitem', { name: /csv/i }));

    await waitFor(() => {
      const rows = within(screen.getByRole('table', { name: /system log/i }));
      expect(rows.queryAllByText('Data exported').length).toBe(before + 1);
    });
    // And the new row is the export itself, saying how much left the platform
    // — not some other admin action that happens to share the type.
    expect(screen.getByText(/^Exported \d+ log rows as CSV/)).toBeInTheDocument();
  }, 20_000);

  it('writes the rows the filters select, not the whole log', async () => {
    /*
     * The trap: an export that quietly ignores the filters and ships the
     * entire audit trail. In a PHI-governed platform that is a silent
     * over-disclosure, so the claim is made against the bytes of the file —
     * its row count against the post-filter total the pager is showing, and
     * every row's severity against the one that was asked for.
     */
    const user = userEvent.setup();
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    renderLogs();
    await screen.findByRole('table', { name: /system log/i });
    const unfiltered = totalOnScreen();

    await user.click(screen.getByRole('combobox', { name: /severity/i }));
    await user.click(await screen.findByRole('option', { name: /critical/i }));
    // Positive control: the filter genuinely narrows the log, so the count
    // asserted below is not the whole corpus by coincidence.
    await waitFor(() => {
      expect(totalOnScreen()).toBeLessThan(unfiltered);
    });
    const filtered = totalOnScreen();
    expect(filtered).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /^export$/i }));
    await user.click(await screen.findByRole('menuitem', { name: /json/i }));

    await waitFor(() => {
      expect(objectUrl).toHaveBeenCalled();
    });
    const written = objectUrl.mock.calls.at(-1)?.[0];
    if (!(written instanceof Blob)) throw new Error('no file was handed to the browser');
    const parsed: unknown = JSON.parse(await readBlob(written));
    if (!Array.isArray(parsed)) throw new Error('the export was not a JSON array');

    expect(parsed).toHaveLength(filtered);
    expect(parsed.every((row) => columnOf(row, 'Severity') === 'Critical')).toBe(true);
  }, 20_000);
});

/* ── Responsive containment ───────────────────────────────────── */

/**
 * The table is ~972px of columns. On a phone or tablet it must scroll inside
 * its own region and never widen the page.
 *
 * The page-level overflow came from the Detail header's `sr-only` label: it
 * is `position: absolute`, and an overflow container clips only the absolute
 * descendants it is the containing block for. jsdom does no layout, so the
 * page-width claim itself was verified in a real browser at 375 / 768 / 1440;
 * what these tests pin is the contract that makes it true, plus the
 * keyboard-region behaviour, at the geometry each viewport produced there.
 */
function stubScrollerGeometry(scrollWidth: number, clientWidth: number) {
  const proto = window.HTMLElement.prototype;
  const scrollDescriptor = Object.getOwnPropertyDescriptor(proto, 'scrollWidth');
  const clientDescriptor = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
  Object.defineProperty(proto, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'DIV' ? scrollWidth : 0;
    },
  });
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'DIV' ? clientWidth : 0;
    },
  });
  return () => {
    if (scrollDescriptor) Object.defineProperty(proto, 'scrollWidth', scrollDescriptor);
    if (clientDescriptor) Object.defineProperty(proto, 'clientWidth', clientDescriptor);
  };
}

const SCROLL_REGION = 'System log events, scrolls horizontally';
const ALL_HEADERS = ['Timestamp', 'Severity', 'Actor', 'Event', 'Summary', 'IP / device', 'Detail'];

/** Scroller width : table width, as measured in Chrome at each viewport. */
const VIEWPORTS = [
  { name: 'mobile (375px)', scrollWidth: 972, clientWidth: 301, scrolls: true },
  { name: 'tablet (768px)', scrollWidth: 972, clientWidth: 678, scrolls: true },
  { name: 'desktop (1440px)', scrollWidth: 1110, clientWidth: 1110, scrolls: false },
] as const;

describe('responsive containment', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  describe.each(VIEWPORTS)('at $name', ({ scrollWidth, clientWidth, scrolls }) => {
    it('keeps every column, and every header over its own cells', () => {
      restore = stubScrollerGeometry(scrollWidth, clientWidth);
      renderTable([WITH_SOURCE, WITHOUT_SOURCE]);

      const table = screen.getByRole('table', { name: 'System log events' });
      const headers = within(table).getAllByRole('columnheader');
      expect(headers.map((th) => th.textContent)).toEqual(ALL_HEADERS);
      // One table, one row model: each body row has exactly one cell per
      // header, so no column is dropped or split off at this width.
      for (const row of within(table).getAllByRole('row').slice(1)) {
        expect(within(row).getAllByRole('cell')).toHaveLength(ALL_HEADERS.length);
      }
    });

    it('scrolls inside the table region, which contains its own positioned labels', () => {
      restore = stubScrollerGeometry(scrollWidth, clientWidth);
      renderTable([WITH_SOURCE]);

      const table = screen.getByRole('table', { name: 'System log events' });
      const scroller = table.parentElement;
      // `relative` makes the scroller the containing block for the `sr-only`
      // Detail label; without it that label escaped and widened the page.
      expect(scroller).toHaveClass('relative', 'overflow-x-auto');
      const detailLabel = within(table).getByText('Detail');
      expect(detailLabel).toHaveClass('sr-only');
      expect(scroller).toContainElement(detailLabel);
    });

    it(
      scrolls
        ? 'exposes the scroller as a named, focusable region'
        : 'adds no tab stop and no region when the columns fit',
      () => {
        restore = stubScrollerGeometry(scrollWidth, clientWidth);
        renderTable([WITH_SOURCE]);

        const scroller = screen.getByRole('table', { name: 'System log events' }).parentElement;
        if (scrolls) {
          const region = screen.getByRole('region', { name: SCROLL_REGION });
          expect(region).toBe(scroller);
          expect(region).toHaveAttribute('tabindex', '0');
        } else {
          expect(screen.queryByRole('region', { name: SCROLL_REGION })).not.toBeInTheDocument();
          expect(scroller).not.toHaveAttribute('tabindex');
        }
      },
    );

    it('keeps pivots and the detail action working', async () => {
      restore = stubScrollerGeometry(scrollWidth, clientWidth);
      const user = userEvent.setup();
      const onPivot = vi.fn();
      const onOpen = vi.fn();
      renderTable([WITH_SOURCE], { onPivot, onOpen });

      if (scrolls) {
        // Keyboard: the region is the tab stop before the row's first control.
        await user.tab();
        expect(screen.getByRole('region', { name: SCROLL_REGION })).toHaveFocus();
      }
      await user.click(screen.getByRole('button', { name: `Filter by actor ${WITH_SOURCE.actor}` }));
      expect(onPivot).toHaveBeenCalledWith('actor', WITH_SOURCE.actor);
      await user.click(screen.getByRole('button', { name: /^View detail for/ }));
      expect(onOpen).toHaveBeenCalledWith(WITH_SOURCE);
    });
  });
});
