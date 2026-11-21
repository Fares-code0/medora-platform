import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPreference } from '@/services/preferences';

import { doctorsService } from '../doctors/api/service';
import { PhiAccessProvider } from '../phi';

import { AdminOverviewSection } from './AdminOverviewSection';
import { ADMIN_WIDGETS } from './widgets';

/**
 * The Admin Overview as a dashboard the administrator composes — the same
 * behaviour the Doctor Overview's `OverviewPage.test.tsx` pins, over the
 * admin catalogue. What each widget shows is `AdminOverviewSection.test.tsx`.
 */

interface ToastCall {
  title: string;
  action?: { label: string; onClick: () => void };
}

const toast = vi.fn<(call: ToastCall) => void>();

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => true,
  useToast: () => ({ toast }),
}));

/** jsdom has no modal dialogs; the Drawer is a native <dialog>. */
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  window.localStorage.clear();
  toast.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The query client of the overview the current test rendered. */
let queryClient: QueryClient | undefined;

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  queryClient = client;
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin']}>
          <PhiAccessProvider>{children}</PhiAccessProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <AdminOverviewSection />
    </Tree>,
  );
}

function widgetList() {
  return screen.getByRole('list', { name: 'Dashboard widgets' });
}

/** Ids of the widgets on the dashboard, in the order they render. */
function dashboardIds(): string[] {
  return within(widgetList())
    .getAllByRole('listitem')
    .filter((item) => item.hasAttribute('data-widget-id'))
    .map((item) => item.dataset['widgetId'] ?? '');
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

async function addWidgets(user: ReturnType<typeof userEvent.setup>, titles: readonly string[]) {
  const drawer = await openCustomize(user);
  for (const title of titles) await setWidget(user, drawer, title, true);
  await user.click(within(drawer).getByRole('button', { name: 'Done' }));
  await widgetsSettled();
}

/**
 * Waits until no widget query is in flight.
 *
 * These tests are about customizing a dashboard, not about its loading
 * states, so they act on a settled one. Until 2026-11-14 that was also a
 * correctness requirement: `DocumentMetric` rendered its ⋯ menu in a
 * different tree while loading, so data landing mid-interaction replaced an
 * open menu, and "D · stays icon-only while widgets remain" failed in CI
 * that way. The menu now survives the transition — the loading-specific
 * behaviour is covered by "widget menu across loading" below — and the wait
 * stays so that every other test here keeps a single, settled state.
 */
async function widgetsSettled() {
  await waitFor(() => expect(queryClient?.isFetching()).toBe(0), { timeout: 5_000 });
}

describe('Admin Overview · first visit', () => {
  it('opens with no widgets and invites the administrator to customize', () => {
    renderOverview();

    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
    // Only the empty state's control: the header's appears once there is
    // something on the dashboard to customize.
    expect(screen.getAllByRole('button', { name: 'Customize' })).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Dashboard widgets' })).not.toBeInTheDocument();

    for (const widget of ADMIN_WIDGETS) {
      expect(screen.queryByText(widget.title)).not.toBeInTheDocument();
    }
  });

  it('keeps the security banner above the empty dashboard, because it is not a widget', async () => {
    // §3.1 makes the banner undismissable. A dashboard that starts empty must
    // not start without it.
    renderOverview();

    expect(await screen.findByText(/unresolved security/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
  });

  it('keeps one h1 — the greeting — above the empty state', () => {
    renderOverview();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    // The Doctor Overview's greeting, for the signed-in administrator — not
    // the generic "Overview" section title it used to open on.
    expect(h1s[0]).toHaveTextContent(/^Good (morning|afternoon|evening), Marcus Reed$/);
  });

  it('greets the administrator by the name on their profile once it loads', async () => {
    window.localStorage.setItem(
      'medora.u1.adminProfile.v1',
      JSON.stringify({ fullName: 'Dr. Marcus A. Reed' }),
    );
    renderOverview();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Dr\. Marcus A\. Reed$/,
      }),
    ).toBeInTheDocument();
  });

  it('adds what is waiting on the administrator to the date, once the queue is known', async () => {
    renderOverview();

    expect(await screen.findByText(/ · \d+ items? needs? your attention$/)).toBeInTheDocument();
  });
});

describe('Admin Overview · customizing', () => {
  it('lists every admin widget in the drawer, each unchecked, and nothing else', async () => {
    const user = userEvent.setup();
    renderOverview();

    const drawer = await openCustomize(user);
    const checkboxes = within(drawer).getAllByRole('checkbox');

    expect(checkboxes).toHaveLength(ADMIN_WIDGETS.length);
    checkboxes.forEach((control) => {
      expect(control).not.toBeChecked();
    });
    for (const widget of ADMIN_WIDGETS) {
      expect(within(drawer).getByRole('checkbox', { name: widget.title })).toBeInTheDocument();
    }
    // Role-appropriate: no doctor widget is on offer to an administrator.
    for (const doctorOnly of ["Today's schedule", 'Quick actions', 'Practice pulse']) {
      expect(within(drawer).queryByRole('checkbox', { name: doctorOnly })).not.toBeInTheDocument();
    }
    expect(
      within(drawer).getByText(`0 of ${String(ADMIN_WIDGETS.length)} widgets selected`),
    ).toBeInTheDocument();
  });

  it('adds what the administrator selects, in the order they select it', async () => {
    const user = userEvent.setup();
    renderOverview();

    await addWidgets(user, ['System health', 'Total doctors', 'Admin action queue']);

    expect(dashboardIds()).toEqual(['system-health', 'metric-total-doctors', 'action-queue']);
    // The header's control takes over from the empty state's.
    expect(
      screen.queryByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
  });

  it('renders every widget in the catalogue at once', async () => {
    const user = userEvent.setup();
    renderOverview();

    await addWidgets(
      user,
      ADMIN_WIDGETS.map((widget) => widget.title),
    );

    expect(dashboardIds()).toEqual(ADMIN_WIDGETS.map((widget) => widget.id));
    for (const widget of ADMIN_WIDGETS) {
      expect(screen.getByRole('button', { name: `${widget.title} options` })).toBeInTheDocument();
    }
  });

  it('removes a widget from its own menu, closes the gap, and offers Undo', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Total doctors', 'Storage & usage', 'Recent signups']);

    await user.click(screen.getByRole('button', { name: 'Storage & usage options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));

    expect(dashboardIds()).toEqual(['metric-total-doctors', 'recent-signups']);
    // Focus goes to where the widget can be brought back, not to <body>.
    expect(screen.getByRole('button', { name: 'Customize' })).toHaveFocus();

    expect(toast).toHaveBeenCalledTimes(1);
    const call = toast.mock.calls[0]![0];
    expect(call.title).toBe('Storage & usage removed from your dashboard');
    expect(call.action?.label).toBe('Undo');
  });

  it('puts a removed widget back where it was on Undo', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Total doctors', 'Storage & usage', 'Recent signups']);

    await user.click(screen.getByRole('button', { name: 'Storage & usage options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
    const undo = toast.mock.calls[0]![0].action!;
    await user.click(document.body);
    undo.onClick();

    expect(
      await screen.findByRole('button', { name: 'Storage & usage options' }),
    ).toBeInTheDocument();
    expect(dashboardIds()).toEqual(['metric-total-doctors', 'storage-usage', 'recent-signups']);
  });

  it('returns to the empty state when the last widget goes', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Active users now']);

    await user.click(screen.getByRole('button', { name: 'Active users now options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));

    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toHaveFocus();
  });

  it('clears the whole dashboard from the drawer', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Total patients', 'Platform activity']);

    const drawer = await openCustomize(user);
    await user.click(within(drawer).getByRole('button', { name: 'Remove all' }));
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('list', { name: 'Dashboard widgets' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
  });
});

describe('Admin Overview · persistence', () => {
  it('keeps the selection, removals included, across a remount', async () => {
    const user = userEvent.setup();
    const first = renderOverview();
    await addWidgets(user, ['Admin action queue', 'Recent admin activity', 'Total doctors']);
    await user.click(screen.getByRole('button', { name: 'Recent admin activity options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
    first.unmount();

    renderOverview();

    expect(dashboardIds()).toEqual(['action-queue', 'metric-total-doctors']);
  });

  it("stores the selection under the administrator's own key, apart from the doctor's", async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['System health']);

    expect(getPreference('adminDashboardWidgets', 'u1')).toEqual(['system-health']);
    expect(getPreference('dashboardWidgets', 'u1')).toBeNull();
  });

  it('ignores a stored id that is not an admin widget', () => {
    // A doctor widget id, a retired id and junk — none of them is something
    // this catalogue can render, so none may become a hole in the layout.
    window.localStorage.setItem(
      'medora.u1.adminDashboardWidgets',
      JSON.stringify(['todays-schedule', 'storage-usage', 'kpi-row', 7, 'storage-usage']),
    );

    renderOverview();

    expect(dashboardIds()).toEqual(['storage-usage']);
  });
});

/**
 * The customize control's look follows what is ON the dashboard — the saved
 * selection — and nothing else. With no widgets it reads "Customize" beside
 * its icon, whether or not the drawer is open and whatever is checked in the
 * drawer's draft. Once at least one widget has been added it is a square,
 * icon-only button; it reads "Customize" again the moment the last one goes.
 * Its accessible name is "Customize" throughout.
 */
describe('Admin Overview · customize button follows the widgets on the dashboard', () => {
  const customize = () => screen.getByRole('button', { name: 'Customize' });
  /** Whether the word is on show, or kept for screen readers only. */
  const look = (button: HTMLElement) =>
    within(button).getByText('Customize').classList.contains('sr-only') ? 'icon-only' : 'labelled';

  it('A · reads Customize on an empty dashboard', () => {
    renderOverview();
    expect(look(customize())).toBe('labelled');
    expect(customize()).not.toHaveClass('w-8');
  });

  it('B · stays labelled with the drawer open, and while widgets are only drafted', async () => {
    const user = userEvent.setup();
    renderOverview();

    const drawer = await openCustomize(user);
    expect(look(customize())).toBe('labelled');

    await setWidget(user, drawer, 'Total doctors', true);
    await setWidget(user, drawer, 'System health', true);
    expect(look(customize())).toBe('labelled');

    // Cancelled: nothing was added, so nothing changes.
    await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    expect(look(customize())).toBe('labelled');

    // Done with nothing checked adds nothing either.
    const again = await openCustomize(user);
    await user.click(within(again).getByRole('button', { name: 'Done' }));
    expect(look(customize())).toBe('labelled');
  });

  it('C · is a square icon-only button once a widget is added, keeping its name', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Total doctors']);

    const button = customize();
    expect(look(button)).toBe('icon-only');
    expect(button).toHaveAccessibleName('Customize');
    expect(button).toHaveClass('w-8', 'h-8', 'px-0');
    expect(button.querySelector('svg.lucide-dashboard-widget-add')).toBeInTheDocument();
  });

  it('C · stays icon-only across the drawer opening, a draft emptied, and closing', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Total doctors', 'System health']);

    const drawer = await openCustomize(user);
    expect(look(customize())).toBe('icon-only');
    // Emptying the draft is not removing anything from the dashboard.
    await user.click(within(drawer).getByRole('button', { name: 'Remove all' }));
    expect(look(customize())).toBe('icon-only');
    await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    expect(look(customize())).toBe('icon-only');
    expect(dashboardIds()).toEqual(['metric-total-doctors', 'system-health']);
  });

  it('D · stays icon-only while widgets remain, and reads Customize when the last goes', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Total doctors', 'System health']);

    await user.click(screen.getByRole('button', { name: 'Total doctors options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
    expect(dashboardIds()).toEqual(['system-health']);
    expect(look(customize())).toBe('icon-only');

    await user.click(screen.getByRole('button', { name: 'System health options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
    expect(look(customize())).toBe('labelled');
  });

  it('D · reads Customize again when the drawer removes every widget', async () => {
    const user = userEvent.setup();
    renderOverview();
    await addWidgets(user, ['Total doctors', 'System health']);

    const drawer = await openCustomize(user);
    await user.click(within(drawer).getByRole('button', { name: 'Remove all' }));
    await user.click(within(drawer).getByRole('button', { name: 'Done' }));
    expect(look(customize())).toBe('labelled');
  });

  it('takes its look from the saved dashboard after a remount, as after a refresh', async () => {
    const user = userEvent.setup();
    const first = renderOverview();
    await addWidgets(user, ['Total doctors']);
    first.unmount();

    renderOverview();
    expect(dashboardIds()).toEqual(['metric-total-doctors']);
    expect(look(customize())).toBe('icon-only');
  });
});

/**
 * A widget's ⋯ menu must survive its data landing. `DocumentMetric` used to
 * render a skeleton card while loading and a different component once loaded,
 * so the menu's own open state was thrown away when the figure arrived.
 */
describe('Admin Overview · widget menu across loading', () => {
  type DoctorsDocument = Awaited<ReturnType<typeof doctorsService.list>>;

  function seedTotalDoctors() {
    window.localStorage.setItem(
      'medora.u1.adminDashboardWidgets',
      JSON.stringify(['metric-total-doctors']),
    );
  }

  it('keeps an open ⋯ menu open, and working, when the widget data finishes loading', async () => {
    seedTotalDoctors();
    // Hold the doctors document pending, then release it after the menu is open.
    const real = doctorsService.list.bind(doctorsService);
    let release: (value: DoctorsDocument) => void = () => undefined;
    vi.spyOn(doctorsService, 'list').mockImplementation(
      () =>
        new Promise<DoctorsDocument>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    renderOverview();

    const slot = widgetList().querySelector('[data-widget-id="metric-total-doctors"]');
    expect(slot?.querySelector('[aria-busy="true"] .animate-pulse')).not.toBeNull();

    const trigger = screen.getByRole('button', { name: 'Total doctors options' });
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Remove from dashboard' })).toBeInTheDocument();

    release(await real());

    // The figure has landed: the skeleton is gone and the hint is on screen.
    expect(await screen.findByText(/pending verification/i)).toBeInTheDocument();
    expect(slot?.querySelector('.animate-pulse')).toBeNull();

    // ...and the menu opened during loading is still open on the same trigger.
    expect(screen.getByRole('button', { name: 'Total doctors options' })).toBe(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
    expect(screen.queryByRole('list', { name: 'Dashboard widgets' })).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0].title).toBe('Total doctors removed from your dashboard');
  });

  describe('once the data is loaded', () => {
    async function openLoadedMenu() {
      seedTotalDoctors();
      const user = userEvent.setup();
      renderOverview();
      await screen.findByText(/pending verification/i);
      await widgetsSettled();
      const trigger = screen.getByRole('button', { name: 'Total doctors options' });
      await user.click(trigger);
      expect(screen.getByRole('menuitem', { name: 'Remove from dashboard' })).toBeInTheDocument();
      return { user, trigger };
    }

    it('closes on Escape and returns focus to the trigger', async () => {
      const { user, trigger } = await openLoadedMenu();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('closes on an outside click', async () => {
      const { user } = await openLoadedMenu();
      await user.click(document.body);
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('closes when an item is selected', async () => {
      const { user } = await openLoadedMenu();
      await user.click(screen.getByRole('menuitem', { name: 'Remove from dashboard' }));
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });
  });
});
