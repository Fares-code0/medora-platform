import { lazy, Suspense, type ReactNode } from 'react';

import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';

import { Spinner } from '@/components/feedback';
import { adminRoutes, clinicOperationsLoaders } from '@/features/admin/routes';
import { authRoutes } from '@/features/auth';
import { aiRoutes } from '@/features/doctor/ai';
import { appointmentsRoutes } from '@/features/doctor/appointments';
import { clinicRoutes } from '@/features/doctor/clinic';
import { dashboardRoutes } from '@/features/doctor/dashboard';
import { labsRoutes } from '@/features/doctor/labs';
import { medicalRecordsRoutes } from '@/features/doctor/medical-records';
import { messagingRoutes } from '@/features/doctor/messaging';
import { notificationsRoutes } from '@/features/doctor/notifications';
import { patientsRoutes } from '@/features/doctor/patients';
import { pharmacyRoutes } from '@/features/doctor/pharmacy';
import { reportsRoutes } from '@/features/doctor/reports';
import { settingsRoutes } from '@/features/doctor/settings';
import { StaffHomePage, type StaffRole } from '@/features/staff';
import { useT } from '@/i18n';
import {
  adminNavigation,
  AppShell,
  doctorNavigation,
  laboratoryNavigation,
  pharmacyNavigation,
  receptionNavigation,
  type NavigationConfig,
  type RouteHandle,
} from '@/layouts';
import {
  PRACTITIONER_SETTINGS_SECTIONS,
  routes,
  STAFF_SETTINGS_SECTIONS,
  type DoctorSettingsSection,
} from '@/routes';
import { workspaceFor } from '@/routes/workspaces';

import { NotFoundPage, ForbiddenPage, RouteErrorPage } from '../error-boundary/ErrorPages';

import { RequireAuth, RequirePermission, RequireRole } from './guards';
import { LegacyAdministrationRoute } from './LegacyAdministrationRoute';
import { RootRedirect } from './RootRedirect';
import { ShellBadgesProvider } from './ShellBadgesProvider';

/**
 * The search seams — lazily mounted so neither area's datasets land in the
 * entry chunk. Each fills the shell's domain-free ShellSearchContext, which
 * the shared navbar search reads; a shell that mounts neither gets a field
 * that answers every query with "No matches", which is what the doctor
 * workspace did until D-26.
 */
const AdminSearchProvider = lazy(() =>
  import('./AdminShellSearchProvider').then((module) => ({
    default: module.AdminShellSearchProvider,
  })),
);

/*
 * The doctor's provider is small; the index itself loads only when the search
 * field is first engaged (see DoctorShellSearchProvider, NEW-21).
 */
const DoctorSearchProvider = lazy(() =>
  import('./DoctorShellSearchProvider').then((module) => ({
    default: module.DoctorShellSearchProvider,
  })),
);

/**
 * PHI elevation gate (ADM-10) — wraps the whole admin area so a single
 * justification prompt serves every screen and a grant is visible across
 * them. Lazy for the same reason as the search seam: it pulls the
 * administration query layer.
 */
const AdminPhiAccessProvider = lazy(() =>
  // RM M40.5: a production build gets the server-only gate, which keeps no
  // client-side grant or log; the demo's elevation flow and the seeded store
  // it logs to are not in that bundle. The test folds at build time.
  import.meta.env.MEDORA_MOCKS_STRIPPED === true
    ? import('@/features/admin/phi/ServerPhiAccessProvider').then((module) => ({
        default: module.ServerPhiAccessProvider,
      }))
    : import('@/features/admin/phi').then((module) => ({ default: module.PhiAccessProvider })),
);

/**
 * Content-access gate (ADM-06B) — same reasoning as `AdminPhiAccessProvider`
 * just above: a single justification prompt serves every communications
 * screen and the grant it produces must be visible across them. It has to
 * be a stable element held in a module-level binding, not one built inside
 * a route's own `lazy` (that gets recreated on every route resolution, so
 * `<Outlet />` navigations between the conversation list and the viewer
 * would remount the provider and drop the grant with it — see
 * `features/admin/routes.tsx` for the fuller history). Mounted here, above
 * every route in `adminRoutes`, it outlives that navigation. Lazy for the
 * same reason as its siblings: it pulls the communications query layer.
 */
const AdminContentAccessProvider =
  // RM M40.5: every screen that asks this gate for a grant is demo-only
  // (`features/admin/routes.tsx`), so a production build mounts no gate and
  // carries no browser-side grant store (`communications.api.ts` kept them in
  // localStorage). Content access becomes server-authorised with M20.7's
  // hospital-scoped routes, not before.
  import.meta.env.MEDORA_MOCKS_STRIPPED === true
    ? ({ children }: { children: ReactNode }) => children
    : lazy(() =>
        import('@/features/admin/communications/ContentAccessProvider').then((module) => ({
          default: module.ContentAccessProvider,
        })),
      );

function AreaFallback() {
  const t = useT();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Spinner size="lg" label={t('shell.loadingAdministration')} />
    </div>
  );
}

/**
 * Route tree — FRONTEND_ARCHITECTURE.md §5.1 / UX §1.3.
 * The public/auth branch (guest pages + lock screen) is owned by the auth
 * feature and spread in as `authRoutes`. The doctor branch renders one
 * AppShell instance (role layout route, §4) with feature modules mounted as
 * lazy chunks; remaining doctor sections are in-shell placeholders until their
 * features land, each carrying its breadcrumb `handle.crumb`.
 */

/**
 * `/admin/preferences/:section` — the admin's personal settings, which reuse
 * the doctor Settings Center wholesale (same nav, sections, save flows); only
 * the section-path builder differs so deep links stay inside /admin.
 *
 * Composed HERE rather than inside the admin feature because §3.4 forbids one
 * feature module importing another; the app layer is the sanctioned composer
 * (the same reason ShellBadgesProvider and the search providers live here).
 */
const ADMIN_PREFERENCES_TITLE = 'My Preferences';
const ADMIN_PREFERENCES_CAPTION =
  'Your own account, security and display preferences. Platform-wide configuration is under Settings in the sidebar.';

const adminPreferencesRoute: RouteObject = {
  path: 'preferences',
  // "Preferences", not "Settings": the sidebar's Settings is Platform
  // Settings (/admin/settings). Two pages both titled Settings was the
  // ambiguity this naming removes. The crumb is the localized section label.
  handle: { titleKey: 'admin.section.preferences' } satisfies RouteHandle,
  children: [
    {
      index: true,
      // Account, not Profile: the practitioner profile is not offered here (DEC-007).
      element: <Navigate to={`${routes.admin.section('preferences')}/account`} replace />,
    },
    {
      path: ':section',
      lazy: async () => {
        const [{ SettingsPage }, { SETTINGS_SECTIONS }] = await Promise.all([
          import('@/features/doctor/settings/pages/SettingsPage'),
          import('@/features/doctor/settings/model/types'),
        ]);
        const buildSectionPath = (section: DoctorSettingsSection) =>
          `${routes.admin.section('preferences')}/${section}`;
        const sections = SETTINGS_SECTIONS.map((meta) => meta.id).filter(
          (id) => !PRACTITIONER_SETTINGS_SECTIONS.includes(id),
        );
        return {
          Component: () => (
            <SettingsPage
              buildSectionPath={buildSectionPath}
              backHref={routes.admin.root}
              sections={sections}
              title={ADMIN_PREFERENCES_TITLE}
              caption={ADMIN_PREFERENCES_CAPTION}
            />
          ),
        };
      },
    },
  ],
};

/*
 * ── Staff workspaces (DEC-006a) ────────────────────────────────────────────
 *
 * Reception, Laboratory and Pharmacy, each in its own guarded area under the
 * shared AppShell. The screens they share with other areas are composed here,
 * where §3.4 allows importing more than one feature: appointment oversight
 * (admin), the test catalogue (labs), the Settings Center (doctor settings,
 * filtered to `STAFF_SETTINGS_SECTIONS`). The guard decides which tree is
 * drawn; the server decides, per request, what the role may read or do.
 */

function staffSettingsRoute(role: StaffRole): RouteObject {
  const workspace = workspaceFor(role);
  return {
    path: 'settings',
    handle: { titleKey: 'shell.settings' } satisfies RouteHandle,
    children: [
      { index: true, element: <Navigate to={workspace.settings()} replace /> },
      {
        path: ':section',
        lazy: async () => {
          const { SettingsPage } = await import('@/features/doctor/settings/pages/SettingsPage');
          return {
            Component: () => (
              <SettingsPage
                buildSectionPath={(section) => workspace.settings(section)}
                backHref={workspace.home}
                sections={STAFF_SETTINGS_SECTIONS}
              />
            ),
          };
        },
      },
    ],
  };
}

/*
 * Capability-guarded to match the sidebar: an administrator can revoke
 * `patients.view` from a staff role, and a deep link must not outlive that.
 */
const staffDirectoryRoute: RouteObject = {
  element: <RequirePermission permission="patients.view" />,
  children: [
    {
      path: 'patients',
      handle: { titleKey: 'route.patientDirectory' } satisfies RouteHandle,
      lazy: async () => {
        const { MaskedDirectoryPage } = await import('@/features/staff');
        return { Component: MaskedDirectoryPage };
      },
    },
  ],
};

function staffWorkspace(
  role: StaffRole,
  config: NavigationConfig,
  extra: readonly RouteObject[],
  wrap: (shell: JSX.Element) => JSX.Element = (shell) => shell,
): RouteObject {
  return {
    element: <RequireRole role={role} />,
    children: [
      {
        path: workspaceFor(role).root,
        element: (
          <ShellBadgesProvider>
            <Suspense fallback={<AreaFallback />}>{wrap(<AppShell config={config} />)}</Suspense>
          </ShellBadgesProvider>
        ),
        children: [
          { index: true, element: <StaffHomePage role={role} /> },
          ...extra,
          staffDirectoryRoute,
          staffSettingsRoute(role),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  };
}

const receptionWorkspace = staffWorkspace(
  'reception',
  receptionNavigation,
  [
    {
      // Same capability as the sidebar item: a revoked grant closes the deep link too.
      element: <RequirePermission permission="appointments.reassign" />,
      children: [
        {
          // ADM-05's screen, unchanged: its actions are capability-gated, so a
          // role without `appointments.cancelAdministratively` gets no cancel.
          path: 'appointments',
          handle: { titleKey: 'nav.appointments' } satisfies RouteHandle,
          lazy: async () => {
            const { AppointmentOversightSection } = await import(
              '@/features/admin/appointments/AppointmentOversightSection'
            );
            return { Component: AppointmentOversightSection };
          },
        },
      ],
    },
    /*
     * The admin area's Queue and Waiting Room screens, unchanged — the same
     * components through the same demo/live loader. Reception owns them in
     * the sidebar; the server admits reception to their two read endpoints
     * and nothing else under /administration.
     */
    {
      path: 'queue',
      handle: { titleKey: 'admin.section.queue' } satisfies RouteHandle,
      lazy: clinicOperationsLoaders.queue,
    },
    {
      path: 'waiting-room',
      handle: { titleKey: 'admin.section.waitingRoom' } satisfies RouteHandle,
      lazy: clinicOperationsLoaders.waitingRoom,
    },
  ],
  // Identifiers on the oversight rows go through the ADM-10 gate; reception
  // holds no reveal capability, so they stay masked.
  (shell) => <AdminPhiAccessProvider>{shell}</AdminPhiAccessProvider>,
);

const laboratoryWorkspace = staffWorkspace('laboratory', laboratoryNavigation, [
  {
    element: <RequirePermission permission="labs.review" />,
    children: [
      {
        path: 'catalogue',
        handle: { titleKey: 'nav.testCatalogue' } satisfies RouteHandle,
        lazy: async () => {
          const { loadLabCataloguePage } = await import('@/features/doctor/labs');
          return { Component: await loadLabCataloguePage() };
        },
      },
    ],
  },
]);

const pharmacyWorkspace = staffWorkspace('pharmacy', pharmacyNavigation, []);

/**
 * Development-only tools — on the local dev server, never in a build.
 *
 * Gated on `import.meta.env.MEDORA_THEME_PLAYGROUND`, a compile-time constant
 * vite.config.ts sets to `true` ONLY for `vite` (the dev server) with
 * `VITE_APP_ENV=development`. NOT `import.meta.env.DEV`: the public Vercel demo
 * runs `npm run build:demo`, which sets NODE_ENV=development and makes `DEV`
 * true, and a `DEV` gate once compiled this route into that deployment.
 *
 * In every `vite build` the constant is `false`, this array is `[]`, and Rollup
 * drops the dynamic import with the whole feature; the
 * themePlaygroundBoundaryPlugin then fails the build if any playground code
 * survives anyway (scripts/theme-playground-boundary.ts). The path is a literal
 * (it mirrors `THEME_PLAYGROUND_PATH`) because importing it from the feature
 * would put the feature in the production graph. Public, not behind
 * `RequireAuth`: it shows sample data only and touches no API or preference.
 */
const devOnlyRoutes: readonly RouteObject[] =
  import.meta.env.MEDORA_THEME_PLAYGROUND === true
    ? [
        {
          path: '/dev/theme-playground',
          lazy: async () => {
            const { ThemePlaygroundPage } = await import('@/features/theme-playground');
            return { Component: ThemePlaygroundPage };
          },
        },
      ]
    : [];

/**
 * The tree itself, exported so the composition it declares can be asserted:
 * `features/admin/routes.test.tsx` checks that the admin area really is
 * mounted under `/admin` here, which no test that re-declares the nesting for
 * itself can see. `AppRouter` is its only other consumer.
 */
export const appRoutes: readonly RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      // ── Public ────────────────────────────────────────────────
      { path: routes.root, element: <RootRedirect /> },
      ...authRoutes,
      { path: routes.forbidden, element: <ForbiddenPage /> },
      { path: routes.notFound, element: <NotFoundPage /> },
      ...devOnlyRoutes,

      // ── Protected: authenticated staff ───────────────────────
      {
        element: <RequireAuth />,
        children: [
          // Pre-Phase-B admin URLs. The area used to live under /doctor
          // because Phase 17 built it doctor-facing; it has been admin-only
          // since Phase 19 and moved to /admin in Phase B. Existing links
          // and bookmarks are redirected rather than 404'd.
          {
            path: `${routes.legacy.administrationRoot}/*`,
            element: <LegacyAdministrationRoute />,
          },
          // ── Doctor workspace (AppShell) ─────────────────────────
          {
            element: <RequireRole role="doctor" />,
            children: [
              {
                path: routes.doctor.root,
                element: (
                  <ShellBadgesProvider>
                    <Suspense fallback={<AreaFallback />}>
                      <DoctorSearchProvider>
                        <AppShell config={doctorNavigation} />
                      </DoctorSearchProvider>
                    </Suspense>
                  </ShellBadgesProvider>
                ),
                children: [
                  { index: true, element: <Navigate to={routes.doctor.overview} replace /> },
                  dashboardRoutes,
                  ...patientsRoutes,
                  ...appointmentsRoutes,
                  ...medicalRecordsRoutes,
                  ...labsRoutes,
                  ...pharmacyRoutes,
                  ...aiRoutes,
                  ...clinicRoutes,
                  ...messagingRoutes,
                  ...notificationsRoutes,
                  ...settingsRoutes,
                  ...reportsRoutes,
                  { path: '*', element: <NotFoundPage /> },
                ],
              },
            ],
          },
          // ── Admin workspace (same AppShell, admin config) ───────
          {
            element: <RequireRole role="admin" />,
            children: [
              {
                path: routes.admin.root,
                element: (
                  <ShellBadgesProvider>
                    <Suspense fallback={<AreaFallback />}>
                      <AdminSearchProvider>
                        <AdminPhiAccessProvider>
                          <AdminContentAccessProvider>
                            <AppShell config={adminNavigation} />
                          </AdminContentAccessProvider>
                        </AdminPhiAccessProvider>
                      </AdminSearchProvider>
                    </Suspense>
                  </ShellBadgesProvider>
                ),
                children: [
                  ...adminRoutes,
                  adminPreferencesRoute,
                  { path: '*', element: <NotFoundPage /> },
                ],
              },
            ],
          },
          receptionWorkspace,
          laboratoryWorkspace,
          pharmacyWorkspace,
        ],
      },

      // ── Fallback ──────────────────────────────────────────────
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter([...appRoutes]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
