import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import type { CriticalAlert } from '../model/critical-alerts';
import type { DashboardOverview } from '../model/dashboard-service';
import { MOCK_KPIS, MOCK_NOTIFICATIONS, MOCK_SCHEDULE } from '../model/mock-data';
import { DASHBOARD_WIDGETS } from '../model/widgets';
import { dashboardService } from '../service';

import { OverviewPage } from './OverviewPage';

/**
 * jsdom has no modal dialogs; the Drawer is a native <dialog>. Enough of one
 * to open and close it — the same stub the records suite uses.
 */
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/**
 * MemoryRouter wraps AppProviders, not the other way round: AppProviders
 * composes AuthProvider and DoctorProfileProvider, and a provider reaching
 * for a router hook outside a Router throws.
 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/doctor/overview']}>
      <AppProviders>
        <OverviewPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

function widgetList() {
  return screen.getByRole('list', { name: 'Dashboard widgets' });
}

/** Titles of the widgets on the dashboard, in the order they render. */
function dashboardTitles(): string[] {
  return within(widgetList())
    .getAllByRole('listitem')
    .filter((item) => item.hasAttribute('data-widget-id'))
    .map((item) => within(item).getAllByRole('heading')[0]?.textContent ?? '');
}

async function openCustomize(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Customize' })[0]!);
  return screen.getByRole('dialog', { name: 'Customize dashboard' });
}

async function setWidget(
  user: ReturnType<typeof userEvent.setup>,
  drawer: HTMLElement,
  title: string,
  on: boolean,
) {
  const control = within(drawer).getByRole('checkbox', { name: title });
  if ((control as HTMLInputElement).checked !== on) await user.click(control);
}

describe('OverviewPage · first visit', () => {
  it('opens with no widgets and invites the doctor to customize', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Dashboard widgets' })).not.toBeInTheDocument();

    for (const widget of DASHBOARD_WIDGETS) {
      expect(screen.queryByRole('heading', { name: widget.title })).not.toBeInTheDocument();
    }
  });

  it('keeps one h1 — the greeting — above the empty state', () => {
    renderPage();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(/^Good (morning|afternoon|evening), /);
  });
});

describe('OverviewPage · customize control', () => {
  it('reads "Customize" with the widget-plus icon, in both places it appears', async () => {
    const user = userEvent.setup();
    renderPage();

    // Empty state first, then the header once a widget is on the dashboard.
    const emptyButton = screen.getByRole('button', { name: 'Customize' });
    expect(emptyButton).toHaveTextContent(/^Customize$/);
    expect(emptyButton.querySelector('svg.lucide-dashboard-widget-add')).toBeInTheDocument();

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    const headerButton = screen.getByRole('button', { name: 'Customize' });
    expect(headerButton).toHaveTextContent(/^Customize$/);
    expect(headerButton.querySelector('svg.lucide-dashboard-widget-add')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /customize dashboard/i })).not.toBeInTheDocument();
  });
});

/**
 * Shared with the Admin Overview: the control reads "Customize" while the
 * dashboard has no widgets — drawer open or not — and becomes a square icon
 * only once a widget has been added. Open appointments sits beside the
 * labelled button and nothing about it changes while the drawer is open.
 */
describe('OverviewPage · customize button follows the widgets on the dashboard', () => {
  const customize = () => screen.getByRole('button', { name: 'Customize' });
  const look = (button: HTMLElement) =>
    within(button).getByText('Customize').classList.contains('sr-only') ? 'icon-only' : 'labelled';

  it('keeps the label, and Open appointments beside it, while the drawer is open', async () => {
    const user = userEvent.setup();
    renderPage();
    const appointments = screen.getByRole('link', { name: 'Open appointments' });
    const row = appointments.parentElement;
    const before = row?.innerHTML;
    expect(look(customize())).toBe('labelled');
    expect(row).toContainElement(customize());

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', true);
    expect(look(customize())).toBe('labelled');
    // The row around both controls is exactly as it was: nothing reflows.
    expect(screen.getByRole('link', { name: 'Open appointments' }).parentElement?.innerHTML).toBe(
      before,
    );

    await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    expect(look(customize())).toBe('labelled');
  });

  it('is a square icon once a widget is added, and labelled again when the last goes', async () => {
    const user = userEvent.setup();
    renderPage();
    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    expect(look(customize())).toBe('icon-only');
    expect(customize()).toHaveClass('w-8', 'h-8', 'px-0');
    expect(customize()).toHaveAccessibleName('Customize');

    await user.click(screen.getByRole('button', { name: 'Notifications options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
    expect(look(customize())).toBe('labelled');
    expect(screen.getByRole('link', { name: 'Open appointments' })).toBeInTheDocument();
  });
});

describe('OverviewPage · customizing', () => {
  it('lists every catalogue widget in the drawer, each unchecked', async () => {
    const user = userEvent.setup();
    renderPage();

    const drawer = await openCustomize(user);
    const checkboxes = within(drawer).getAllByRole('checkbox');

    expect(checkboxes).toHaveLength(DASHBOARD_WIDGETS.length);
    checkboxes.forEach((control) => {
      expect(control).not.toBeChecked();
    });
    expect(
      within(drawer).getByText(`0 of ${String(DASHBOARD_WIDGETS.length)} widgets selected`),
    ).toBeInTheDocument();
  });

  it('adds what the doctor selects, in the order they select it', async () => {
    const user = userEvent.setup();
    renderPage();

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, "Today's schedule", true);
    await setWidget(user, drawer, 'Practice pulse', true);
    await setWidget(user, drawer, 'Recent activity', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    expect(dashboardTitles()).toEqual(["Today's schedule", 'Practice pulse', 'Recent activity']);
    expect(
      screen.queryByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).not.toBeInTheDocument();
  });

  it('removes a widget from its own menu, closes the gap, and offers it again', async () => {
    const user = userEvent.setup();
    renderPage();

    let drawer = await openCustomize(user);
    await setWidget(user, drawer, "Today's schedule", true);
    await setWidget(user, drawer, 'Practice pulse', true);
    await setWidget(user, drawer, 'Recent activity', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Practice pulse options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));

    // Gone, and the survivors are the only items — nothing holds its place.
    expect(dashboardTitles()).toEqual(["Today's schedule", 'Recent activity']);
    expect(widgetList().children).toHaveLength(2);

    // Focus did not fall to <body> with the menu that was removed.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Customize' })).toHaveFocus();
    });

    drawer = await openCustomize(user);
    expect(within(drawer).getByRole('checkbox', { name: 'Practice pulse' })).not.toBeChecked();
    await setWidget(user, drawer, 'Practice pulse', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    // Re-added widgets join the end; nothing else moves.
    expect(dashboardTitles()).toEqual(["Today's schedule", 'Recent activity', 'Practice pulse']);
  });

  it('puts a removed widget back where it was on Undo', async () => {
    const user = userEvent.setup();
    renderPage();

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', true);
    await setWidget(user, drawer, 'Pending requests', true);
    await setWidget(user, drawer, 'Quick actions', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Pending requests options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
    expect(dashboardTitles()).toEqual(['Notifications', 'Quick actions']);

    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(dashboardTitles()).toEqual(['Notifications', 'Pending requests', 'Quick actions']);
  });

  it('returns to the empty state when the last widget goes', async () => {
    const user = userEvent.setup();
    renderPage();

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Medora AI', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Medora AI options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));

    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Customize' })).toHaveFocus();
    });
  });

  it('clears the whole dashboard from the drawer', async () => {
    const user = userEvent.setup();
    renderPage();

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', true);
    await setWidget(user, drawer, 'Appointments trend', true);
    await user.click(within(drawer).getByRole('button', { name: 'Remove all' }));

    within(drawer)
      .getAllByRole('checkbox')
      .forEach((control) => {
        expect(control).not.toBeChecked();
      });
    expect(within(drawer).getByRole('button', { name: 'Remove all' })).toBeDisabled();
  });
});

/**
 * The customize drawer edits a draft. The dashboard behind it — and what is
 * stored — changes only on Done; every other way out discards the draft.
 */
describe('OverviewPage · draft until Done', () => {
  const STORED_SUFFIX = '.dashboardWidgets';

  /** Every write of the doctor's widget selection to storage. */
  function selectionWrites(spy: { mock: { calls: unknown[][] } }): unknown[][] {
    return spy.mock.calls.filter((call) => String(call[0]).endsWith(STORED_SUFFIX));
  }

  /** Saves a starting selection through the UI, the way a doctor would. */
  async function commit(user: ReturnType<typeof userEvent.setup>, titles: string[]) {
    const drawer = await openCustomize(user);
    for (const title of titles) await setWidget(user, drawer, title, true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));
  }

  it('opens with a draft copied from the saved selection, leaving the dashboard as it was', async () => {
    const user = userEvent.setup();
    renderPage();
    await commit(user, ['Notifications', 'Quick actions']);

    const drawer = await openCustomize(user);

    expect(within(drawer).getByRole('checkbox', { name: 'Notifications' })).toBeChecked();
    expect(within(drawer).getByRole('checkbox', { name: 'Quick actions' })).toBeChecked();
    expect(within(drawer).getByRole('checkbox', { name: 'Practice pulse' })).not.toBeChecked();
    expect(
      within(drawer).getByText(`2 of ${String(DASHBOARD_WIDGETS.length)} widgets selected`),
    ).toBeInTheDocument();
    expect(dashboardTitles()).toEqual(['Notifications', 'Quick actions']);
  });

  it('selecting a widget changes only the draft — not the dashboard, not storage', async () => {
    const user = userEvent.setup();
    renderPage();
    await commit(user, ['Notifications']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Practice pulse', true);

    expect(within(drawer).getByRole('checkbox', { name: 'Practice pulse' })).toBeChecked();
    expect(dashboardTitles()).toEqual(['Notifications']);
    expect(screen.queryByRole('heading', { name: 'Practice pulse' })).not.toBeInTheDocument();
    expect(selectionWrites(setItem)).toHaveLength(0);
  });

  it('deselecting a widget changes only the draft — the dashboard still shows it', async () => {
    const user = userEvent.setup();
    renderPage();
    await commit(user, ['Notifications', 'Quick actions']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', false);

    expect(within(drawer).getByRole('checkbox', { name: 'Notifications' })).not.toBeChecked();
    expect(dashboardTitles()).toEqual(['Notifications', 'Quick actions']);
    expect(selectionWrites(setItem)).toHaveLength(0);
  });

  it('keeps the empty state while the first widgets are only drafted', async () => {
    const user = userEvent.setup();
    renderPage();

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, "Today's schedule", true);

    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Dashboard widgets' })).not.toBeInTheDocument();
  });

  it('never updates the dashboard across a run of changes before Done', async () => {
    const user = userEvent.setup();
    renderPage();
    await commit(user, ['Notifications', 'Quick actions']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const drawer = await openCustomize(user);
    const steps: [string, boolean][] = [
      ['Practice pulse', true],
      ['Notifications', false],
      ['Recent activity', true],
      ['Practice pulse', false],
      ['Quick actions', false],
      ['Notifications', true],
    ];
    for (const [title, on] of steps) {
      await setWidget(user, drawer, title, on);
      expect(dashboardTitles()).toEqual(['Notifications', 'Quick actions']);
    }
    expect(selectionWrites(setItem)).toHaveLength(0);
  });

  it('applies and persists the draft on Done, in the order it was built', async () => {
    const user = userEvent.setup();
    renderPage();
    await commit(user, ['Notifications', 'Quick actions']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', false);
    await setWidget(user, drawer, 'Recent activity', true);
    await setWidget(user, drawer, 'Practice pulse', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    // The dashboard applies at once; the panel then plays its 700ms exit
    // before the dialog closes (useModalDialog), so its closing is awaited.
    expect(dashboardTitles()).toEqual(['Quick actions', 'Recent activity', 'Practice pulse']);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Customize dashboard' })).not.toBeInTheDocument();
    });
    const writes = selectionWrites(setItem);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0]?.[1]))).toEqual([
      'quick-actions',
      'recent-activity',
      'practice-pulse',
    ]);
  });

  it.each([
    [
      'Cancel',
      async (user: ReturnType<typeof userEvent.setup>, drawer: HTMLElement) => {
        await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));
      },
    ],
    [
      'the close button',
      async (user: ReturnType<typeof userEvent.setup>, drawer: HTMLElement) => {
        await user.click(within(drawer).getByRole('button', { name: 'Close panel' }));
      },
    ],
    [
      'Escape',
      async (_user: ReturnType<typeof userEvent.setup>, drawer: HTMLElement) => {
        // The native <dialog> turns Escape into a `cancel` event; jsdom does not.
        drawer.dispatchEvent(new Event('cancel'));
        await Promise.resolve();
      },
    ],
  ])('discards the draft on %s and reopens on the saved selection', async (_how, close) => {
    const user = userEvent.setup();
    renderPage();
    await commit(user, ['Notifications', 'Quick actions']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    let drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', false);
    await setWidget(user, drawer, 'Practice pulse', true);
    await close(user, drawer);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Customize dashboard' })).not.toBeInTheDocument();
    });
    expect(dashboardTitles()).toEqual(['Notifications', 'Quick actions']);
    expect(selectionWrites(setItem)).toHaveLength(0);

    drawer = await openCustomize(user);
    expect(within(drawer).getByRole('checkbox', { name: 'Notifications' })).toBeChecked();
    expect(within(drawer).getByRole('checkbox', { name: 'Quick actions' })).toBeChecked();
    expect(within(drawer).getByRole('checkbox', { name: 'Practice pulse' })).not.toBeChecked();
  });

  it('drops an unconfirmed draft when the page goes away mid-edit', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    await commit(user, ['Notifications']);

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Notifications', false);
    await setWidget(user, drawer, 'Practice pulse', true);
    first.unmount();

    renderPage();
    expect(dashboardTitles()).toEqual(['Notifications']);
  });

  it('"Remove all" empties only the draft until Done', async () => {
    const user = userEvent.setup();
    renderPage();
    await commit(user, ['Notifications', 'Quick actions']);

    const drawer = await openCustomize(user);
    await user.click(within(drawer).getByRole('button', { name: 'Remove all' }));
    expect(dashboardTitles()).toEqual(['Notifications', 'Quick actions']);

    await user.click(within(drawer).getByRole('button', { name: 'Done' }));
    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
  });

  it('says so when storage refuses the save, instead of passing it off as saved', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    // Storage refuses the selection (quota, private mode); other keys are not under test.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key.endsWith(STORED_SUFFIX)) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
    });

    await commit(user, ['Notifications']);

    // The choice shows for this visit…
    expect(dashboardTitles()).toEqual(['Notifications']);
    // …and the doctor is told it was not kept.
    expect(await screen.findByText('Your dashboard could not be saved')).toBeInTheDocument();

    // Nothing reached storage, so a reload is back to the empty dashboard.
    setItem.mockRestore();
    first.unmount();
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
  });
});

describe('OverviewPage · persistence', () => {
  it('keeps the selection across a remount, as after a refresh or navigating back', async () => {
    const user = userEvent.setup();
    const first = renderPage();

    const drawer = await openCustomize(user);
    await setWidget(user, drawer, 'Completed this week', true);
    await setWidget(user, drawer, 'Patient satisfaction', true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));
    first.unmount();

    renderPage();
    expect(dashboardTitles()).toEqual(['Completed this week', 'Patient satisfaction']);
  });
});

describe('OverviewPage · standing rules', () => {
  /**
   * FRONTEND_CHECKLIST §10.6: critical alerts must never live behind a closed
   * disclosure. The page no longer has disclosures at all; this keeps it that
   * way for the notifications widget wherever the doctor places it.
   */
  it('never puts the notifications widget behind a collapsible section', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    const drawer = await openCustomize(user);
    for (const widget of DASHBOARD_WIDGETS) await setWidget(user, drawer, widget.title, true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    // Widgets mount on Done and fade in (Reveal), so wait out the entrance.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    });
    expect(container.querySelectorAll('[data-collapsible-panel]')).toHaveLength(0);
  });
});

/**
 * FE-10.4 — the Overview as a live build sees it: the server answers the
 * KPIs, the schedule and the decision list, and has no source for the
 * analytics and activity widgets. Those must say so, not show figures, and
 * every widget reads the one document the page asked for — none of them the
 * fixture module.
 */
describe('OverviewPage · against a source with gaps', () => {
  const LOAD = { timeout: 5000 };

  /** What the API serves: real figures where it has them, null elsewhere. */
  const LIVE_SHAPED: DashboardOverview = {
    kpis: MOCK_KPIS,
    schedule: MOCK_SCHEDULE,
    pendingRequests: 1,
    alerts: MOCK_NOTIFICATIONS,
    statistics: null,
    trend: null,
    satisfaction: null,
    activity: null,
    failedSections: [],
  };

  async function addWidgets(user: ReturnType<typeof userEvent.setup>, titles: string[]) {
    const drawer = await openCustomize(user);
    for (const title of titles) await setWidget(user, drawer, title, true);
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));
  }

  it('says a widget has no source instead of showing a number', async () => {
    vi.spyOn(dashboardService, 'getOverview').mockResolvedValue(LIVE_SHAPED);
    const user = userEvent.setup();
    renderPage();

    await addWidgets(user, [
      'Practice pulse',
      'Appointments trend',
      'Patient satisfaction',
      'Recent activity',
    ]);

    expect(
      await within(widgetList()).findAllByText('Not available yet', undefined, LOAD),
    ).toHaveLength(4);
    expect(screen.queryByText('Avg. consultation duration')).not.toBeInTheDocument();
  });

  it("shows a metric tile with the source's figure, not the fixture's", async () => {
    vi.spyOn(dashboardService, 'getOverview').mockResolvedValue({
      ...LIVE_SHAPED,
      kpis: MOCK_KPIS.map((kpi) => (kpi.id === 'pending-requests' ? { ...kpi, value: '42' } : kpi)),
    });
    const user = userEvent.setup();
    renderPage();

    await addWidgets(user, ['Pending requests']);

    expect(await within(widgetList()).findByText('42', undefined, LOAD)).toBeInTheDocument();
  });

  it('shows a failed load as a failure in the widgets, with Retry', async () => {
    const getOverview = vi
      .spyOn(dashboardService, 'getOverview')
      .mockRejectedValue(Object.assign(new Error('API error: server'), { kind: 'server' }));
    const user = userEvent.setup();
    renderPage();

    await addWidgets(user, [
      "Today's schedule",
      'Notifications',
      'Pending requests',
      'Practice pulse',
    ]);

    expect(
      await screen.findByText("Couldn't load today's schedule", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't load notifications")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load pending requests")).toBeInTheDocument();
    // A failure is not "the server has no source" — it is a failure.
    expect(within(widgetList()).queryByText('Not available yet')).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load practice pulse")).toBeInTheDocument();
    // Nor is a failure a count of zero.
    expect(within(widgetList()).queryByText(/\b0 appointments\b/)).not.toBeInTheDocument();

    const before = getOverview.mock.calls.length;
    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLElement);
    await waitFor(() => {
      expect(getOverview.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('fails only the widget whose section failed, and its Retry reloads', async () => {
    const getOverview = vi
      .spyOn(dashboardService, 'getOverview')
      .mockResolvedValue({ ...LIVE_SHAPED, failedSections: ['trend'] });
    const user = userEvent.setup();
    renderPage();

    await addWidgets(user, ['Appointments trend', 'Pending requests', "Today's schedule"]);

    expect(
      await screen.findByText("Couldn't load appointments trend", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load pending requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load today's schedule")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(widgetList()).getByText(MOCK_SCHEDULE[0]?.patientName ?? '?')).toBeVisible();
    });

    const before = getOverview.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(getOverview.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('fails practice pulse alone when its counts failed', async () => {
    vi.spyOn(dashboardService, 'getOverview').mockResolvedValue({
      ...LIVE_SHAPED,
      failedSections: ['pulse'],
    });
    const user = userEvent.setup();
    renderPage();

    await addWidgets(user, ['Practice pulse', 'Pending requests']);

    expect(
      await screen.findByText("Couldn't load practice pulse", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load pending requests")).not.toBeInTheDocument();
    // A failure is not "no source": the pulse offers Retry, not "Not available yet".
    expect(within(widgetList()).queryByText('Not available yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows the served no-show rate with its denominator, and no fixture metric', async () => {
    vi.spyOn(dashboardService, 'getOverview').mockResolvedValue({
      ...LIVE_SHAPED,
      statistics: [
        {
          id: 'no-show-rate',
          label: 'No-show rate (30d)',
          value: '4.2%',
          caption: '3 of 72 appointments',
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();

    await addWidgets(user, ['Practice pulse']);

    expect(await within(widgetList()).findByText('4.2%', undefined, LOAD)).toBeInTheDocument();
    expect(within(widgetList()).getByText('3 of 72 appointments')).toBeInTheDocument();
    expect(screen.queryByText('Avg. consultation duration')).not.toBeInTheDocument();
    expect(screen.queryByText('Request response time')).not.toBeInTheDocument();
  });

  it('counts today and the waiting requests from the source, in the greeting', async () => {
    vi.spyOn(dashboardService, 'getOverview').mockResolvedValue({
      ...LIVE_SHAPED,
      schedule: MOCK_SCHEDULE.slice(0, 2),
      pendingRequests: 0,
      alerts: [],
    });
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(
        /2 appointments today · 0 requests need your decision/,
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();

    await addWidgets(user, ['Notifications']);
    expect(await screen.findByText('Nothing needs your attention.')).toBeInTheDocument();
  });
});

describe('OverviewPage · Row 0 critical alerts', () => {
  const LOAD = { timeout: 5000 };

  const ALERT: CriticalAlert = {
    id: 'lab-LAB-1',
    kind: 'unreviewed-critical-lab',
    patientName: 'Khaled Nassar',
    message: 'Potassium — critical value awaiting review',
    detail: 'Ordered 3 h ago',
    href: '/doctor/labs/LAB-1',
  };

  const serverFailure = () => Object.assign(new Error('API error: server'), { kind: 'server' });

  it('stands above an empty dashboard, which no widget choice can remove', async () => {
    vi.spyOn(dashboardService, 'getCriticalAlerts').mockResolvedValue({
      served: true,
      alerts: [ALERT],
    });
    renderPage();

    const banner = await screen.findByRole('alert', undefined, LOAD);
    expect(banner).toHaveTextContent('1 critical alert needs your attention');
    expect(
      within(banner).getByRole('link', { name: /^Review result — Khaled Nassar/ }),
    ).toHaveAttribute('href', '/doctor/labs/LAB-1');
    const emptyState = screen.getByText('Your dashboard is ready to customize');
    // Row 0: before everything the doctor composes.
    expect(
      banner.compareDocumentPosition(emptyState) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('still shows the alerts when the rest of the overview fails to load', async () => {
    vi.spyOn(dashboardService, 'getOverview').mockRejectedValue(serverFailure());
    vi.spyOn(dashboardService, 'getCriticalAlerts').mockResolvedValue({
      served: true,
      alerts: [ALERT],
    });
    renderPage();

    expect(await screen.findByRole('alert', undefined, LOAD)).toHaveTextContent('Khaled Nassar');
  });

  it('says it could not check, and checks again on request, without taking the page down', async () => {
    const getCriticalAlerts = vi
      .spyOn(dashboardService, 'getCriticalAlerts')
      .mockRejectedValue(serverFailure());
    const user = userEvent.setup();
    renderPage();

    const banner = await screen.findByRole('alert', undefined, LOAD);
    expect(banner).toHaveTextContent("Couldn't check for critical alerts");
    expect(screen.getByText('Your dashboard is ready to customize')).toBeInTheDocument();

    getCriticalAlerts.mockResolvedValue({ served: true, alerts: [] });
    await user.click(within(banner).getByRole('button', { name: 'Check again' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('says nothing against an API that does not serve the route', async () => {
    const getCriticalAlerts = vi
      .spyOn(dashboardService, 'getCriticalAlerts')
      .mockResolvedValue({ served: false });
    renderPage();

    await waitFor(() => expect(getCriticalAlerts).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
