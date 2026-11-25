/**
 * Route paths — FRONTEND_ARCHITECTURE.md §2 (routes/).
 * The single source for every href in the app; no string-literal paths
 * in components. Builders return typed paths for parameterized routes.
 * Contract: UX_ARCHITECTURE.md §1.3.
 */

export const routes = {
  root: '/',
  login: '/login',
  signup: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  /**
   * Where an administrator invitation link lands (ADR-035 §5). The
   * backend's `AuthMailService.sendAdminInvitation` builds
   * `<APP_PUBLIC_URL>/accept-invitation?token=…`, so this path is a
   * contract with the mail template rather than a free choice.
   */
  acceptInvitation: '/accept-invitation',
  verifyOtp: '/verify-otp',
  lockScreen: '/lock-screen',
  forbidden: '/403',
  notFound: '/404',

  doctor: {
    root: '/doctor',
    overview: '/doctor/overview',
    patients: '/doctor/patients',
    patient: (patientId: string) => `/doctor/patients/${patientId}`,
    /**
     * The Add Patient page — a page of its own, like New Appointment, under
     * the list's path as a static segment so it ranks above `:patientId`.
     */
    newPatient: '/doctor/patients/new',
    appointments: '/doctor/appointments',
    appointment: (appointmentId: string) => `/doctor/appointments/${appointmentId}`,
    /**
     * The New Appointment page, optionally with this patient already chosen
     * (NEW-06). A page of its own now — booking outgrew the dialog it started
     * as — under the book's path as a static segment, so react-router ranks
     * it above `:appointmentId`. The book still redirects the old
     * `?book=<patientId>` links here, so bookmarks keep working.
     */
    bookAppointment: (options?: { patientId?: string }) =>
      options?.patientId === undefined || options.patientId === ''
        ? '/doctor/appointments/new'
        : `/doctor/appointments/new?patient=${encodeURIComponent(options.patientId)}`,
    /**
     * The doctor's time off as pages of their own (API §3.9): the upcoming
     * list and the block form. Static segments under the book's path, so
     * react-router ranks them above `:appointmentId`.
     */
    upcomingTimeOff: '/doctor/appointments/time-off',
    blockTimeOff: '/doctor/appointments/time-off/new',
    medicalRecords: '/doctor/medical-records',
    medicalRecord: (recordId: string) => `/doctor/medical-records/${recordId}`,
    /**
     * The four-step record authoring flow (D-21). A static segment under the
     * records path, so react-router ranks it above `:recordId`. `patient`
     * pre-selects and opens on the encounter step.
     */
    newMedicalRecord: (options?: { patientId?: string }) =>
      options?.patientId === undefined
        ? '/doctor/medical-records/new'
        : `/doctor/medical-records/new?patient=${options.patientId}`,
    assistant: '/doctor/ai',
    /** The doctor's own clinic board — their clinic only (D-27b). */
    myClinic: '/doctor/my-clinic',
    labs: '/doctor/labs',
    /**
     * The lab ordering flow (DX-23). A static segment under the labs path so
     * react-router ranks it above `:labId`, matching how the prescription and
     * record flows are addressed. `patient` pre-selects and opens on tests.
     */
    newLabOrder: (options?: { patientId?: string }) =>
      options?.patientId === undefined
        ? '/doctor/labs/new'
        : `/doctor/labs/new?patient=${options.patientId}`,
    labReport: (reportId: string) => `/doctor/labs/${reportId}`,
    pharmacy: '/doctor/pharmacy',
    /**
     * The four-step authoring flow (D-17). A static segment under the
     * pharmacy path, so react-router ranks it above `:prescriptionId`.
     * `patient` pre-selects and opens on step 2; `draft` resumes a saved or
     * renewal draft.
     */
    newPrescription: (options?: { patientId?: string; draftId?: string }) => {
      const params = new URLSearchParams();
      if (options?.patientId !== undefined) params.set('patient', options.patientId);
      if (options?.draftId !== undefined) params.set('draft', options.draftId);
      const query = params.toString();
      return query === '' ? '/doctor/pharmacy/new' : `/doctor/pharmacy/new?${query}`;
    },
    prescription: (prescriptionId: string) => `/doctor/pharmacy/${prescriptionId}`,
    /**
     * The inbox. `compose` opens the new-message dialog and `patient`
     * opens (or creates) that patient's thread — the D-24 entry points, so
     * a screen outside messaging can start a conversation without importing
     * the feature (§3.4). Both are query params rather than routes because
     * composing is a state of the inbox, not a page of its own.
     */
    messages: '/doctor/messages',
    composeMessage: (options?: { patientId?: string }) =>
      options?.patientId === undefined
        ? '/doctor/messages?compose=1'
        : `/doctor/messages?patient=${options.patientId}`,
    /**
     * New message, step one: choose the patient to write to. A static
     * segment under the inbox, so react-router ranks it above
     * `:conversationId`.
     */
    newMessage: '/doctor/messages/new',
    conversation: (conversationId: string) => `/doctor/messages/${conversationId}`,
    notifications: '/doctor/notifications',
    reports: '/doctor/reports',
    settings: (section: DoctorSettingsSection = 'profile') => `/doctor/settings/${section}`,
  },

  admin: {
    root: '/admin',
    /**
     * The administration area's sections (Phase B). Formerly mounted under
     * `/doctor/administration`, which was left over from Phase 17 when the
     * area was doctor-facing; it has been admin-only since Phase 19. The
     * overview is the area index, so `section('overview')` is `/admin`.
     */
    section: (slug: AdminSectionSlug = 'overview') =>
      slug === 'overview' ? '/admin' : `/admin/${slug}`,
    settings: (panel?: string) => (panel ? `/admin/settings/${panel}` : '/admin/settings'),

    /**
     * Appointment oversight (ADM-05, Phase C). Mounted as an admin section,
     * so this is the same path `section('appointments')` builds — kept as a
     * named key because the screen is a destination in its own right, not a
     * clinic-management section like Rooms or Shifts.
     */
    appointments: '/admin/appointments',

    /**
     * Clinic operations (the Administration Center's own overview). It was
     * the area index until ADM-01 put the Administrator Overview there.
     */
    clinic: '/admin/clinic',

    /**
     * Doctors management and the admin doctor profile (ADM-02 / ADM-03).
     * `doctors` is the section path; the profile is its child route.
     */
    doctors: '/admin/doctors',
    doctor: (doctorId: string) => `/admin/doctors/${doctorId}`,

    /**
     * Patients management and the admin patient account view (ADM-04).
     * Same shape as doctors: a section path with the account as its child.
     */
    patients: '/admin/patients',
    patient: (patientId: string) => `/admin/patients/${patientId}`,

    /* ── Reserved for the Administrator Dashboard (UX §3, Phase C) ──── */
    communications: '/admin/communications',
    /**
     * The watermarked conversation viewer (ADM-06B), a child of
     * `communications` the same way `doctor`/`patient` are children of
     * their section paths. A grant is created for exactly one
     * conversation and the viewer route reads `conversationId` from the
     * URL, so every navigation into it must build its path through this
     * helper rather than a string literal.
     */
    conversation: (conversationId: string) => `/admin/communications/${conversationId}`,
    logs: '/admin/logs',
    reports: '/admin/reports',
  },

  /*
   * Staff workspaces (DEC-006 / DEC-006a). Each role has its own area, so a
   * guard can tell them apart and a deep link cannot cross from one into
   * another. Settings reuse the doctor Settings Center with the sections a
   * non-practitioner can use (`STAFF_SETTINGS_SECTIONS`).
   */
  reception: {
    root: '/reception',
    appointments: '/reception/appointments',
    /**
     * The clinic-operations screens the front desk owns in its sidebar. The
     * same screens the admin area serves at `/admin/queue` and
     * `/admin/waiting-room` (still reachable there by URL for an administrator).
     */
    queue: '/reception/queue',
    waitingRoom: '/reception/waiting-room',
    patients: '/reception/patients',
    settings: (section: DoctorSettingsSection = 'account') => `/reception/settings/${section}`,
  },
  laboratory: {
    root: '/laboratory',
    catalogue: '/laboratory/catalogue',
    patients: '/laboratory/patients',
    settings: (section: DoctorSettingsSection = 'account') => `/laboratory/settings/${section}`,
  },
  pharmacy: {
    root: '/pharmacy',
    patients: '/pharmacy/patients',
    settings: (section: DoctorSettingsSection = 'account') => `/pharmacy/settings/${section}`,
  },

  /** Pre-Phase-B paths, kept so existing links and bookmarks still resolve. */
  legacy: {
    administrationRoot: '/doctor/administration',
  },
} as const;

export type DoctorSettingsSection =
  | 'profile'
  | 'verification'
  | 'account'
  | 'security'
  | 'privacy'
  | 'notifications'
  | 'availability'
  | 'appearance'
  | 'preferences'
  | 'accessibility'
  | 'integrations'
  | 'activity'
  | 'about';

/**
 * Sections of the administration area. Declared in the platform routes layer
 * so hrefs stay centralized; the feature imports this union rather than
 * re-declaring path strings.
 */
export type AdminSectionSlug =
  | 'overview'
  | 'clinic'
  | 'doctors'
  | 'patients'
  | 'appointments'
  | 'staff'
  | 'departments'
  | 'rooms'
  | 'resources'
  | 'schedule'
  | 'holidays'
  | 'shifts'
  | 'queue'
  | 'waiting-room'
  | 'announcements'
  | 'policies'
  | 'templates'
  | 'communications'
  | 'logs'
  | 'reports'
  | 'settings'
  | 'preferences'
  | 'profile';

/**
 * The Settings Center sections a non-practitioner account can use (DEC-006a).
 * `profile` is the practitioner profile (`/me/profile` answers 404 without a
 * `doctors` row) and `preferences` chooses a doctor landing page, so neither
 * is offered; privacy, notification and integration preferences have no
 * server route at all (FE-10 "Still Mock"), so they are left out rather than
 * shown as "Not connected yet" in a workspace that never had them.
 */
export const STAFF_SETTINGS_SECTIONS: readonly DoctorSettingsSection[] = [
  'account',
  'security',
  'appearance',
  'accessibility',
  'activity',
  'about',
];

/**
 * Sections only a practitioner has data behind, so the administrator's copy
 * of the Settings Center leaves them out rather than offer a form that can
 * only fail — and, since the page redirects a section it does not offer, an
 * administrator who opens one by URL lands on Account:
 *
 * - `profile` (DEC-007) — the professional profile. `GET /me/profile` reads
 *   for anyone, but `PATCH` answers 404 without a `doctors` row (ADR-036), so
 *   an admin's save always failed (FE-10 F41). What an admin can change about
 *   themselves is in Account (`/me/account`).
 * - `availability` (DEC-005) — `/me/availability` answers 404 likewise.
 * - `verification` (NEW-46) — `/me/verification-documents` answers 404
 *   without a `doctors` row, for the same reason.
 */
export const PRACTITIONER_SETTINGS_SECTIONS: readonly DoctorSettingsSection[] = [
  'profile',
  'verification',
  'availability',
];
