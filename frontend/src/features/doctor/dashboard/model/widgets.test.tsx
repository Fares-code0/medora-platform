import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardOverview } from './dashboard-service';
import {
  MOCK_ACTIVITY,
  MOCK_APPOINTMENTS_TREND,
  MOCK_KPIS,
  MOCK_NOTIFICATIONS,
  MOCK_SATISFACTION,
  MOCK_SCHEDULE,
  MOCK_STATISTICS,
} from './mock-data';
import {
  DASHBOARD_WIDGET_GROUPS,
  DASHBOARD_WIDGET_IDS,
  DASHBOARD_WIDGETS,
  type DashboardOverviewState,
} from './widgets';

/** Every section present — what the demo build's document carries. */
const FULL: DashboardOverview = {
  kpis: MOCK_KPIS,
  schedule: MOCK_SCHEDULE,
  pendingRequests: 2,
  alerts: MOCK_NOTIFICATIONS,
  statistics: MOCK_STATISTICS,
  trend: MOCK_APPOINTMENTS_TREND,
  satisfaction: MOCK_SATISFACTION,
  activity: MOCK_ACTIVITY,
  failedSections: [],
};

function loaded(data: DashboardOverview): DashboardOverviewState {
  return { data, loading: false, error: undefined };
}

/**
 * The catalogue is the dashboard's single source of truth, so its integrity
 * is what these pin: one entry per id, a known group for each, and — the
 * contract the drawer relies on — every widget rendering the title its entry
 * advertises, with the dashboard's menu reachable from its header.
 */
describe('dashboard widget catalogue', () => {
  it('has exactly one entry per id, in id order', () => {
    expect(DASHBOARD_WIDGETS.map((widget) => widget.id)).toEqual([...DASHBOARD_WIDGET_IDS]);
  });

  it('puts every widget in a group the drawer renders', () => {
    const groups = new Set<string>(DASHBOARD_WIDGET_GROUPS.map((group) => group.id));
    for (const widget of DASHBOARD_WIDGETS) expect(groups.has(widget.group)).toBe(true);
  });

  it('has a unique title for every widget', () => {
    const titles = DASHBOARD_WIDGETS.map((widget) => widget.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it.each(DASHBOARD_WIDGETS.map((widget) => [widget.title, widget] as const))(
    '%s renders its catalogue title and the dashboard menu',
    (title, widget) => {
      const Widget = widget.component;
      const onSelect = vi.fn();

      render(
        <MemoryRouter>
          <Widget
            overview={loaded(FULL)}
            menu={[{ id: 'remove', label: 'Remove from dashboard', onSelect }]}
          />
        </MemoryRouter>,
      );

      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `${title} options` })).toBeInTheDocument();
    },
  );

  /**
   * FE-10.4: a widget's figures come from the document the page loaded, never
   * from the fixture module. Handed an empty document, as a live build with
   * nothing scheduled and no analytics source would be, no widget may still
   * show a seeded patient, figure or activity row.
   */
  it.each(DASHBOARD_WIDGETS.map((widget) => [widget.title, widget] as const))(
    '%s shows nothing from the fixture module when the document is empty',
    (_title, widget) => {
      const Widget = widget.component;
      const { container } = render(
        <MemoryRouter>
          <Widget
            overview={loaded({
              kpis: [],
              schedule: [],
              pendingRequests: 0,
              alerts: [],
              statistics: null,
              trend: null,
              satisfaction: null,
              activity: null,
              failedSections: [],
            })}
            menu={[]}
          />
        </MemoryRouter>,
      );

      const text = container.textContent ?? '';
      for (const entry of MOCK_SCHEDULE) expect(text).not.toContain(entry.patientName);
      for (const entry of MOCK_NOTIFICATIONS) expect(text).not.toContain(entry.text);
      for (const entry of MOCK_STATISTICS) expect(text).not.toContain(entry.label);
      for (const entry of MOCK_ACTIVITY) expect(text).not.toContain(entry.text);
      for (const kpi of MOCK_KPIS) if (kpi.caption) expect(text).not.toContain(kpi.caption);
    },
  );
});

/**
 * RM M27.2: the trend, satisfaction and activity load apart from the core.
 * A section the server failed to answer fails its own widget — with Retry —
 * and leaves every other widget alone; a section that answered "nothing"
 * says so in words rather than drawing an empty chart.
 */
describe('the independently loaded widgets', () => {
  const EMPTY: DashboardOverview = {
    kpis: MOCK_KPIS,
    schedule: [],
    pendingRequests: 0,
    alerts: [],
    statistics: null,
    trend: null,
    satisfaction: null,
    activity: null,
    failedSections: [],
  };

  function renderWidget(id: string, overview: DashboardOverviewState) {
    const widget = DASHBOARD_WIDGETS.find((entry) => entry.id === id);
    if (!widget) throw new Error(id);
    const Widget = widget.component;
    return render(
      <MemoryRouter>
        <Widget overview={overview} menu={[]} />
      </MemoryRouter>,
    );
  }

  it.each([
    ['appointments-trend', 'trend', "Couldn't load appointments trend"],
    ['patient-satisfaction', 'satisfaction', "Couldn't load patient satisfaction"],
    ['recent-activity', 'activity', "Couldn't load recent activity"],
  ] as const)('%s shows its own failure, and Retry reloads', (id, section, message) => {
    const retry = vi.fn();
    renderWidget(id, { ...loaded({ ...EMPTY, failedSections: [section] }), retry });

    expect(screen.getByText(message)).toBeInTheDocument();
    screen.getByRole('button', { name: /retry/i }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a failed section does not fail a widget beside it', () => {
    renderWidget('metric-pending-requests', {
      ...loaded({ ...EMPTY, failedSections: ['trend', 'satisfaction', 'activity'] }),
      retry: vi.fn(),
    });

    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
    expect(screen.getByText(MOCK_KPIS[1]?.value ?? '?')).toBeInTheDocument();
  });

  it('a month with no survey responses says so', () => {
    renderWidget('patient-satisfaction', loaded({ ...EMPTY, satisfaction: [] }));

    expect(screen.getByText('No responses this month')).toBeInTheDocument();
    expect(screen.queryByText('Not available yet')).not.toBeInTheDocument();
  });

  it('an empty activity feed says so', () => {
    renderWidget('recent-activity', loaded({ ...EMPTY, activity: [] }));

    expect(screen.getByText('No recent activity')).toBeInTheDocument();
    expect(screen.queryByText('Not available yet')).not.toBeInTheDocument();
  });

  it('activity rows link to the module that owns them', () => {
    renderWidget('recent-activity', loaded({ ...EMPTY, activity: MOCK_ACTIVITY }));

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/doctor/medical-records',
      '/doctor/pharmacy',
      '/doctor/labs',
    ]);
  });
});
