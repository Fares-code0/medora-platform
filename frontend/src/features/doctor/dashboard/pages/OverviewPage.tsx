import { useMemo } from 'react';

import { CalendarDays } from 'lucide-react';

import { useDoctorProfile } from '@/app/providers';
import { PageContainer, PageSections } from '@/components/layout';
import {
  CustomizeDashboardButton,
  DashboardEmptyState,
  DashboardGreeting,
} from '@/components/patterns';
import { LinkButton } from '@/components/ui';
import { useDashboardEditor } from '@/hooks/useDashboardEditor';
import { routes } from '@/routes';

import { useCriticalAlertsQuery } from '../api/useCriticalAlertsQuery';
import { useDashboardOverviewQuery } from '../api/useDashboardOverviewQuery';
import { CriticalAlertsBanner } from '../components/CriticalAlertsBanner';
import { CustomizeDashboardDrawer } from '../components/CustomizeDashboardDrawer';
import { DashboardWidgetGrid } from '../components/DashboardWidgetGrid';
import { useDashboardWidgets } from '../hooks/useDashboardWidgets';
import {
  getDashboardWidget,
  type DashboardOverviewState,
  type DashboardWidgetId,
} from '../model/widgets';

/**
 * Doctor Overview (UX §2.1) — a dashboard the doctor composes.
 *
 * It used to be a fixed arrangement: alerts beside today's schedule, a KPI
 * row, and two collapsed bands of analytics and activity, the same for every
 * doctor. It is now driven entirely by the doctor's selection
 * (`useDashboardWidgets`) over one catalogue (`model/widgets.ts`): nothing is
 * shown until they choose it, and whatever they choose is laid out by
 * `DashboardWidgetGrid` without assuming how many widgets there are or what
 * size. The page itself holds no widget and no layout. Editing — the drawer,
 * removal with Undo, where focus goes — is `useDashboardEditor`, the same hook
 * the Admin Overview uses, so the two dashboards behave identically.
 *
 * ── What that changes about the old rules ───────────────────────────
 * DX-01's density target (<=1.5 screens at 1280x720) and its collapsed
 * sections answered a page that showed everything to everyone. A page that
 * shows only what its doctor picked is as dense as they make it, so both are
 * retired with the fixed layout rather than carried over.
 *
 * §10.6's rule — critical alerts never behind a closed disclosure — still
 * holds, and is now true by construction: nothing on this page is collapsed,
 * and the notifications widget renders its full list wherever it is placed.
 * What a doctor can now do is leave that widget off. Critical alerts do not
 * depend on it: UX §2.1's Row 0 banner sits above the grid on every visit,
 * whatever was chosen, empty dashboard included (`CriticalAlertsBanner`,
 * its own query), and the shell's notifications badge (sidebar, navbar
 * bell, tab bar) is on every page, this one included.
 *
 * ── Where the figures come from (FE-10.4) ───────────────────────────
 * The page asks for one document, `useDashboardOverviewQuery`, through the
 * dashboard seam, and hands it to every widget. The demo build answers from
 * the seeded fixtures; a live build answers from the API, where the KPIs,
 * today's schedule and the decision list are real, the trend, satisfaction
 * and recent activity are real where the API serves them (M27, `backend`)
 * and `null` where it does not, and practice pulse shows only the no-show
 * rate, counted from the doctor's own book — a `null` widget says "Not
 * available yet" rather than showing a seeded number. No widget reads the fixture module itself.
 */

function titleOf(id: DashboardWidgetId): string {
  return getDashboardWidget(id).title;
}

export function OverviewPage() {
  const { profile } = useDoctorProfile();
  const selection = useDashboardWidgets();
  const { activeIds } = selection;
  const editor = useDashboardEditor(selection, titleOf);

  const overviewQuery = useDashboardOverviewQuery();
  const data = overviewQuery.data;
  const refetchOverview = overviewQuery.refetch;
  const overview = useMemo<DashboardOverviewState>(
    () => ({
      data,
      loading: overviewQuery.isPending,
      error: overviewQuery.isError ? { onRetry: () => void refetchOverview() } : undefined,
      retry: () => void refetchOverview(),
    }),
    [data, overviewQuery.isPending, overviewQuery.isError, refetchOverview],
  );

  const alertsQuery = useCriticalAlertsQuery();
  const alertsAnswer = alertsQuery.data;
  const refetchAlerts = alertsQuery.refetch;

  const isEmpty = activeIds.length === 0;

  return (
    <PageContainer width="2xl">
      <PageSections>
        {/* ── Welcome (executive hero band) — shared with the Admin Overview ── */}
        <DashboardGreeting
          name={profile.fullName || 'Doctor'}
          summary={
            data === undefined
              ? undefined
              : `${String(data.schedule.length)} ${
                  data.schedule.length === 1 ? 'appointment' : 'appointments'
                } today · ${String(
                  data.pendingRequests,
                )} ${data.pendingRequests === 1 ? 'request needs' : 'requests need'} your decision`
          }
          actions={
            isEmpty ? undefined : (
              <CustomizeDashboardButton
                buttonRef={editor.headerCustomizeRef}
                onClick={editor.openCustomize}
                widgetCount={activeIds.length}
              />
            )
          }
        />

        {/* ── Row 0 — critical alerts, whatever the doctor composed below ── */}
        <CriticalAlertsBanner
          alerts={alertsAnswer?.served === true ? alertsAnswer.alerts : []}
          failed={alertsQuery.isError}
          retrying={alertsQuery.isFetching}
          onRetry={() => void refetchAlerts()}
        />

        {isEmpty ? (
          <DashboardEmptyState
            title="Your dashboard is ready to customize"
            description="Choose the information and tools you want to see here — today's schedule, alerts, key metrics, analytics and shortcuts. You can change it whenever you like."
            customizeRef={editor.emptyCustomizeRef}
            onCustomize={editor.openCustomize}
            secondaryAction={
              <LinkButton
                href={routes.doctor.appointments}
                variant="ghost"
                leadingIcon={CalendarDays}
              >
                Open appointments
              </LinkButton>
            }
          />
        ) : (
          <DashboardWidgetGrid
            activeIds={activeIds}
            onRemove={editor.removeFromMenu}
            overview={overview}
          />
        )}
      </PageSections>

      <CustomizeDashboardDrawer
        open={editor.customizing}
        onClose={editor.cancelCustomize}
        onDone={editor.commitCustomize}
        isActive={editor.isDraftActive}
        activeCount={editor.draftCount}
        onToggle={editor.toggle}
        onClear={editor.clearDraft}
      />
    </PageContainer>
  );
}
