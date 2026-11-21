import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPreference } from '@/services/preferences';

import { resolveLandingSection } from '../admin-profile';
import { formatDate } from '../administration.meta';
import type { PlatformStatus } from '../administration.types';
import { administrationApi } from '../api/administration.api';
import { oversightApi } from '../appointments/api/oversight.api';
import { doctorsApi } from '../doctors/api/doctors.api';
import { patientsApi } from '../patients/api/patients.api';
import { PhiAccessProvider } from '../phi';

import { AdminOverviewSection } from './AdminOverviewSection';
import { overviewApi } from './api/overview.api';
import { AppointmentFunnelCard } from './AppointmentFunnelCard';
import type { AppointmentFunnel } from './overview.types';
import { ACTIVE_USERS_FADE_MS, ActiveUsersMetric } from './OverviewMetricWidgets';
import { SecurityAlertsBanner } from './SecurityAlertsBanner';
import { StorageUsageCard } from './StorageUsageCard';
import { ADMIN_WIDGET_IDS, type AdminWidgetId } from './widgets';

/**
 * The Administrator Overview at the surface (ADM-01 · UX §3.1).
 *
 * Four claims matter here. The four KPIs are present and readable, and they
 * are *skeletons* until the documents land — zeros would be indistinguishable
 * from the fresh-deployment empty state. The security banner is never
 * *silently* absent — a failure says so, and an administrator with no
 * security-triage job sees no banner at all, which is a permission decision
 * rather than a failure. And the live count fades between values.
 *
 * The two page-level security tests are written as positive-control-first
 * pairs on purpose. A negative assertion made before the documents settle
 * passes whatever the page does; each one below therefore waits for a marker
 * that only exists once the doctors document — the same document the banner
 * derives from — has landed.
 *
 * The Overview is a dashboard the administrator composes and opens empty, so
 * the claims about its widgets are made against an administrator who has
 * placed every widget on it (`renderOverview`'s default). What the dashboard
 * itself does — the empty state, adding, removing, persisting — is covered by
 * `AdminOverviewDashboard.test.tsx`.
 */

const capabilities = { current: true };

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => capabilities.current,
  useToast: () => ({ toast: () => undefined }),
}));

beforeEach(() => {
  window.localStorage.clear();
  capabilities.current = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The real tree wraps the whole `/admin/*` branch in the PHI gate
// (`app/router/index.tsx`), and `MaskedIdentifier` refuses to render outside
// it — deliberately, so a screen cannot print an identifier by forgetting the
// provider. Rows 2–4 will put identifiers on this page, so the harness
// carries the gate from the start.
function renderOverview({
  widgets = ADMIN_WIDGET_IDS,
}: { widgets?: readonly AdminWidgetId[] } = {}) {
  // The signed-in administrator (`u1`, mocked above) has placed these.
  setPreference('adminDashboardWidgets', widgets, 'u1');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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

/** The dashboard's slot for one widget. */
function widgetSlot(id: AdminWidgetId): HTMLElement {
  const slot = document.querySelector(`[data-widget-id="${id}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`No widget slot for ${id}`);
  return slot;
}

/**
 * The nearest ancestor of `text` matching `selector`, narrowed without a
 * non-null assertion so a structural change fails loudly here rather than
 * silently turning an assertion into a no-op.
 */
function ancestorOf(text: string | RegExp, selector: string): HTMLElement {
  const node = screen.getByText(text).closest(selector);
  if (!(node instanceof HTMLElement)) {
    throw new Error(`No "${selector}" ancestor for ${String(text)}`);
  }
  return node;
}

describe('the key metrics', () => {
  it('shows the four headline figures §3.1 names', async () => {
    renderOverview();

    expect(await screen.findByText('Total doctors')).toBeInTheDocument();
    expect(screen.getByText('Total patients')).toBeInTheDocument();
    expect(screen.getByText('Appointments today')).toBeInTheDocument();
    expect(screen.getByText('Active users now')).toBeInTheDocument();
  });

  it('stands the document-derived tiles down to skeletons while they load, rather than to zeros', async () => {
    // A row of zeros is the fresh-deployment picture Task 9 draws on purpose.
    // Rendering it during load would tell an administrator the platform is
    // empty when it is merely slow, so §3.1 asks for widget-level skeletons.
    renderOverview();

    const documentTiles = [
      widgetSlot('metric-total-doctors'),
      widgetSlot('metric-total-patients'),
      widgetSlot('metric-appointments-today'),
    ];
    for (const tile of documentTiles) {
      // Each tile keeps its label — and its menu — while it loads, but shows
      // a placeholder where the figure goes, never a 0.
      expect(tile.querySelector('[aria-busy="true"] .animate-pulse')).not.toBeNull();
      expect(within(tile).queryByText('0')).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/pending verification/i)).not.toBeInTheDocument();
    // The live count is not document-derived and renders from the first frame.
    expect(widgetSlot('metric-active-users').querySelector('.animate-pulse')).toBeNull();

    expect(await screen.findByText(/pending verification/i)).toBeInTheDocument();
    for (const tile of documentTiles) {
      expect(tile.querySelector('.animate-pulse')).toBeNull();
    }
  });

  it('keeps the live count on screen when a document the other tiles need fails', async () => {
    // §3.1's widgets do not wait on each other. The count comes from its own
    // poll, so a doctors outage must not replace an arrived number with an
    // error state whose Retry cannot refetch it.
    vi.spyOn(doctorsApi, 'list').mockRejectedValue(new Error('doctor service unreachable'));
    vi.spyOn(overviewApi, 'activeUsers').mockResolvedValue(41);
    renderOverview();

    // Positive control: wait until the failure has actually stood the
    // document-derived tiles down, so their absence below is the error state
    // rather than an assertion made while they were still loading.
    await screen.findAllByText(/couldn't load this section/i);
    expect(screen.queryByText(/pending verification/i)).not.toBeInTheDocument();

    expect(screen.getByText('Active users now')).toBeInTheDocument();
    // Awaited, not read synchronously: the doctors rejection and the count's
    // own poll settle in the same tick, so whichever lands first is a race.
    // The claim is that the count arrives and stays, not that it beat the
    // failure to the screen.
    expect(await screen.findByText('41')).toBeInTheDocument();
  });

  it('captions the doctors KPI with the pending count an admin can act on', async () => {
    renderOverview();

    await waitFor(() => {
      expect(screen.getByText(/pending verification/i)).toBeInTheDocument();
    });
  });

  it('holds the live count at a placeholder until it arrives, rather than showing a zero', async () => {
    // The count is the one polled value on the page, and it lands at roughly
    // the same moment as the documents. Pinning it unresolved keeps this test
    // about the placeholder rather than about which promise won the race.
    vi.spyOn(overviewApi, 'activeUsers').mockReturnValue(new Promise<number>(() => undefined));
    renderOverview();

    // A "0" here would be a claim that nobody is on the platform; the count
    // has simply not landed yet.
    expect(await screen.findByText('Active users now')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('the live active-user count', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function kpiRow(activeUsers: number) {
    return <ActiveUsersMetric activeUsers={activeUsers} />;
  }

  it('fades from one count to the next instead of swapping or counting up', () => {
    const { rerender } = render(kpiRow(41));
    const fade = ancestorOf('41', '.transition-opacity');
    expect(fade).toHaveClass('opacity-100');

    rerender(kpiRow(42));

    // Mid-fade. Three things are true, and each fails if the fade is removed:
    // the element is the *same* node (a keyed remount would mount opaque, with
    // nothing to transition from), it is transparent, and it still carries the
    // old number — nothing ticks the digits towards the new one.
    expect(ancestorOf('41', '.transition-opacity')).toBe(fade);
    expect(fade).toHaveClass('opacity-0');
    expect(screen.queryByText('42')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(ACTIVE_USERS_FADE_MS);
    });

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText('41')).not.toBeInTheDocument();
    expect(fade).toHaveClass('opacity-100');
  });

  it('fades the figure alone, so the tile and its menu never blink', () => {
    const { rerender } = render(
      <MemoryRouter>
        <ActiveUsersMetric
          activeUsers={41}
          menu={[{ id: 'remove', label: 'Remove from dashboard', onSelect: () => undefined }]}
        />
      </MemoryRouter>,
    );
    const menu = screen.getByRole('button', { name: 'Active users now options' });

    rerender(
      <MemoryRouter>
        <ActiveUsersMetric
          activeUsers={42}
          menu={[{ id: 'remove', label: 'Remove from dashboard', onSelect: () => undefined }]}
        />
      </MemoryRouter>,
    );

    expect(ancestorOf('41', '.transition-opacity')).toHaveClass('opacity-0');
    expect(menu.closest('.transition-opacity')).toBeNull();
  });
});

describe('the security banner', () => {
  it('says so when the security status cannot be read, rather than vanishing', () => {
    render(
      <MemoryRouter>
        <SecurityAlertsBanner alerts={[]} isError onRetry={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/security status unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says so on the page too when a source the alerts derive from fails', async () => {
    // The component test above proves the warning renders when it is told to.
    // This one proves the page tells it: without the `isError` wiring the slot
    // would be empty, which reads as "nothing is wrong".
    vi.spyOn(doctorsApi, 'list').mockRejectedValue(new Error('doctor service unreachable'));
    renderOverview();

    expect(await screen.findByText(/security status unavailable/i)).toBeInTheDocument();
    const banner = ancestorOf(/security status unavailable/i, '[role="alert"]');
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('stays out of the way when the sources are readable and clean', () => {
    const { container } = render(
      <MemoryRouter>
        <SecurityAlertsBanner alerts={[]} isError={false} onRetry={() => undefined} />
      </MemoryRouter>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lists each unresolved alert with somewhere to go and investigate it', () => {
    render(
      <MemoryRouter>
        <SecurityAlertsBanner
          alerts={[
            {
              id: 'impossible-travel:d1',
              kind: 'impossible-travel',
              severity: 'critical',
              summary: 'Geographically impossible sign-in for Dr Yara Hassan',
              at: '2026-08-11T09:00:00.000Z',
              subjectId: 'd1',
            },
          ]}
          isError={false}
          onRetry={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('1 unresolved security alert')).toBeInTheDocument();
    // ADM-07 shipped, so Investigate now lands in the log itself, filtered to
    // the alert's own evidence, rather than on the nearest stand-in screen.
    expect(screen.getByRole('link', { name: /Investigate/ })).toHaveAttribute(
      'href',
      '/admin/logs?type=impossible-travel',
    );
  });

  it('raises the seeded platform alerts for an administrator who may triage them', async () => {
    // The positive control for the two negative tests around it: the seeded
    // platform genuinely has an unresolved alert, so "no banner" below is a
    // real absence rather than an assertion made too early.
    renderOverview();

    expect(await screen.findByText(/unresolved security/i)).toBeInTheDocument();
  });

  it('gives an administrator without log access no banner at all', async () => {
    capabilities.current = false;
    renderOverview();

    // The KPI captions only render once the doctors document has landed — the
    // same document the banner above derives its alerts from. So this is the
    // settled state, and the absent banner is the permission decision.
    expect(await screen.findByText(/pending verification/i)).toBeInTheDocument();
    expect(screen.queryByText(/security status unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unresolved security/i)).not.toBeInTheDocument();
  });
});

describe('the action queue', () => {
  it('stands down to its own skeleton rather than claiming nothing is waiting', async () => {
    // Every row here is derived from the doctors/patients/oversight documents
    // plus, for the fifth row, the communications document, so while any of
    // them is in flight all five counts are 0 — and a card rendered from them
    // captions itself "Nothing is waiting on you." over five zeros. That
    // tells an administrator there is no work waiting when the truth is that
    // nothing has been looked at yet, which is why §3.1 asks for a widget
    // skeleton.
    renderOverview();

    expect(screen.queryByText(/nothing is waiting on you/i)).not.toBeInTheDocument();
    const pending = screen.queryByRole('link', { name: /doctor verifications pending/i });
    expect(pending).not.toBeInTheDocument();
    // The skeleton lives *inside* the card, so the widget keeps its frame and
    // its heading while it loads instead of vanishing from the grid.
    expect(screen.getByText('Admin action queue')).toBeInTheDocument();

    // Positive control, using the same query the queue tests below settle on:
    // the rows genuinely do arrive, so the two absences above were measured
    // during the loading window rather than after everything had resolved.
    expect(
      await screen.findByRole('link', { name: /doctor verifications pending/i }),
    ).toBeInTheDocument();
  });

  it('links each count to the destination already filtered to it', async () => {
    const verifications = await renderQueueRow(/doctor verifications pending/i);
    expect(verifications).toHaveAttribute('href', '/admin/doctors?tab=pending');

    expect(screen.getByRole('link', { name: /licences expiring/i })).toHaveAttribute(
      'href',
      '/admin/doctors?expiring=soon',
    );
    expect(screen.getByRole('link', { name: /accounts with open issues/i })).toHaveAttribute(
      'href',
      '/admin/patients?flag=open',
    );
    expect(screen.getByRole('link', { name: /appointments pending > 24h/i })).toHaveAttribute(
      'href',
      '/admin/appointments?flag=stuck-pending',
    );
    // The fifth row (ADM-06B): derived from the communications document
    // already in the query cache, not a count this page invented.
    expect(screen.getByRole('link', { name: /open safety flags in conversations/i })).toHaveAttribute(
      'href',
      '/admin/communications?tab=flags&status=open',
    );
  });

  it('offers open, not approve — ADM-03 refuses a verification until its checks are ticked', async () => {
    await renderQueueRow(/doctor verifications pending/i);

    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });
});

/** Renders the page and waits for the queue to settle on `name`'s row. */
async function renderQueueRow(name: RegExp): Promise<HTMLElement> {
  renderOverview();
  return screen.findByRole('link', { name });
}

describe('the platform activity chart', () => {
  it('renders the three series §3.1 names, each one togglable', async () => {
    renderOverview();

    expect(await screen.findByLabelText(/platform activity over time/i)).toBeInTheDocument();
    // The legend entries are the toggles §3.1 asks for; `LineAreaChart` owns
    // the toggling itself, so the claim here is that all three series reached
    // the one chart rather than that this component wired anything.
    for (const name of [/daily active users/i, /appointments booked/i, /messages sent/i]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('switches the range without losing the chart, and asks the service for it', async () => {
    const user = userEvent.setup();
    const signals = vi.spyOn(overviewApi, 'signals');
    renderOverview();

    await screen.findByLabelText(/platform activity over time/i);
    const sevenDays = screen.getByRole('button', { name: '7 days' });
    expect(sevenDays).toHaveAttribute('aria-pressed', 'false');

    await user.click(sevenDays);

    // Button state alone would not be worth much: a chart that flipped
    // `aria-pressed` but left `range` out of its query key would still look
    // switched while plotting the thirty-day window. The claim is that the
    // new range reached the query.
    await waitFor(() => {
      expect(signals).toHaveBeenCalledWith('7d');
    });

    expect(await screen.findByLabelText(/platform activity over time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('row 3', () => {
  it('shows Storage & Usage where §3.1 puts Revenue, because billing is not enabled', async () => {
    renderOverview();

    expect(await screen.findByText('Storage & usage')).toBeInTheDocument();
    expect(screen.queryByText(/revenue/i)).not.toBeInTheDocument();
  });

  it('quotes both appointment rates against the denominator behind them', async () => {
    // Two bare percentages are unreadable without the window they were taken
    // over: "12% cancelled" off four appointments is not the same claim as
    // "12% cancelled" off four hundred.
    renderOverview();

    expect(await screen.findByText(/of \d+ appointments/i)).toBeInTheDocument();
  });

  it('says an empty window has no basis for a rate, rather than quoting two zeros', () => {
    // Unreachable from the seeded platform, which always has a busy week — so
    // the branch is exercised directly. 0% cancelled / 0% no-show reads as a
    // flawless week; the truth is that there was no week to measure.
    const empty: AppointmentFunnel = {
      stages: [
        { label: 'Requested', value: 0 },
        { label: 'Confirmed', value: 0 },
        { label: 'Completed', value: 0 },
      ],
      cancellationRate7d: 0,
      noShowRate7d: 0,
      window7dTotal: 0,
    };
    render(
      <AppointmentFunnelCard
        funnel={empty}
        isLoading={false}
        isError={false}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText(/no basis to quote a rate/i)).toBeInTheDocument();
    expect(screen.queryByText(/0% cancelled/)).not.toBeInTheDocument();
  });

  it('reads a zero-capacity gauge as 0%, not NaN', async () => {
    // Unreachable from the seeded fixture, which always has real capacity —
    // so the branch is exercised directly. `storageUsedGb / storageTotalGb`
    // and `seatsUsed / seatsTotal` are both `0 / 0` here; unguarded, that is
    // `NaN`, which would reach the DOM as `aria-valuenow={NaN}` and
    // `style="width: NaN%"` rather than a readable gauge.
    const seeded = await administrationApi.getPlatformStatus();
    const zeroCapacity: PlatformStatus = {
      ...seeded,
      system: { ...seeded.system, storageUsedGb: 0, storageTotalGb: 0 },
      license: { plan: 'Starter', seatsUsed: 0, seatsTotal: 0, renewsOn: '2026-09-01' },
    };
    render(
      <MemoryRouter>
        <StorageUsageCard
          platform={zeroCapacity}
          isLoading={false}
          isError={false}
          onRetry={() => undefined}
        />
      </MemoryRouter>,
    );

    const gauges = screen.getAllByRole('progressbar');
    expect(gauges).toHaveLength(2);
    for (const gauge of gauges) {
      expect(gauge).toHaveAttribute('aria-valuenow', '0');
    }
    expect(screen.getAllByText('0%')).toHaveLength(2);
  });

  it('quotes the seat count Settings → About quotes, because it is the same record', async () => {
    // The regression this pair exists for: the card shipped its own licence
    // seed for one review round, so Home read "38 of 50 seats · renews 1 Mar
    // 2027" while Settings → About read "5 of 25 · renews 1 Jan 2027". The
    // hard numbers here are the seeded `platformStatus.license` — the one
    // `AboutPanel` renders.
    renderOverview();

    expect(await screen.findByText('5 of 25 licensed seats')).toBeInTheDocument();
    expect(
      screen.getByText(`Enterprise plan · renews ${formatDate('2027-01-01')}`),
    ).toBeInTheDocument();
    // Storage came from the same record all along; it is asserted beside the
    // seats so a future split of the two sources fails here.
    expect(screen.getByText('412 GB of 1024 GB used')).toBeInTheDocument();
  });

  it('follows the platform-status record when it changes, rather than a seed of its own', async () => {
    // The hard numbers above would still pass against a private copy that
    // happened to agree. This one moves the single record and requires the
    // card to move with it, which only a card reading that record can do.
    const seeded = await administrationApi.getPlatformStatus();
    vi.spyOn(administrationApi, 'getPlatformStatus').mockResolvedValue({
      ...seeded,
      system: { ...seeded.system, storageUsedGb: 64, storageTotalGb: 128 },
      license: { plan: 'Trial', seatsUsed: 7, seatsTotal: 9, renewsOn: '2028-02-02' },
    });
    renderOverview();

    expect(await screen.findByText('7 of 9 licensed seats')).toBeInTheDocument();
    expect(screen.getByText('64 GB of 128 GB used')).toBeInTheDocument();
    expect(screen.getByText(`Trial plan · renews ${formatDate('2028-02-02')}`)).toBeInTheDocument();
  });

  it('explains a degraded service instead of only colouring it', async () => {
    renderOverview();

    expect(await screen.findByText(/SMS provider retries elevated/i)).toBeInTheDocument();
  });

  it('withholds the health verdict until the services land, rather than pronouncing an empty list healthy', async () => {
    // The worst status of no services is "operational", so a verdict computed
    // before the list arrives reports the platform healthy on the strength of
    // knowing nothing about it.
    renderOverview();

    expect(screen.queryByText('All operational')).not.toBeInTheDocument();
    // The envelope lives inside the Panel, so the widget keeps its frame and
    // heading while it loads instead of vanishing from the grid.
    expect(screen.getByText('System health')).toBeInTheDocument();

    // Positive control: the services genuinely arrive, and the seeded platform
    // has one degraded service — so the absence above was measured during the
    // loading window rather than after everything had resolved.
    expect(await screen.findByText('Service degraded')).toBeInTheDocument();
  });

  it('keeps the funnel standing when the telemetry service fails, because it is not served by it', async () => {
    // Storage and service health come from the signals query; the funnel is
    // derived from the ADM-05 oversight document already in the cache. One
    // envelope around the row would take all three down together.
    vi.spyOn(overviewApi, 'signals').mockRejectedValue(new Error('signals unreachable'));
    renderOverview();

    expect(await screen.findByText(/of \d+ appointments/i)).toBeInTheDocument();
    expect(screen.getByText('Storage & usage')).toBeInTheDocument();
    expect(screen.queryByText(/SMS provider retries elevated/i)).not.toBeInTheDocument();
  });
});

describe('row 4', () => {
  /*
   * The seeded platform's newest account is the patient Mona Adel (9 days
   * ago); the five entries behind her are doctors. Naming her is what makes
   * the masking claim below checkable — `/•/` alone would also pass if the
   * name were masked with the wrong field kind, and `maskMrn` on a name emits
   * bullets while leaving the surname in the clear.
   */
  const NEWEST_PATIENT = 'Mona Adel';
  const NEWEST_PATIENT_MASKED = 'Mo••• A•••';
  const NEWEST_DOCTOR = 'Dr. Nadia Farouk';

  it('masks a patient name, like every other admin surface', async () => {
    // ADM-10 made MaskedIdentifier the only sanctioned way to render a patient
    // identifier in the admin area. A full name here would mean the admin's
    // home page is the one screen that opts out of the PHI gate.
    renderOverview();

    const feed = await screen.findByRole('region', { name: /recent signups/i });

    await waitFor(() => {
      expect(within(feed).getByText(NEWEST_PATIENT_MASKED)).toBeInTheDocument();
    });
    expect(within(feed).queryByText(NEWEST_PATIENT)).not.toBeInTheDocument();
  });

  it('does not mask doctor names — they are not PHI', async () => {
    // The contrast is the point: masked rows read as a deliberate choice only
    // because the unmasked ones beside them are visibly unmasked.
    renderOverview();

    const feed = await screen.findByRole('region', { name: /recent signups/i });

    expect(await within(feed).findByText(NEWEST_DOCTOR)).toBeInTheDocument();
  });

  it('names an actor on every line of the activity feed', async () => {
    // "Updated security policy" with no one attached to it is not an audit
    // trail; §3.1's feed answers who, not only what.
    //
    // The shape assertion alone cannot make that claim: `actor · target` and
    // the action text share one `<li>`, so `/\S+ · \S+/` matches an emptied
    // actor just as happily. Each line is therefore checked against the actor
    // the audit log actually carries for it — the events are read from the
    // same service the feed renders, in the same newest-first order.
    const events = await administrationApi.getAuditEvents();
    renderOverview();

    const feed = await screen.findByRole('region', { name: /recent admin activity/i });
    await within(feed).findByText('Updated security policy');

    const lines = within(feed).getAllByRole('listitem');
    expect(lines.length).toBeGreaterThan(0);
    for (const [index, line] of lines.entries()) {
      const event = events[index];
      if (!event) throw new Error(`the feed rendered more lines than the audit log has events`);
      expect(event.actor).not.toBe('');
      expect(line).toHaveTextContent(`${event.actor} · ${event.target}`);
      expect(line).toHaveTextContent(/\S+\s·\s\S+/);
    }
  });

  it('keeps the signups feed standing when the audit log fails, because it is not served by it', async () => {
    // The two feeds sit side by side and read different sources: the activity
    // feed is the audit query, the signups feed is derived from the doctors
    // and patients documents already in the cache. One envelope over the row
    // would blank the arrivals list on an audit outage.
    vi.spyOn(administrationApi, 'getAuditEvents').mockRejectedValue(new Error('audit unreachable'));
    renderOverview();

    const signups = await screen.findByRole('region', { name: /recent signups/i });
    await waitFor(() => {
      expect(within(signups).getByText(NEWEST_PATIENT_MASKED)).toBeInTheDocument();
    });

    // The failure is attributed to the widget that failed, inside its own
    // frame, rather than to the row or to the page.
    const activity = screen.getByRole('region', { name: /recent admin activity/i });
    expect(within(activity).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps the signups feed standing when the oversight document fails, because it is not served by it', async () => {
    // The signups feed reads only the doctors and patients documents; the
    // oversight document belongs to the appointment funnel (Row 3) and the
    // audit-derived security alerts. `accountsLoading`/`accountsFailed` are
    // deliberately keyed on the two account documents alone — folding
    // `oversight` back into that key (as Row 3's funnel key already guards
    // against for its own boundary) would blank this feed on an outage it
    // has nothing to do with.
    vi.spyOn(oversightApi, 'list').mockRejectedValue(new Error('oversight unreachable'));
    renderOverview();

    const signups = await screen.findByRole('region', { name: /recent signups/i });
    await waitFor(() => {
      expect(within(signups).getByText(NEWEST_PATIENT_MASKED)).toBeInTheDocument();
    });
    expect(within(signups).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('stands the signups feed down to a skeleton rather than to an empty arrivals list', async () => {
    // An empty list under "Recent signups" is the fresh-deployment picture;
    // rendering it while the documents are in flight says nobody has joined
    // when the truth is that nothing has been read yet.
    renderOverview();

    expect(screen.queryByText(/no signups/i)).not.toBeInTheDocument();
    // The envelope lives inside the Panel, so the widget keeps its frame and
    // heading while it loads instead of vanishing from the grid.
    const feed = screen.getByRole('region', { name: /recent signups/i });
    expect(within(feed).queryAllByRole('listitem')).toHaveLength(0);

    // Positive control: the rows genuinely arrive, so the absence above was
    // measured during the loading window.
    expect(await within(feed).findByText(NEWEST_DOCTOR)).toBeInTheDocument();
  });
});

describe('the fresh-deployment empty state', () => {
  const ONBOARDING = /get the platform started/i;

  /** Both account documents empty — the one state §3.1's empty state is for. */
  function seedNothing() {
    vi.spyOn(doctorsApi, 'list').mockResolvedValue({ doctors: [], invites: [] });
    vi.spyOn(patientsApi, 'list').mockResolvedValue({ patients: [] });
  }

  it('offers somewhere to start when nobody has ever signed up', async () => {
    seedNothing();
    renderOverview();

    const card = await screen.findByRole('region', { name: ONBOARDING });
    // Two destinations, not one: §3.1's empty state is a first-run checklist,
    // and the permission matrix is the half an administrator cannot go back
    // and do quietly once people are already signing in.
    expect(within(card).getByRole('link', { name: /invite your first doctor/i })).toHaveAttribute(
      'href',
      '/admin/doctors',
    );
    expect(
      within(card).getByRole('link', { name: /review the permission matrix/i }),
    ).toHaveAttribute('href', '/admin/settings/roles');
  });

  it('keeps the key metrics standing at zero, because here the zeros are true', async () => {
    // "0 doctors, 0 patients" is the reading the invitation answers, and a
    // page that opened on the invitation alone would not say what it was
    // reacting to.
    seedNothing();
    renderOverview();

    await screen.findByRole('region', { name: ONBOARDING });
    // Awaited separately: the tiles are gated on all three documents, and the
    // card only on the two account ones, so the card can land a tick ahead of
    // the row it is explaining.
    await screen.findByText(/pending verification/i);
    expect(within(widgetSlot('metric-total-doctors')).getByText('0')).toBeInTheDocument();
    expect(within(widgetSlot('metric-total-patients')).getByText('0')).toBeInTheDocument();
  });

  it('keeps the widgets the administrator chose, rather than hiding them behind it', async () => {
    // On the fixed page the card stood in for rows 2–4. On a dashboard the
    // administrator composes, a widget they placed does not vanish because
    // the platform is new: it stays, and says it has nothing yet.
    seedNothing();
    renderOverview({ widgets: ['recent-signups', 'storage-usage'] });

    await screen.findByRole('region', { name: ONBOARDING });
    expect(screen.getByRole('region', { name: /recent signups/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /storage & usage/i })).toBeInTheDocument();
  });

  it('shows above an empty dashboard too, since it is not a widget', async () => {
    seedNothing();
    renderOverview({ widgets: [] });

    expect(await screen.findByRole('region', { name: ONBOARDING })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your dashboard is ready to customize' }),
    ).toBeInTheDocument();
  });

  it('does not flash while the account documents are still loading', async () => {
    // The load-bearing test of the pair guarding `fresh`. An unread document
    // and an empty one are the same empty array, so without the loading gate
    // *every* ordinary page load opens on "Nothing has happened here yet."
    // over an invitation, then throws three quarters of the page away and
    // draws the real one.
    seedNothing();
    renderOverview();

    expect(screen.queryByRole('region', { name: ONBOARDING })).not.toBeInTheDocument();

    // Positive control: this deployment genuinely is fresh, so the card does
    // arrive — the absence above was measured during the loading window
    // rather than against a page that never shows the card at all.
    expect(await screen.findByRole('region', { name: ONBOARDING })).toBeInTheDocument();
  });

  it('does not claim a fresh platform when the doctors document failed', async () => {
    // The other half of that guard. Patients are genuinely empty here, so the
    // doctors outage is the only thing standing between this page and the
    // fresh state — and it is enough: an unreadable roster is not an empty
    // one. Reading it as fresh would put up an invitation instead of saying
    // that something failed.
    vi.spyOn(doctorsApi, 'list').mockRejectedValue(new Error('doctor service unreachable'));
    vi.spyOn(patientsApi, 'list').mockResolvedValue({ patients: [] });
    renderOverview();

    // Positive control: wait until the failure has actually reached a widget,
    // so the absence below is the settled state rather than the loading one.
    const signups = await screen.findByRole('region', { name: /recent signups/i });
    expect(await within(signups).findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: ONBOARDING })).not.toBeInTheDocument();
  });

  it('stays out of the way of a platform that is in use', async () => {
    renderOverview();

    // The widgets arrive and the card does not — one marker per former row.
    expect(
      await screen.findByRole('link', { name: /doctor verifications pending/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Storage & usage')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /recent signups/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: ONBOARDING })).not.toBeInTheDocument();
  });
});

describe('the landing-section preference', () => {
  it('falls back to the overview when the stored slug no longer exists', () => {
    // `platform` was a real section until ADM-01 absorbed it. A preference
    // saved before then must not strand an administrator on a dead route.
    expect(resolveLandingSection('platform')).toBe('overview');
    expect(resolveLandingSection('nonsense')).toBe('overview');
    expect(resolveLandingSection('doctors')).toBe('doctors');
  });

  it('does not mistake an inherited object property for a section', () => {
    // The stored slug is arbitrary text from localStorage. Every one of these
    // answers `true` to `stored in SECTION_META` through the prototype chain,
    // so a membership test that walks it hands back the dead route this
    // resolver exists to prevent.
    for (const inherited of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect(resolveLandingSection(inherited)).toBe('overview');
    }
  });
});
