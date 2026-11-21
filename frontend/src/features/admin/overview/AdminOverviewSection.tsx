import { useState } from 'react';

import { Rocket } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth, useCan } from '@/app/providers';
import { PageContainer, PageSections } from '@/components/layout';
import {
  CustomizeDashboardButton,
  CustomizeDashboardDrawer,
  DashboardEmptyState,
  DashboardGreeting,
  DashboardWidgetGrid,
} from '@/components/patterns';
import { useDashboardEditor } from '@/hooks/useDashboardEditor';
import { useDashboardWidgetSelection } from '@/hooks/useDashboardWidgetSelection';
import { routes } from '@/routes';

import { useAdminProfile } from '../admin-profile';
import { useAuditEvents, usePhiAccessLog, usePlatformStatus } from '../api/useAdministrationQueries';
import { useOversightDocument } from '../appointments/api/useOversightQueries';
import { useCommunicationsDocument } from '../communications/communications.queries';
import { Panel } from '../components/primitives';
import { useDoctorsDocument } from '../doctors/api/useDoctorsQueries';
import { usePatientsDocument } from '../patients/api/usePatientsQueries';

import { useActiveUsers, useOverviewSignals } from './api/useOverviewQueries';
import {
  deriveActionQueue,
  deriveFunnel,
  deriveKpis,
  deriveSecurityAlerts,
  deriveSignups,
  isFreshDeployment,
} from './overview';
import type { ActivityRange } from './overview.types';
import { SecurityAlertsBanner } from './SecurityAlertsBanner';
import {
  ADMIN_WIDGET_GROUPS,
  ADMIN_WIDGETS,
  getAdminWidget,
  isAdminWidgetId,
  type AdminOverviewData,
  type AdminWidgetId,
} from './widgets';

/**
 * The onboarding card's two calls to action, styled as the page's other
 * primary text links are (Storage & usage's "Manage", the security banner's
 * "Investigate") minus the parts that belong to those slots rather than to the
 * link: no `text-caption`, because these sit mid-sentence and take the list's
 * own size, and no `inline-flex`/`gap`, because neither carries a trailing
 * icon. Shared rather than repeated so the two cannot drift apart.
 *
 * The focus ring names a real theme token, which is not something to take on
 * trust: a mistyped colour still emits a ring, just Tailwind's default blue
 * rather than the themed one, so the mistake looks fine in review. That is now
 * checked for the whole codebase by `styles/theme-utilities.test.ts`.
 */
const ONBOARDING_LINK =
  'rounded-control font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/**
 * Administrator Overview (ADM-01 · UX §3.1) — the admin's home.
 *
 * Every figure an administrator can act on is derived here from documents
 * ADM-02, ADM-04, ADM-05 and (for the action queue's fifth row and the
 * flagged-communications alert) ADM-06B already hold in the query cache, so
 * approving a verification, cancelling an appointment or resolving a safety
 * flag changes this page with no refetch and no window in which a badge
 * disagrees with the screen it links to. Only telemetry, service health, the
 * platform-status record behind storage and licence, and the live user count
 * are fetched.
 *
 * This is the shell: it owns the clock, the documents and the activity range,
 * and hands every widget the query states it needs to draw its own loading and
 * failure branches.
 *
 * ── A dashboard the administrator composes ──────────────────────────
 * It used to draw every widget, in a fixed four-row arrangement, for every
 * administrator. It is now the same customizable dashboard as the Doctor
 * Overview: nothing is shown until the administrator chooses it from the
 * catalogue (`widgets.ts`) in Customize dashboard, the selection persists per
 * user (`adminDashboardWidgets`), and `DashboardWidgetGrid` lays out whatever
 * was chosen without assuming how many widgets there are. The layout, drawer,
 * empty state, ⋯-menu removal with Undo and focus handling are the shared
 * pattern (`components/patterns/dashboard`, `useDashboardEditor`), not a copy.
 *
 * Two things stay outside the selection, above it: the security banner, which
 * §3.1 makes undismissable, and the fresh-deployment onboarding card, which is
 * a state of the platform rather than a view anyone picks.
 *
 * ── It opens on the same greeting as the Doctor Overview ────────────
 * Not on `SectionShell`'s "Overview" title: the welcome band is the shared
 * `DashboardGreeting`, so the two homes greet their user identically. The name
 * is the administrator's profile name — the one they edit under My Profile,
 * seeded from the signed-in account — falling back to the account name while
 * the profile loads. The workload line counts the action queue's rows, the
 * same figures the queue widget links to.
 */
function titleOf(id: AdminWidgetId): string {
  return getAdminWidget(id).title;
}

export function AdminOverviewSection() {
  const can = useCan();
  const { user } = useAuth();
  const profile = useAdminProfile();
  const selection = useDashboardWidgetSelection('adminDashboardWidgets', isAdminWidgetId);
  const { activeIds } = selection;
  const editor = useDashboardEditor(selection, titleOf);
  const isEmpty = activeIds.length === 0;

  const doctors = useDoctorsDocument();
  const patients = usePatientsDocument();
  const oversight = useOversightDocument();
  const audit = useAuditEvents();
  const phiLog = usePhiAccessLog();
  /*
   * The same query key ADM-06B's own Communications page reads — not a
   * second fetch this page invented. Whichever screen lands first seeds the
   * cache; the other reads it back, exactly like the doctors/patients/
   * oversight documents above.
   */
  const communications = useCommunicationsDocument();
  const activeUsers = useActiveUsers();
  /*
   * The licence and storage figures on this page are the platform-status
   * record itself — the same query Settings → About reads — rather than a
   * copy served alongside the telemetry. Two seeds would be two seat counts
   * on two admin screens (spec §4.5).
   */
  const platform = usePlatformStatus();
  const [range, setRange] = useState<ActivityRange>('30d');
  const signals = useOverviewSignals(range);

  /*
   * One clock per render, shared by every derived value — otherwise the KPI
   * row and the action queue can disagree about what "today" means.
   *
   * That rule is also why nothing below is memoised. `now` is a new number on
   * every render and every derivation here depends on it, so a `useMemo` keyed
   * on it could never hit; it would only look like caching. The derivations
   * are single passes over a few hundred cached records — cheaper than the
   * comparison work a real cache would cost.
   */
  const now = Date.now();

  const doctorRecords = doctors.data?.doctors ?? [];
  const patientRecords = patients.data?.patients ?? [];
  const appointments = oversight.data?.appointments ?? [];
  const roster = oversight.data?.doctors ?? [];
  // Every open safety flag, derived from the communications document —
  // never a second fetch, and never recomputed: `buildOverview`/`deriveFlags`
  // already did this work for the Communications page, and this reads the
  // same cache entry back.
  const flags = communications.data?.flags ?? [];

  const kpis = deriveKpis(doctorRecords, patientRecords, appointments, roster, now);
  const queue = deriveActionQueue(doctorRecords, patientRecords, appointments, now, flags);
  const funnel = deriveFunnel(appointments, now);
  const signups = deriveSignups(doctorRecords, patientRecords);

  /*
   * An administrator who cannot read the logs has no security-triage job, so
   * the banner is gated on the same capability ADM-07 will use. That is a
   * permission decision, not the "silently absent" case §3.1 forbids — the
   * absent-because-broken case is the banner's own error branch.
   */
  const mayTriage = can('logs.view');
  const alerts = mayTriage
    ? deriveSecurityAlerts(doctorRecords, phiLog.data ?? [], audit.data ?? [], now, flags)
    : [];
  const alertsFailed = mayTriage && (doctors.isError || audit.isError || phiLog.isError);

  /*
   * §3.1 asks for widget-level skeletons while a widget loads. Zeros would be
   * a lie with a very specific shape: "0 doctors, 0 patients" is exactly the
   * fresh-deployment picture the empty state draws on purpose, and "0 pending
   * verifications" reads as "nothing is waiting on you" — so a loading frame
   * that renders either tells an administrator the platform is idle when it is
   * merely slow. All three documents gate both widgets because both derive
   * from all three; what is deliberately *not* gated on them is the live user
   * count, which has its own poll and its own placeholder.
   */
  const documentsLoading = doctors.isLoading || patients.isLoading || oversight.isLoading;
  const documentsFailed = doctors.isError || patients.isError || oversight.isError;
  const retryDocuments = () => {
    void doctors.refetch();
    void patients.refetch();
    void oversight.refetch();
  };

  /*
   * The action queue's own gate, one document wider than the KPI row's: its
   * fifth row is the only thing on this page that reads the communications
   * document, so folding `communications` into `documentsLoading` above would
   * stand the KPI tiles down to skeletons for a fetch none of them depend on.
   */
  const queueLoading = documentsLoading || communications.isLoading;
  const queueFailed = documentsFailed || communications.isError;
  const waiting = queue.reduce((total, row) => total + row.count, 0);
  const retryQueue = () => {
    retryDocuments();
    void communications.refetch();
  };

  /*
   * The signups feed reads only the two account documents, so it is keyed on
   * those two and not on `documentsLoading` — an appointment-oversight outage
   * has nothing to say about who registered, and folding it in would blank the
   * arrivals list for a reason it does not depend on.
   */
  const accountsLoading = doctors.isLoading || patients.isLoading;
  const accountsFailed = doctors.isError || patients.isError;
  const retryAccounts = () => {
    void doctors.refetch();
    void patients.refetch();
  };
  const retrySignals = () => {
    void signals.refetch();
  };
  const retryPlatform = () => {
    void platform.refetch();
  };

  /*
   * §3.1's empty state. `isFreshDeployment` reads the two account documents
   * and nothing else, so this is keyed on those two alone — the same key the
   * signups feed uses, and for the same reason: an appointment-oversight
   * outage says nothing about whether anyone has signed up.
   *
   * Both halves of that key are load-bearing, because an unread document and
   * an empty one are the same empty array:
   *
   * - `accountsLoading` — without it every ordinary page load renders "Nothing
   *   has happened here yet." over an onboarding card for the length of the
   *   fetch, then throws the whole page away and draws the real one.
   * - `accountsFailed` — without it a doctors outage reads as a platform
   *   nobody has ever used, which is the same lie the skeletons above exist to
   *   prevent, told louder: it puts an invitation on the page instead of
   *   saying that something failed.
   */
  const fresh =
    !accountsLoading && !accountsFailed && isFreshDeployment(doctorRecords, patientRecords);

  /*
   * Everything a widget may read, built once per render on the one clock. Each
   * binding in `AdminWidgetSlots` takes only its own section and the query
   * state of its own sources.
   */
  const overview: AdminOverviewData = {
    now,
    kpis,
    documents: {
      isLoading: documentsLoading,
      isError: documentsFailed,
      onRetry: retryDocuments,
    },
    activeUsers: activeUsers.data,
    queue,
    queueState: { isLoading: queueLoading, isError: queueFailed, onRetry: retryQueue },
    funnel,
    oversight: {
      isLoading: oversight.isLoading,
      isError: oversight.isError,
      onRetry: () => {
        void oversight.refetch();
      },
    },
    activity: signals.data?.activity ?? [],
    services: signals.data?.services ?? [],
    range,
    onRangeChange: setRange,
    signals: { isLoading: signals.isLoading, isError: signals.isError, onRetry: retrySignals },
    platform: platform.data,
    platformState: {
      isLoading: platform.isLoading,
      isError: platform.isError,
      onRetry: retryPlatform,
    },
    auditEvents: audit.data ?? [],
    audit: {
      isLoading: audit.isLoading,
      isError: audit.isError,
      onRetry: () => {
        void audit.refetch();
      },
    },
    signups,
    accounts: { isLoading: accountsLoading, isError: accountsFailed, onRetry: retryAccounts },
  };

  return (
    <PageContainer width="2xl">
      <PageSections>
        <DashboardGreeting
          name={profile.data?.fullName || user?.name || 'Administrator'}
          summary={
            queueLoading || queueFailed
              ? undefined
              : `${String(waiting)} ${waiting === 1 ? 'item needs' : 'items need'} your attention`
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

        {mayTriage ? (
          <SecurityAlertsBanner
            alerts={alerts}
            isError={alertsFailed}
            onRetry={() => {
              void doctors.refetch();
              void audit.refetch();
              void phiLog.refetch();
            }}
          />
        ) : null}

        {/*
          The onboarding card is a state of the platform, not a widget: it
          shows while nobody has signed up, whatever the administrator has
          placed on the dashboard, and goes when the first account arrives.
          It used to stand in for the activity, queue and feed rows; on a
          dashboard the administrator composes, a widget they chose stays —
          each one already says honestly that it has nothing to show yet.
        */}
        {fresh ? (
          <Panel
            title="Get the platform started"
            description="Nothing has happened here yet."
            icon={Rocket}
            tone="primary"
          >
            <ul className="flex flex-col gap-3 text-body-sm text-text-secondary">
              <li>
                <Link to={routes.admin.doctors} className={ONBOARDING_LINK}>
                  Invite your first doctor
                </Link>{' '}
                — verification, scheduling and oversight all start there.
              </li>
              <li>
                <Link to={routes.admin.settings('roles')} className={ONBOARDING_LINK}>
                  Review the permission matrix
                </Link>{' '}
                before anyone signs in.
              </li>
            </ul>
          </Panel>
        ) : null}

        {isEmpty ? (
          <DashboardEmptyState
            title="Your dashboard is ready to customize"
            description="Choose the figures and panels you want to see here — key metrics, the action queue, platform health, activity and signups. You can change it whenever you like."
            customizeRef={editor.emptyCustomizeRef}
            onCustomize={editor.openCustomize}
          />
        ) : (
          <DashboardWidgetGrid
            activeIds={activeIds}
            getWidget={getAdminWidget}
            onRemove={editor.removeFromMenu}
            widgetProps={{ overview }}
          />
        )}
      </PageSections>

      <CustomizeDashboardDrawer
        open={editor.customizing}
        onClose={editor.cancelCustomize}
        onDone={editor.commitCustomize}
        widgets={ADMIN_WIDGETS}
        groups={ADMIN_WIDGET_GROUPS}
        isActive={editor.isDraftActive}
        activeCount={editor.draftCount}
        onToggle={editor.toggle}
        onClear={editor.clearDraft}
      />
    </PageContainer>
  );
}
