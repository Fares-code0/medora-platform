import type { ComponentType } from 'react';

import { Navigate, type RouteObject } from 'react-router-dom';

import { selectService } from '@/api/seam';
import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

import type { AdminSectionSlug } from './administration.types';

/**
 * Administration area routes (Phase 17; admin-only since Phase 19; folded
 * into the shared AppShell in Phase B). These are ordinary child routes of
 * the admin shell rather than a descendant <Routes>, so `useMatches()` sees
 * them — which is what makes the breadcrumb and the document title work from
 * `handle.crumb` like every other area of the app.
 *
 * Each section is its own `route.lazy` boundary (the house pattern, §5.3),
 * so the paths and crumbs stay cheap and static while the section code
 * splits per route instead of arriving as one large area chunk.
 */

type SectionLoader = () => Promise<{ Component: ComponentType }>;

/*
 * The sections a live build serves from the Medora API (FE-10.10) are
 * declared with `liveSection()`; today that is Appointment Oversight alone.
 * Every `section()` is built over a seeded demo store, so a live build routes
 * it to "Not connected yet" instead — see `demoOnly`. Doctors and Platform
 * Settings are declared by hand below and connect their own way.
 *
 * Two helpers rather than one `section()` reading a set of live slugs: a
 * runtime set lookup kept every demo loader referenced, so a production build
 * shipped every demo section's chunk (RM M40.4). Split this way, the loaders
 * passed to `section()` are dead in a production build and are not emitted.
 */

/**
 * A section the server does not serve yet: the real screen in the demo
 * build, the section's header over a not-connected state in a live one.
 * Selected through the seam like every other mock/HTTP choice, so the flag
 * is still read in one place.
 */
function demoOnly(slug: AdminSectionSlug, load: SectionLoader): SectionLoader {
  const unconnected: SectionLoader = async () => {
    const { NotConnectedSection } = await import('./components/NotConnectedSection');
    // React Router resolves a route's `lazy` once and keeps the result, so
    // this component is created once per route, not per render.
    function UnconnectedSection() {
      return <NotConnectedSection slug={slug} />;
    }
    return { Component: UnconnectedSection };
  };
  // RM M40.4: a production build never serves the demo screen, so `load` —
  // and the seeded store behind it — is dead code there and is not emitted
  // (scripts/mock-boundary.ts). Every other build selects through the seam.
  if (import.meta.env.MEDORA_MOCKS_STRIPPED === true) return unconnected;
  return selectService<SectionLoader>({ mock: load, http: unconnected });
}

type SectionSlug = Exclude<Parameters<typeof routes.admin.section>[0], undefined>;

/** Declares one demo-backed section route: static path + crumb, lazily loaded component. */
function section(slug: SectionSlug, crumb: string, load: SectionLoader): RouteObject {
  return { path: slug, handle: { crumb } satisfies RouteHandle, lazy: demoOnly(slug, load) };
}

/** Declares one section the live API serves — the same shape, never `demoOnly`. */
function liveSection(slug: SectionSlug, crumb: string, load: SectionLoader): RouteObject {
  return { path: slug, handle: { crumb } satisfies RouteHandle, lazy: load };
}

const loadQueue: SectionLoader = async () => {
  const { QueueSection } = await import('./sections/QueueSection');
  return { Component: QueueSection };
};

const loadWaitingRoom: SectionLoader = async () => {
  const { WaitingRoomSection } = await import('./sections/WaitingRoomSection');
  return { Component: WaitingRoomSection };
};

/**
 * Queue and Waiting Room for the reception workspace, which owns them in its
 * sidebar and serves them at its own paths. The same components and the same
 * demo/live choice as the admin routes below — the seeded demo in a demo
 * build, "Not connected yet" in a live one — so the two areas cannot drift.
 */
export const clinicOperationsLoaders = {
  queue: demoOnly('queue', loadQueue),
  waitingRoom: demoOnly('waiting-room', loadWaitingRoom),
} as const;

export const adminRoutes: readonly RouteObject[] = [
  {
    index: true,
    // Kept identical to SECTION_META.overview.label by
    // `administration.meta.test.ts`.
    handle: { crumb: 'Overview' } satisfies RouteHandle,
    lazy: demoOnly('overview', async () => {
      const { AdminOverviewSection } = await import('./overview/AdminOverviewSection');
      return { Component: AdminOverviewSection };
    }),
  },
  section('clinic', 'Clinic Overview', async () => {
    const { ClinicOverviewSection } = await import('./sections/ClinicOverviewSection');
    return { Component: ClinicOverviewSection };
  }),
  /*
   * `/admin/platform` was Platform Overview until ADM-01 absorbed its panels
   * — they are §3.1 rows 3 and 4. The path stays as a redirect because it is
   * in browser histories and in landing preferences saved before the move; a
   * 404 would strand anyone holding either. No crumb: nothing renders here
   * long enough to be breadcrumbed.
   */
  {
    path: 'platform',
    element: <Navigate to={routes.admin.root} replace />,
  },
  /*
   * Doctors management (ADM-02) and the admin doctor profile (ADM-03). The
   * profile is a child route rather than a sibling so `useMatches()` builds
   * "Doctors › Doctor profile" on its own, the way Platform Settings does.
   */
  {
    path: 'doctors',
    handle: { crumb: 'Doctors' } satisfies RouteHandle,
    children: [
      {
        index: true,
        lazy: async () => {
          const { DoctorsSection } = await import('./doctors/DoctorsSection');
          return { Component: DoctorsSection };
        },
      },
      {
        path: ':doctorId',
        handle: { crumb: 'Doctor profile' } satisfies RouteHandle,
        lazy: async () => {
          const { DoctorProfilePage } = await import('./doctors/DoctorProfilePage');
          return { Component: DoctorProfilePage };
        },
      },
    ],
  },
  /*
   * Patients management (ADM-04). Same shape as doctors: the account view
   * is a child route so `useMatches()` builds "Patients › Patient account"
   * without the page having to know anything about breadcrumbs.
   */
  {
    path: 'patients',
    handle: { crumb: 'Patients' } satisfies RouteHandle,
    children: [
      {
        index: true,
        lazy: demoOnly('patients', async () => {
          const { PatientsSection } = await import('./patients/PatientsSection');
          return { Component: PatientsSection };
        }),
      },
      {
        path: ':patientId',
        handle: { crumb: 'Patient account' } satisfies RouteHandle,
        lazy: demoOnly('patients', async () => {
          const { PatientProfilePage } = await import('./patients/PatientProfilePage');
          return { Component: PatientProfilePage };
        }),
      },
    ],
  },
  /*
   * ADM-05 lives in its own module (`../appointments`) rather than under
   * `sections/`: it is a screen with a service, a store and four dialogs of
   * its own, the same shape `phi/` took for ADM-10, not another
   * clinic-management section.
   */
  liveSection('appointments', 'Appointment Oversight', async () => {
    const { AppointmentOversightSection } =
      await import('./appointments/AppointmentOversightSection');
    return { Component: AppointmentOversightSection };
  }),
  section('queue', 'Queue Management', loadQueue),
  section('waiting-room', 'Waiting Room', loadWaitingRoom),
  section('staff', 'Staff Management', async () => {
    const { StaffSection } = await import('./sections/StaffSection');
    return { Component: StaffSection };
  }),
  section('departments', 'Departments', async () => {
    const { DepartmentsSection } = await import('./sections/DepartmentsSection');
    return { Component: DepartmentsSection };
  }),
  section('shifts', 'Shift Management', async () => {
    const { ShiftsSection } = await import('./sections/ShiftsSection');
    return { Component: ShiftsSection };
  }),
  section('schedule', 'Working Schedule', async () => {
    const { ScheduleSection } = await import('./sections/ScheduleSection');
    return { Component: ScheduleSection };
  }),
  section('holidays', 'Holidays', async () => {
    const { HolidaysSection } = await import('./sections/HolidaysSection');
    return { Component: HolidaysSection };
  }),
  section('rooms', 'Room Management', async () => {
    const { RoomsSection } = await import('./sections/RoomsSection');
    return { Component: RoomsSection };
  }),
  section('resources', 'Resources', async () => {
    const { ResourcesSection } = await import('./sections/ResourcesSection');
    return { Component: ResourcesSection };
  }),
  section('announcements', 'Announcements', async () => {
    const { AnnouncementsSection } = await import('./sections/AnnouncementsSection');
    return { Component: AnnouncementsSection };
  }),
  section('policies', 'Clinic Policies', async () => {
    const { PoliciesSection } = await import('./sections/PoliciesSection');
    return { Component: PoliciesSection };
  }),
  section('templates', 'Document Templates', async () => {
    const { TemplatesSection } = await import('./sections/TemplatesSection');
    return { Component: TemplatesSection };
  }),
  /*
   * Communication Monitoring (ADM-06B). Same child-route shape as doctors
   * and patients — the viewer is nested under the section so `useMatches()`
   * builds "Communication Monitoring › Conversation" on its own.
   *
   * This parent does NOT carry its own `ContentAccessProvider` any more. It
   * used to, built as the `element` returned from this route's own `lazy` —
   * but that recreates the element on every route resolution, so navigating
   * between the index child and `:conversationId` remounted the provider and
   * reset its `useState` grant, which meant a freshly-granted access denied
   * itself the moment the viewer mounted. The grant still has to survive
   * that navigation (a reviewer's justification on the metadata table must
   * still be visible once they land in the viewer it unlocked), so
   * `ContentAccessProvider` is mounted one level up instead, in
   * `app/router/index.tsx`, as a stable `React.lazy` binding alongside
   * `AdminPhiAccessProvider` — the same fix that provider already needed for
   * the same reason. See that file for the mount.
   */
  {
    path: 'communications',
    // 'Communication Monitoring', not the shorter 'Communications' the task
    // brief's own snippet used — `administration.meta.test.ts` asserts every
    // inlined crumb is identical to its `SECTION_META` label (added when
    // `CommunicationsSection` landed), and that label is the longer form.
    // Matching it here is what the test polices; drifting from it is exactly
    // the bug that test exists to catch.
    handle: { crumb: 'Communication Monitoring' } satisfies RouteHandle,
    children: [
      {
        index: true,
        lazy: demoOnly('communications', async () => {
          const { CommunicationsSection } = await import('./communications/CommunicationsSection');
          return { Component: CommunicationsSection };
        }),
      },
      {
        path: ':conversationId',
        handle: { crumb: 'Conversation' } satisfies RouteHandle,
        lazy: demoOnly('communications', async () => {
          const { ConversationViewerPage } =
            await import('./communications/ConversationViewerPage');
          return { Component: ConversationViewerPage };
        }),
      },
    ],
  },
  /*
   * System Logs (ADM-07). Its own module rather than a `sections/` file, the
   * shape ADM-05 and ADM-01 took: a screen with a service, a taxonomy and a
   * drawer of its own is not a clinic-management section.
   */
  section('logs', 'System Logs', async () => {
    const { SystemLogsSection } = await import('./logs/SystemLogsSection');
    return { Component: SystemLogsSection };
  }),
  /*
   * Admin Reports (ADM-08), the last §3 screen. Its own module for the same
   * reason ADM-01, ADM-05 and ADM-07 have one: it carries a derivation layer,
   * a service and a widget shell of its own, none of which is clinic
   * management.
   */
  section('reports', 'Reports', async () => {
    const { ReportsSection } = await import('./reports/ReportsSection');
    return { Component: ReportsSection };
  }),
  section('profile', 'My Profile', async () => {
    const { AdminProfileSection } = await import('./sections/AdminProfileSection');
    return { Component: AdminProfileSection };
  }),
  {
    path: 'settings',
    handle: { crumb: 'Platform Settings' } satisfies RouteHandle,
    children: [
      {
        index: true,
        lazy: async () => {
          const { AdminSettingsSection } = await import('./sections/settings/AdminSettingsSection');
          return { Component: AdminSettingsSection };
        },
      },
      {
        path: ':panel',
        lazy: async () => {
          const { AdminSettingsSection } = await import('./sections/settings/AdminSettingsSection');
          return { Component: AdminSettingsSection };
        },
      },
    ],
  },
];

/*
 * "My Settings" (`/admin/preferences/:section`) reuses the doctor Settings
 * Center wholesale. That is a cross-feature dependency, which §3.4 forbids
 * between feature modules, so the route is composed in the APP layer
 * instead — the same sanctioned seam that wires shell badges and search.
 * See `adminPreferencesRoute` in `app/router/index.tsx`.
 */
