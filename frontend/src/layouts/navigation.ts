import {
  Activity,
  Armchair,
  Bell,
  Building2,
  Calendar,
  CalendarCheck,
  CalendarOff,
  CalendarRange,
  ChartColumnBig,
  Clock,
  DoorOpen,
  FileSearch,
  FileText,
  FlaskConical,
  FolderHeart,
  LayoutDashboard,
  ListOrdered,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Package,
  Pill,
  ScrollText,
  Stethoscope,
  TrendingUp,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import type { MessageKey } from '@/i18n';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';
import type { Permission, Role } from '@/types/auth';

/**
 * Navigation as data — FRONTEND_ARCHITECTURE.md §4.
 * The Sidebar and BottomTabBar render from a per-role NavigationConfig;
 * adding a nav item is a config change, never new JSX. `badgeSource`
 * subscriptions are TanStack Query counts exposed by features, supplied
 * through `ShellBadgesContext` by the app layer.
 */

export interface NavigationItem {
  readonly id: string;
  /**
   * The translated label (F-19). A **key**, not a string: nav config is a
   * module constant evaluated before any React tree exists, so it cannot
   * call `useT()` — the renderer translates. Typed as `MessageKey`, so a
   * nav entry pointing at a message that does not exist is a compile error.
   */
  readonly labelKey: MessageKey;
  readonly icon: LucideIcon;
  readonly path: string;
  /**
   * Match this item's route only, never routes nested beneath it. Needed for
   * an area index (e.g. /admin) whose path prefixes every sibling and would
   * otherwise stay highlighted on every page.
   */
  readonly end?: boolean;
  readonly requiredPermission?: Permission;
  /** Which `ShellBadgesContext` count the item shows (none when 0). */
  readonly badgeSource?: 'messages' | 'notifications' | 'pendingRequests';
  /**
   * Nested destinations. In the sidebar an item with children is a
   * disclosure: choosing it opens its list instead of navigating, and it
   * stays lit on any route beneath `path`. Surfaces with no room for a list
   * (bottom tabs, search destinations) keep using `path`.
   */
  readonly children?: readonly NavigationChild[];
}

/** A nested sidebar destination, under a parent `NavigationItem`. */
export interface NavigationChild {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly path: string;
  readonly requiredPermission?: Permission;
}

export interface NavigationSection {
  readonly labelKey?: MessageKey;
  readonly items: readonly NavigationItem[];
}

export interface NavigationConfig {
  readonly role: Role;
  readonly sections: readonly NavigationSection[];
  /** ≤4 item ids for the <md bottom tab bar; the rest go into "More". */
  readonly bottomTabIds: readonly string[];
  /** `null` when the shell mounts no search index — the field is then not drawn. */
  readonly searchPlaceholderKey: MessageKey | null;
}

/** Route handle contract consumed by the shell breadcrumb (§4). */
export interface RouteHandle {
  /**
   * A literal page name — the fallback for a route that has no `titleKey`.
   * Every shell and auth route uses `titleKey` now; `crumb` remains for
   * routes declared outside the catalogue (tests, a feature mid-migration).
   */
  readonly crumb?: string;
  /**
   * A `MessageKey` naming the page: the breadcrumb level, the document title
   * and the route announcer all read it through `useT`, so all three follow
   * the active language (Arabic localization, foundation phase — before it,
   * only the auth branch used keys and every shell title was English).
   *
   * Typed as `string` rather than `MessageKey` because `src/layouts` is a
   * platform layer that may not depend on the catalogue's key union; the
   * consumer narrows it.
   */
  readonly titleKey?: string;
}

/** Doctor menu — UX_ARCHITECTURE.md §2 sidebar order. */
export const doctorNavigation: NavigationConfig = {
  role: 'doctor',
  sections: [
    {
      items: [
        { id: 'overview', labelKey: 'nav.overview', icon: LayoutDashboard, path: routes.doctor.overview },
        {
          id: 'patients',
          labelKey: 'nav.patients',
          icon: Users,
          path: routes.doctor.patients,
          children: [
            { id: 'patients-all', labelKey: 'nav.patients', path: routes.doctor.patients },
            {
              // The existing registration page (POST /patients) — the same
              // destination as the Patients page's "Add patient" button.
              id: 'patients-new',
              labelKey: 'nav.patientsNew',
              path: routes.doctor.newPatient,
            },
          ],
        },
        {
          id: 'appointments',
          labelKey: 'nav.appointments',
          icon: Calendar,
          path: routes.doctor.appointments,
          children: [
            {
              id: 'appointments-all',
              labelKey: 'nav.appointments',
              path: routes.doctor.appointments,
            },
            {
              // The three-step booking page — the old dialog is gone.
              id: 'appointments-new',
              labelKey: 'nav.appointmentsNew',
              path: routes.doctor.bookAppointment(),
            },
          ],
        },
        {
          id: 'medical-records',
          labelKey: 'nav.medicalRecords',
          icon: FolderHeart,
          path: routes.doctor.medicalRecords,
          children: [
            {
              id: 'medical-records-all',
              labelKey: 'nav.medicalRecords',
              path: routes.doctor.medicalRecords,
            },
            {
              id: 'medical-records-new',
              labelKey: 'nav.medicalRecordsNew',
              path: routes.doctor.newMedicalRecord(),
              // The capability the API's record controller requires to create one.
              requiredPermission: 'records.edit',
            },
          ],
        },
        {
          id: 'assistant',
          labelKey: 'nav.assistant',
          icon: MedoraAiLogo,
          path: routes.doctor.assistant,
          requiredPermission: 'ai.use',
        },
      ],
    },
    {
      labelKey: 'nav.section.clinical',
      items: [
        { id: 'my-clinic', labelKey: 'nav.myClinic', icon: Stethoscope, path: routes.doctor.myClinic },
        {
          id: 'labs',
          labelKey: 'nav.labs',
          icon: FlaskConical,
          path: routes.doctor.labs,
          children: [
            { id: 'labs-all', labelKey: 'nav.labs', path: routes.doctor.labs },
            {
              // The existing order page (POST /lab-orders) — the same
              // destination as the Labs page's "New order" button and the
              // dashboard's "Order lab" quick action.
              id: 'labs-new',
              labelKey: 'nav.labsNew',
              path: routes.doctor.newLabOrder(),
            },
          ],
        },
        {
          id: 'pharmacy',
          labelKey: 'nav.pharmacy',
          icon: Pill,
          path: routes.doctor.pharmacy,
          children: [
            { id: 'pharmacy-all', labelKey: 'nav.pharmacyAll', path: routes.doctor.pharmacy },
            {
              id: 'pharmacy-new',
              labelKey: 'nav.pharmacyNew',
              path: routes.doctor.newPrescription(),
              requiredPermission: 'prescriptions.create',
            },
          ],
        },
      ],
    },
    {
      labelKey: 'nav.section.inbox',
      items: [
        {
          id: 'messages',
          labelKey: 'nav.messages',
          icon: MessageSquare,
          path: routes.doctor.messages,
          badgeSource: 'messages',
        },
        {
          id: 'notifications',
          labelKey: 'nav.notifications',
          icon: Bell,
          path: routes.doctor.notifications,
          badgeSource: 'notifications',
        },
        { id: 'reports', labelKey: 'nav.reports', icon: TrendingUp, path: routes.doctor.reports },
      ],
    },
  ],
  bottomTabIds: ['overview', 'patients', 'appointments', 'messages'],
  searchPlaceholderKey: 'shell.searchPlaceholder',
};

/**
 * Admin menu — the administration area's sections (Phase B). Previously the
 * area rendered its own rail inside its own shell; it now runs on the same
 * AppShell as the doctor workspace, so its navigation is plain config like
 * every other role's. Groups mirror the old rail's grouping.
 *
 * The first group is the Administrator Dashboard's own Overview (ADM-01),
 * which took `/admin` from the clinic page in Phase C; clinic operations
 * keep their own entry beneath it. The rest of UX §3 joins whichever group
 * fits the screen: System Logs (ADM-07) and Communication Monitoring
 * (ADM-06) both landed in Governance, as the platform's two oversight
 * surfaces rather than live clinic operations; Admin Reports will follow
 * when it lands.
 */
export const adminNavigation: NavigationConfig = {
  role: 'admin',
  sections: [
    {
      items: [
        {
          id: 'overview',
          labelKey: 'nav.overview',
          icon: LayoutDashboard,
          path: routes.admin.root,
          end: true,
        },
        {
          id: 'clinic',
          labelKey: 'nav.clinicOverview',
          icon: Activity,
          path: routes.admin.clinic,
        },
        /*
         * Reports (ADM-08) sits with the two overviews rather than under
         * Governance: it answers "how is the platform doing", which is the
         * same question those two answer at a shorter horizon, while
         * Governance is where an administrator goes to audit a specific thing
         * that happened.
         */
        {
          id: 'reports',
          labelKey: 'nav.reports',
          icon: ChartColumnBig,
          path: routes.admin.reports,
        },
      ],
    },
    {
      labelKey: 'nav.section.liveOperations',
      items: [
        {
          id: 'doctors',
          labelKey: 'nav.doctors',
          icon: Stethoscope,
          path: routes.admin.doctors,
          // Verifications waiting on an administrator (FE-10.10).
          badgeSource: 'pendingRequests',
        },
        {
          id: 'patients',
          labelKey: 'nav.patients',
          icon: UsersRound,
          path: routes.admin.patients,
        },
        {
          id: 'appointments',
          labelKey: 'nav.appointments',
          icon: CalendarCheck,
          path: routes.admin.section('appointments'),
        },
        /*
         * Queue and Waiting Room belong to the reception sidebar. The admin
         * pages remain at /admin/queue and /admin/waiting-room for an
         * administrator who follows a link or a saved landing page there.
         */
      ],
    },
    {
      labelKey: 'nav.section.peopleAndTime',
      items: [
        { id: 'staff', labelKey: 'nav.staff', icon: Users, path: routes.admin.section('staff') },
        {
          id: 'departments',
          labelKey: 'nav.departments',
          icon: Building2,
          path: routes.admin.section('departments'),
        },
        {
          id: 'shifts',
          labelKey: 'nav.shifts',
          icon: CalendarRange,
          path: routes.admin.section('shifts'),
        },
        {
          id: 'schedule',
          labelKey: 'nav.workingSchedule',
          icon: Clock,
          path: routes.admin.section('schedule'),
        },
        {
          id: 'holidays',
          labelKey: 'nav.holidays',
          icon: CalendarOff,
          path: routes.admin.section('holidays'),
        },
      ],
    },
    {
      labelKey: 'nav.section.facility',
      items: [
        { id: 'rooms', labelKey: 'nav.rooms', icon: DoorOpen, path: routes.admin.section('rooms') },
        {
          id: 'resources',
          labelKey: 'nav.resources',
          icon: Package,
          path: routes.admin.section('resources'),
        },
      ],
    },
    {
      labelKey: 'nav.section.governance',
      items: [
        {
          id: 'communications',
          labelKey: 'nav.communications',
          icon: MessagesSquare,
          path: routes.admin.communications,
        },
        {
          id: 'logs',
          labelKey: 'nav.logs',
          icon: FileSearch,
          path: routes.admin.logs,
        },
        {
          id: 'announcements',
          labelKey: 'nav.announcements',
          icon: Megaphone,
          path: routes.admin.section('announcements'),
        },
        {
          id: 'policies',
          labelKey: 'nav.policies',
          icon: ScrollText,
          path: routes.admin.section('policies'),
        },
        {
          id: 'templates',
          labelKey: 'nav.templates',
          icon: FileText,
          path: routes.admin.section('templates'),
        },
      ],
    },
  ],
  /*
   * UX §5's four admin slots (ADM-11). These were the Phase B clinic set —
   * overview · queue · waiting-room · staff — chosen when those were the
   * only admin screens that existed. With ADM-02/04/05/07 live the slots
   * were wrong rather than missing: a phone-sized admin got the clinic's
   * live-operations board and no route to doctors, appointments or the
   * audit log. Clinic operations remain one tap away under "More".
   *
   * Platform Settings is pinned in the sidebar footer, so it is not
   * repeated here. My Profile is not a sidebar item at all: it lives in the
   * navbar avatar menu, the same place the doctor workspace keeps it, so the
   * two roles reach their profile the same way and the rail does not list
   * it twice.
   */
  bottomTabIds: ['overview', 'doctors', 'appointments', 'logs'],
  searchPlaceholderKey: 'shell.searchPlaceholder',
};

/*
 * Staff workspaces (DEC-006a). Each lists only what its role can use against
 * the current API; the unavailable work (booking, the lab worklist, the
 * prescription queue) is stated on the role's home page, not offered as a
 * dead link. `requiredPermission` mirrors the server's own capability check,
 * so a matrix change that withdraws one also withdraws the entry — but the
 * server stays the boundary either way.
 */

export const receptionNavigation: NavigationConfig = {
  role: 'reception',
  sections: [
    {
      items: [
        {
          id: 'home',
          labelKey: 'nav.overview',
          icon: LayoutDashboard,
          path: routes.reception.root,
          end: true,
        },
        {
          id: 'appointments',
          labelKey: 'nav.appointments',
          icon: CalendarCheck,
          path: routes.reception.appointments,
          requiredPermission: 'appointments.reassign',
        },
        /*
         * No `requiredPermission`: the server admits these two by ROLE
         * (`@Roles('admin', 'reception')` on their read endpoints), and the
         * workspace's own role guard is the matching check here.
         */
        { id: 'queue', labelKey: 'nav.queue', icon: ListOrdered, path: routes.reception.queue },
        {
          id: 'waiting-room',
          labelKey: 'nav.waitingRoom',
          icon: Armchair,
          path: routes.reception.waitingRoom,
        },
        {
          id: 'patients',
          labelKey: 'nav.patients',
          icon: Users,
          path: routes.reception.patients,
          requiredPermission: 'patients.view',
        },
      ],
    },
  ],
  bottomTabIds: ['home', 'appointments', 'patients'],
  searchPlaceholderKey: null,
};

export const laboratoryNavigation: NavigationConfig = {
  role: 'laboratory',
  sections: [
    {
      items: [
        {
          id: 'home',
          labelKey: 'nav.overview',
          icon: LayoutDashboard,
          path: routes.laboratory.root,
          end: true,
        },
        {
          id: 'catalogue',
          labelKey: 'nav.testCatalogue',
          icon: FlaskConical,
          path: routes.laboratory.catalogue,
          requiredPermission: 'labs.review',
        },
        {
          id: 'patients',
          labelKey: 'nav.patients',
          icon: Users,
          path: routes.laboratory.patients,
          requiredPermission: 'patients.view',
        },
      ],
    },
  ],
  bottomTabIds: ['home', 'catalogue', 'patients'],
  searchPlaceholderKey: null,
};

export const pharmacyNavigation: NavigationConfig = {
  role: 'pharmacy',
  sections: [
    {
      items: [
        {
          id: 'home',
          labelKey: 'nav.overview',
          icon: LayoutDashboard,
          path: routes.pharmacy.root,
          end: true,
        },
        {
          id: 'patients',
          labelKey: 'nav.patients',
          icon: Users,
          path: routes.pharmacy.patients,
          requiredPermission: 'patients.view',
        },
      ],
    },
  ],
  bottomTabIds: ['home', 'patients'],
  searchPlaceholderKey: null,
};

