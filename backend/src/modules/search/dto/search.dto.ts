/**
 * The search result shape — API §16.1's `SearchResult{id,label,hint,
 * section,path?}`.
 *
 * ## Transcribed from the shell, not designed here
 *
 * `frontend/src/layouts/search-context.ts` types the panel's row as
 * `{ id, label, hint, path }` and both existing client-side indexes
 * (`useAdminSearchIndex`, `useDoctorSearchIndex`) build exactly that. The
 * contract adds `section`, which the frontend derives today from the
 * path; carrying it explicitly is what lets a client group without
 * parsing a URL.
 *
 * `path` is optional in the contract and always present here. A result a
 * user cannot navigate to is a row that does nothing when clicked, and
 * every source below knows where its own thing lives.
 */

export interface SearchResult {
  /** Stable within a response. Prefixed by kind, as both indexes do. */
  readonly id: string;
  /** Primary line — the thing itself. */
  readonly label: string;
  /** Secondary line — what kind of thing it is, and where it lives. */
  readonly hint: string;
  /** The section the result belongs to, for grouping without a parse. */
  readonly section: string;
  /** Absolute client path to navigate to. */
  readonly path: string;
}

export interface SearchGroup {
  /** Machine key — `patients`, `appointments`, `settings`, … */
  readonly key: string;
  /** Human heading for the panel. */
  readonly label: string;
  readonly results: readonly SearchResult[];
}

export interface SearchResponse {
  readonly query: string;
  readonly scope: string;
  readonly groups: readonly SearchGroup[];
  readonly totalItems: number;
}

/**
 * The administration destinations — the half of the admin index that is
 * not database rows.
 *
 * M26.2's verify step is `"backup" finds the Backup settings panel`, and
 * a panel is not a table: it is a page in the shell. The seventeen
 * panels and the twenty-two sections are **transcribed** from
 * `admin-settings.types.ts`'s `SETTINGS_PANELS` and `routes/index.ts`'s
 * `AdminSectionSlug`, which is also where `useAdminSearchIndex` reads
 * them. Two hand-kept lists will drift, so the parity spec asserts this
 * one against the frontend module directly rather than against a copy.
 *
 * Paths are built the way `routes.admin.*` builds them, including the
 * one irregular case: `section('overview')` is `/admin`, not
 * `/admin/overview`.
 */
export interface Destination {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly section: string;
  readonly path: string;
}

const SETTINGS_PANELS: readonly { id: string; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'organization', label: 'Organization' },
  { id: 'branding', label: 'Branding' },
  { id: 'localization', label: 'Localization' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
  { id: 'security', label: 'Security' },
  { id: 'users', label: 'Users & Permissions' },
  { id: 'roles', label: 'Roles & Permissions' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'audit', label: 'Audit Logs' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'backup', label: 'Backup & Restore' },
  { id: 'retention', label: 'Data Retention' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'about', label: 'About' },
];

const ADMIN_SECTIONS: readonly { slug: string; label: string }[] = [
  { slug: 'overview', label: 'Overview' },
  { slug: 'clinic', label: 'Clinic Overview' },
  { slug: 'doctors', label: 'Doctors' },
  { slug: 'patients', label: 'Patients' },
  { slug: 'appointments', label: 'Appointments' },
  { slug: 'staff', label: 'Staff' },
  { slug: 'departments', label: 'Departments' },
  { slug: 'rooms', label: 'Rooms' },
  { slug: 'resources', label: 'Resources' },
  { slug: 'schedule', label: 'Schedule' },
  { slug: 'holidays', label: 'Holidays' },
  { slug: 'shifts', label: 'Shifts' },
  { slug: 'queue', label: 'Queue' },
  { slug: 'waiting-room', label: 'Waiting Room' },
  { slug: 'announcements', label: 'Announcements' },
  { slug: 'policies', label: 'Policies' },
  { slug: 'templates', label: 'Templates' },
  { slug: 'communications', label: 'Communications' },
  { slug: 'logs', label: 'System Logs' },
  { slug: 'reports', label: 'Reports' },
  { slug: 'settings', label: 'Settings' },
  { slug: 'preferences', label: 'My Settings' },
  { slug: 'profile', label: 'My Profile' },
];

/** `routes.admin.section` — `overview` is the area index, so `/admin`. */
export function adminSectionPath(slug: string): string {
  return slug === 'overview' ? '/admin' : `/admin/${slug}`;
}

export const ADMIN_DESTINATIONS: readonly Destination[] = [
  ...SETTINGS_PANELS.map((panel) => ({
    id: `set-${panel.id}`,
    label: panel.label,
    hint: 'Settings · Settings',
    section: 'settings',
    path: `/admin/settings/${panel.id}`,
  })),
  ...ADMIN_SECTIONS.map((section) => ({
    id: `nav-${section.slug}`,
    label: section.label,
    hint: `Go to · ${section.label}`,
    section: section.slug,
    path: adminSectionPath(section.slug),
  })),
];

/** The doctor shell's own destinations, from `routes.doctor`. */
export const DOCTOR_DESTINATIONS: readonly Destination[] = [
  { id: 'nav-overview', label: 'Overview', section: 'overview', path: '/doctor' },
  { id: 'nav-patients', label: 'Patients', section: 'patients', path: '/doctor/patients' },
  {
    id: 'nav-appointments',
    label: 'Appointments',
    section: 'appointments',
    path: '/doctor/appointments',
  },
  {
    id: 'nav-records',
    label: 'Medical Records',
    section: 'records',
    path: '/doctor/medical-records',
  },
  { id: 'nav-labs', label: 'Labs', section: 'labs', path: '/doctor/labs' },
  { id: 'nav-pharmacy', label: 'Pharmacy', section: 'pharmacy', path: '/doctor/pharmacy' },
  { id: 'nav-messages', label: 'Messages', section: 'messages', path: '/doctor/messages' },
  { id: 'nav-reports', label: 'Reports', section: 'reports', path: '/doctor/reports' },
  { id: 'nav-settings', label: 'Settings', section: 'settings', path: '/doctor/settings/profile' },
].map((entry) => ({ ...entry, hint: `Go to · ${entry.label}` }));
