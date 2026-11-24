/**
 * English — the source catalogue (F-19).
 *
 * **English is the only file written by hand as prose.** Arabic is typed
 * `Messages` against this object — every key, so a key added here without its
 * Arabic is a compile error. French, Persian and Turkish are typed
 * `PartialMessages` (owner decision, 2026-11-23): a key they lack renders in
 * English. Adding a string is therefore: add it here, add it to `ar.ts`, and
 * add it to the other three when a translator has it. See `../README.md`.
 *
 * A plural message is an object of CLDR forms (`{ one, other }` in English;
 * all six — zero, one, two, few, many, other — in Arabic), selected by
 * `t(key, { count })`.
 *
 * Keys are namespaced by surface (`login.*`, `nav.*`, `ui.*`, `state.*`).
 * The `login.*` / `signup.*` / `otp.*` / `forgot.*` / `reset.*` /
 * `verifyEmail.*` / `lock.*` / `brand.*` / `strength.*` / `common.*` families
 * are inherited verbatim from the auth-local dictionary this replaced, so
 * every existing `t('login.title')` call site is unchanged.
 *
 * Interpolation is `{name}`; see `useT`.
 */

export const en = {
  // Brand panel
  'brand.welcome': 'Welcome to Medora',
  'brand.tagline': 'The AI-powered platform for modern healthcare teams.',
  'brand.benefit.records': 'Unified patient records, labs, and prescriptions',
  'brand.benefit.scheduling': 'Smart scheduling that adapts to your day',
  'brand.benefit.ai': 'AI assistance for notes, summaries, and safety checks',
  'brand.security': 'HIPAA-aligned · End-to-end encrypted',

  // Shared
  'common.email': 'Email address',
  'common.password': 'Password',
  'common.confirmPassword': 'Confirm password',
  'common.emailPlaceholder': 'you@hospital.org',
  'common.back': 'Back to sign in',
  'common.showPassword': 'Show password',
  'common.hidePassword': 'Hide password',
  'common.language': 'Language',
  'common.theme': 'Theme',
  'common.rateLimited': 'Too many attempts. Wait a few minutes, then try again.',

  // Login
  'login.title': 'Sign in to Medora',
  'login.subtitle': 'Enter your credentials to access your workspace.',
  'login.remember': 'Remember me',
  'login.forgot': 'Forgot password?',
  'login.submit': 'Sign in',
  'login.noAccount': "Don't have an account?",
  'login.signupLink': 'Create one',
  'login.demoTitle': 'Demo credentials',
  'login.demoBody': 'Use these seeded accounts to explore the mock flows.',
  'login.error.invalid': 'Incorrect email or password. Please try again.',
  'login.error.generic': 'Something went wrong signing you in. Please try again.',
  'login.sessionEnded': 'Your session has ended. Sign in again to continue.',
  'login.error.inactive': 'This account is not active. Contact your administrator.',
  'login.error.twoFactorRequired':
    'This account requires two-factor authentication. Contact your administrator.',
  'login.error.rateLimited': 'Too many sign-in attempts. Wait a few minutes, then try again.',
  'login.error.unsupportedRole':
    "This account's role has no workspace in the Medora web app yet. Ask your administrator to assign a supported role.",
  'login.error.patientRole':
    'Patients use the Medora patient mobile app. Sign in there instead — the web app is for clinic staff.',

  // Signup
  'signup.title': 'Create your account',
  'signup.subtitle': 'Join your care team on Medora.',
  'signup.firstName': 'First name',
  'signup.lastName': 'Last name',
  'signup.phone': 'Phone number',
  'signup.professionalSection': 'Professional details',
  'signup.professionalNumber': 'Professional registration number',
  'signup.professionalNumberHelp': 'The number on your practising register entry',
  'signup.professionalCategory': 'Professional category',
  'signup.specialty': 'Specialty',
  'signup.registrationExpiry': 'Registration expires',
  'signup.registrationExpiryHelp': 'Optional',
  'signup.verificationNotice':
    'Your registration will be reviewed before your account is activated for clinical use.',
  'signup.terms': 'I agree to the Terms & Conditions',
  'signup.privacy': 'I have read the Privacy Policy',
  'signup.submit': 'Create account',
  'signup.haveAccount': 'Already have an account?',
  'signup.loginLink': 'Sign in',
  'signup.error.taken': 'An account with this email already exists.',
  'signup.error.professionalNumberTaken':
    'That professional registration number is already registered.',
  'signup.error.generic': 'We could not create your account. Please try again.',

  // Password strength
  'strength.label': 'Password strength',
  'strength.0': 'Very weak',
  'strength.1': 'Weak',
  'strength.2': 'Fair',
  'strength.3': 'Strong',
  'strength.4': 'Very strong',

  // Forgot password
  'forgot.title': 'Reset your password',
  'forgot.subtitle': "Enter your email and we'll send you a reset link.",
  'forgot.submit': 'Send reset link',
  'forgot.successTitle': 'Check your inbox',
  'forgot.successBody':
    'If an account exists for that email, a reset link is on its way. The link expires in 30 minutes.',
  'forgot.error.generic': 'We could not send the reset link. Please try again.',

  // Reset password
  'reset.title': 'Choose a new password',
  'reset.subtitle': 'Your new password must be different from previous ones.',
  'reset.newPassword': 'New password',
  'reset.submit': 'Reset password',
  'reset.successTitle': 'Password updated',
  'reset.successBody': 'Your password has been changed. You can now sign in.',
  'reset.successCta': 'Continue to sign in',
  'reset.error.token': 'This reset link is invalid or has expired.',
  'reset.error.generic': 'We could not reset your password. Please try again.',

  // Verify email
  'verifyEmail.title': 'Verify your email',
  'verifyEmail.subtitle': "We've sent a verification link to your inbox.",
  'verifyEmail.pending': "Didn't get it? Check your spam folder or resend below.",
  'verifyEmail.resend': 'Resend email',
  'verifyEmail.resendIn': 'Resend available in',
  'verifyEmail.verifying': 'Verifying your email…',
  'verifyEmail.successTitle': 'Email verified',
  'verifyEmail.successBody': 'Your email is confirmed. You can now sign in.',
  'verifyEmail.successCta': 'Continue to sign in',
  'verifyEmail.error.token': 'This verification link is invalid or has expired.',
  'verifyEmail.error.resend': 'We could not send a new verification email. Please try again.',

  // Verify OTP
  'otp.title': 'Two-factor verification',
  'otp.subtitle': 'Enter the 6-digit code from your authenticator app.',
  'otp.hint': 'Demo code: 123456',
  'otp.submit': 'Verify',
  // The second factor is an authenticator app's code: nothing is sent, and
  // `POST /auth/otp/resend` extends the challenge window instead (backend
  // StepUpService). "Resend code" promised a message that never arrives.
  // When email or SMS delivery exists (RM M19) the wording goes back.
  'otp.resend': 'Need more time?',
  'otp.resendIn': 'More time available in',
  'otp.error.invalid': 'That code is incorrect. Please try again.',
  'otp.error.generic': 'We could not verify the code. Please try again.',
  'otp.error.expired': 'This sign-in has expired. Go back and sign in again.',
  'otp.useRecoveryCode': 'Use a recovery code instead',
  'otp.useAuthenticator': 'Use your authenticator app instead',
  'otp.recovery.subtitle':
    'Enter one of the recovery codes you saved when you turned on two-factor authentication. Each code works only once.',
  'otp.recovery.label': 'Recovery code',
  'otp.recovery.submit': 'Verify recovery code',
  'otp.recovery.error.invalid': 'That recovery code is not valid. Check it and try again.',
  'otp.recovery.error.generic': 'We could not verify the recovery code. Please try again.',

  // Lock screen
  'lock.title': 'Session locked',
  'lock.subtitle': 'Enter your password to continue where you left off.',
  'lock.unlock': 'Unlock',
  'lock.logout': 'Not you? Log out',
  'lock.error.invalid': 'Incorrect password. Please try again.',
  'lock.error.twoFactor':
    'This account uses two-factor sign-in, which the lock screen cannot complete. Log out, then sign in again.',
  'lock.error.generic': 'We could not unlock your session. Please try again.',
  'lock.error.lockedOut':
    'Too many incorrect attempts. For your security, this session has been signed out. Wait a few minutes, then sign in again.',
  'lock.signInAgain': 'Sign in again',

  /* ── Language switcher ──────────────────────────────────────── */
  'locale.label': 'Language',
  'locale.en': 'English',
  'locale.ar': 'Arabic',
  'locale.fr': 'French',
  'locale.fa': 'Persian',
  'locale.tr': 'Turkish',

  /* ── Shell chrome ───────────────────────────────────────────── */
  'shell.skipToContent': 'Skip to main content',
  'shell.navigation': 'Navigation',
  'shell.toggleNavigation': 'Toggle navigation',
  'shell.primary': 'Primary',
  'shell.breadcrumb': 'Breadcrumb',
  'shell.breadcrumbExpand': 'Show all breadcrumb levels',
  'shell.globalSearch': 'Global search',
  'shell.searchResults': 'Search results',
  'shell.searchPlaceholder': 'Search…',
  'shell.searchPatientsPlaceholder': 'Search patients…',
  'shell.notifications': 'Notifications',
  'shell.activeHospital': 'Active hospital: ',
  'shell.dismissNotification': 'Dismiss notification',
  'shell.unread': 'Unread',
  'shell.more': 'More',
  'shell.account': 'Account',
  'shell.profile': 'My Profile',
  'shell.settings': 'Settings',
  'shell.help': 'Help',
  'shell.signOut': 'Sign out',
  'shell.theme': 'Theme',
  'shell.themeLight': 'Light theme',
  'shell.themeDark': 'Dark theme',
  'shell.themeSystem': 'System theme',
  'shell.openAssistant': 'Open Medora AI',

  /* ── Navigation — doctor ────────────────────────────────────── */
  'nav.overview': 'Overview',
  'nav.patients': 'Patients',
  'nav.patientsNew': 'Add Patient',
  'nav.appointments': 'Appointments',
  'nav.appointmentsNew': 'Add Appointment',
  'nav.medicalRecords': 'Medical Records',
  'nav.medicalRecordsNew': 'New Medical Record',
  'nav.assistant': 'Medora AI',
  'nav.section.clinical': 'Clinical',
  'nav.myClinic': 'My clinic',
  'nav.labs': 'Labs',
  'nav.labsNew': 'New Order',
  'nav.pharmacy': 'Pharmacy',
  'nav.pharmacyAll': 'Prescriptions',
  'nav.pharmacyNew': 'New Prescription',
  'nav.testCatalogue': 'Test catalogue',
  'nav.section.inbox': 'Inbox',
  'nav.messages': 'Messages',
  'nav.notifications': 'Notifications',
  'nav.reports': 'Reports',

  /* ── Navigation — administrator ─────────────────────────────── */
  'nav.clinicOverview': 'Clinic Overview',
  'nav.section.liveOperations': 'Live operations',
  'nav.doctors': 'Doctors',
  'nav.queue': 'Queue',
  'nav.waitingRoom': 'Waiting Room',
  'nav.section.peopleAndTime': 'People & time',
  'nav.staff': 'Staff',
  'nav.departments': 'Departments',
  'nav.shifts': 'Shifts',
  'nav.workingSchedule': 'Working Schedule',
  'nav.holidays': 'Holidays',
  'nav.section.facility': 'Facility',
  'nav.rooms': 'Rooms',
  'nav.resources': 'Resources',
  'nav.section.governance': 'Governance',
  'nav.communications': 'Communication Monitoring',
  'nav.logs': 'System Logs',
  'nav.announcements': 'Announcements',
  'nav.policies': 'Clinic Policies',
  'nav.templates': 'Document Templates',
  'nav.section.account': 'Account',

  /* ── Shared states ──────────────────────────────────────────── */
  'state.loading': 'Loading…',
  'state.error': 'Something went wrong',
  'state.errorBody': 'We could not load this. Please try again.',
  'state.retry': 'Try again',
  'state.empty': 'Nothing to show',
  'state.emptyBody': 'There is nothing here yet.',
  'state.noResults': 'No results',
  'state.noResultsBody': 'No items match the current filters.',
  'state.offline': 'You appear to be offline.',

  /* ── Shared controls ────────────────────────────────────────── */
  'ui.search': 'Search',
  'ui.clearSearch': 'Clear search',
  'ui.filters': 'Filters',
  'ui.activeFilters': 'Active filters',
  'ui.clearFilters': 'Clear filters',
  'ui.export': 'Export',
  'ui.close': 'Close',
  'ui.closeDialog': 'Close dialog',
  'ui.closePanel': 'Close panel',
  'ui.dismiss': 'Dismiss message',
  'ui.cancel': 'Cancel',
  'ui.confirm': 'Confirm',
  'ui.save': 'Save',
  'ui.saving': 'Saving…',
  'ui.edit': 'Edit',
  'ui.delete': 'Delete',
  'ui.add': 'Add',
  'ui.required': 'Required',
  'ui.optional': 'Optional',
  'ui.select': 'Select…',
  'ui.selectAllRows': 'Select all rows',
  'ui.sortBy': 'Sort by',
  'ui.pagination': 'Pagination',
  'ui.previousPage': 'Previous page',
  'ui.nextPage': 'Next page',
  'ui.rowsPerPage': 'Rows per page',
  'ui.pageOf': 'Page {page} of {total}',
  'ui.zoomIn': 'Zoom in',
  'ui.zoomOut': 'Zoom out',

  /* ── Multi-step flows (FlowStepper) ─────────────────────────── */
  'flow.stepOf': 'Step {step} of {total}',
  'flow.complete': 'complete',
  'flow.current': 'current',
  'flow.locked': 'locked',

  /* ── Form validation ────────────────────────────────────────── */
  'validation.required': 'This field is required',
  'validation.email': 'Enter a valid email address',
  'validation.minLength': 'Must be at least {count} characters',
  'validation.passwordMismatch': 'Passwords do not match',
  'validation.selectOne': 'Choose an option',

  // Administrator invitation (ADR-035 §5)
  'invitation.title': 'Accept your invitation',
  'invitation.subtitle': 'Choose a password for your Medora administrator account.',
  'invitation.mfaNotice':
    'Administrator accounts require two-factor authentication. You will set it up on the next step.',
  'invitation.submitPassword': 'Continue',
  'invitation.mfaTitle': 'Set up two-factor authentication',
  'invitation.mfaSubtitle': 'Add this key to your authenticator app, then enter the code it shows.',
  'invitation.secretLabel': 'Setup key',
  'invitation.secretHelp': 'Enter this key manually in your authenticator app.',
  'invitation.recoveryLabel': 'Recovery codes',
  'invitation.recoveryHelp': 'Save these now. They are shown once and cannot be retrieved later.',
  'invitation.codeLabel': 'Enter the 6-digit code',
  'invitation.submitCode': 'Activate account',
  'invitation.successTitle': 'Your account is active',
  'invitation.successBody':
    'Sign in with your email, your new password and your authenticator code.',
  'invitation.successCta': 'Go to sign in',
  'invitation.error.token':
    'This invitation link is no longer valid. Ask an administrator for a new one.',
  'invitation.error.code': 'That code is not valid. Check your authenticator and try again.',
  'invitation.error.taken': 'An account with this email already exists.',
  'invitation.error.weakPassword': 'Choose a stronger password.',
  'invitation.error.generic': 'We could not complete your invitation. Please try again.',
  /* ── Shared controls, continued (foundation phase) ─────────── */
  'ui.goBack': 'Go back',
  'ui.done': 'Done',
  'ui.remove': 'Remove',
  'ui.removeAll': 'Remove all',
  'ui.removeItem': 'Remove {label}',
  'ui.removeFilter': 'Remove filter: {label}',
  'ui.clearAll': 'Clear all',
  'ui.reset': 'Reset',
  'ui.center': 'Center',
  'ui.zoom': 'Zoom',
  'ui.retry': 'Retry',
  'ui.loadingShort': 'Loading',
  'ui.mainNavigation': 'Main',
  'ui.selectRow': 'Select row {id}',
  'ui.tableLoadError': 'Couldn\'t load this table',
  'ui.tableEmpty': 'No records to show',
  'ui.sectionLoadError': 'Couldn\'t load this section',
  'ui.loadErrorNamed': 'Couldn\'t load {name}',
  'ui.notConnected': 'Not connected yet',
  'ui.notConnectedBody': 'This area is not available from the Medora server in this deployment.',
  'ui.showingRange': 'Showing {from}–{to} of {total}',
  'ui.pageNumber': 'Page {page}',
  'ui.resultCount': { one: '{count} result', other: '{count} results' },
  'ui.viewDetails': 'View {label} details',
  'ui.exportOptions': 'Export options',
  'ui.exportCsv': 'Export as CSV',
  'ui.exportExcel': 'Export as Excel',
  'ui.exportPdf': 'Export as PDF',
  'ui.print': 'Print',
  /* ── Customizable dashboards ──────────────────────────────── */
  'dashboard.label': 'Dashboard',
  'dashboard.widgets': 'Dashboard widgets',
  'dashboard.customize': 'Customize',
  'dashboard.customizeTitle': 'Customize dashboard',
  'dashboard.customizeIntro':
    'Choose what appears on your Overview. Your dashboard updates when you select Done, and the layout rearranges itself around whatever you pick.',
  'dashboard.widgetsSelected': '{selected} of {total} widgets selected',
  'dashboard.sampleData': 'Sample data',
  'dashboard.notAvailableYet': 'Not available yet',
  'dashboard.greeting.morning': 'Good morning, {name}',
  'dashboard.greeting.afternoon': 'Good afternoon, {name}',
  'dashboard.greeting.evening': 'Good evening, {name}',
  /* ── Profile photo field ──────────────────────────────────── */
  'photo.title': 'Profile photo',
  'photo.change': 'Change photo',
  'photo.upload': 'Upload photo',
  'photo.uploadLabel': 'Upload profile photo',
  'photo.hint': 'JPG or PNG. You can zoom, move, and crop before saving.',
  'photo.editTitle': 'Edit profile photo',
  'photo.editDescription': 'Drag to move, zoom to frame, then crop to a circle.',
  'photo.save': 'Save photo',
  'photo.error.notImage': 'Choose an image file.',
  'photo.error.tooLarge': 'Keep the image under 4 MB.',
  'photo.error.unreadable': 'Could not read that file.',
  'photo.error.unloadable': 'Could not load that image.',
  'photo.error.process': 'Could not process the image.',
  /* ── Rich text ────────────────────────────────────────────── */
  'richText.copyCode': 'Copy code',
  'richText.copied': 'Copied',
  'richText.copyFailedShort': 'Couldn\'t copy',
  'richText.codeCopied': 'Code copied',
  'richText.copyFailed': 'Couldn\'t copy the code — select it instead',
  'richText.copyToClipboard': 'Copy code to clipboard',
  'richText.helper': 'Markdown: **bold**, *italic*, `code`, - lists, ## headings.',
  'richText.bold': 'Bold',
  'richText.italic': 'Italic',
  'richText.bulletedList': 'Bulleted list',
  'richText.list': 'List',
  'richText.preview': 'Preview',
  'richText.write': 'Write',
  'richText.previewOf': '{label} — preview',
  'richText.empty': 'Nothing written yet.',
  /* ── Shell chrome, continued ──────────────────────────────── */
  'shell.pageLoadError': 'This page couldn\'t be loaded',
  'shell.pageLoadErrorBody':
    'Something went wrong while rendering it. The rest of Medora is unaffected — use the menu to go somewhere else, or try again.',
  'shell.searching': 'Searching…',
  'shell.noMatches': 'No matches for “{term}”.',
  'shell.notificationUnread': '{title} (unread) — mark as read',
  'shell.allCaughtUp': 'You\'re all caught up',
  'shell.allCaughtUpBody': 'New notifications appear here as clinical activity happens.',
  'shell.markAllRead': 'Mark all as read',
  'shell.clearRead': 'Clear read',
  'shell.viewAllNotifications': 'View all notifications',
  'shell.unreadCount': { one: '{count} unread', other: '{count} unread' },
  'shell.notificationsUnread': {
    one: 'Notifications ({count} unread)',
    other: 'Notifications ({count} unread)',
  },
  'shell.unreadNotificationsBadge': {
    one: '{count} unread — Notifications',
    other: '{count} unread — Notifications',
  },
  'shell.loadingAdministration': 'Loading the administration area',
  /* ── Page titles (route handles: document title, announcer, breadcrumb) ── */
  'route.newAppointment': 'New appointment',
  'route.appointment': 'Appointment',
  'route.newLabOrder': 'New order',
  'route.labResult': 'Result',
  'route.medicalRecords': 'Medical records',
  'route.newRecord': 'New record',
  'route.record': 'Record',
  'route.addPatient': 'Add patient',
  'route.patientProfile': 'Patient profile',
  'route.newPrescription': 'New prescription',
  'route.prescription': 'Prescription',
  'route.patientDirectory': 'Patient directory',
  'route.doctorProfile': 'Doctor profile',
  'route.patientAccount': 'Patient account',
  'route.conversation': 'Conversation',
  /* ── Administration sections (SECTION_META) ───────────────── */
  'admin.section.overview': 'Overview',
  'admin.section.overview.description':
    'Platform health, security alerts and the work waiting on you.',
  'admin.section.clinic': 'Clinic Overview',
  'admin.section.clinic.description': 'Live snapshot of today’s clinic activity and utilization.',
  'admin.section.doctors': 'Doctors',
  'admin.section.doctors.description':
    'Onboarding, verification, and the standing of every doctor on the platform.',
  'admin.section.patients': 'Patients',
  'admin.section.patients.description':
    'Account support, access governance and lifecycle — never clinical review.',
  'admin.section.appointments': 'Appointment Oversight',
  'admin.section.appointments.description':
    'Every doctor’s appointments, the ones that are stuck, and what to do about them.',
  'admin.section.queue': 'Queue Management',
  'admin.section.queue.description': 'Who is next, who is waiting and who is running late.',
  'admin.section.waitingRoom': 'Waiting Room',
  'admin.section.waitingRoom.description': 'Patients checked in and waiting to be seen.',
  'admin.section.staff': 'Staff Management',
  'admin.section.staff.description': 'Clinic team, roles, availability and permissions.',
  'admin.section.departments': 'Departments',
  'admin.section.departments.description': 'Clinic departments, their heads and staffing.',
  'admin.section.shifts': 'Shift Management',
  'admin.section.shifts.description': 'Weekly shift planner across the whole team.',
  'admin.section.schedule': 'Working Schedule',
  'admin.section.schedule.description': 'Clinic opening hours across the week.',
  'admin.section.holidays': 'Holidays',
  'admin.section.holidays.description': 'Public and clinic closures for the year.',
  'admin.section.rooms': 'Room Management',
  'admin.section.rooms.description': 'Consultation, lab, procedure, pharmacy and waiting areas.',
  'admin.section.resources': 'Resources',
  'admin.section.resources.description': 'Equipment and consumable stock across the clinic.',
  'admin.section.announcements': 'Announcements',
  'admin.section.announcements.description': 'Internal notices for the clinic team.',
  'admin.section.policies': 'Clinic Policies',
  'admin.section.policies.description': 'Operating policies and compliance documents.',
  'admin.section.templates': 'Document Templates',
  'admin.section.templates.description': 'Reusable clinical document templates.',
  'admin.section.communications': 'Communication Monitoring',
  'admin.section.communications.description':
    'Conversation oversight, safety flags and gated content access.',
  'admin.section.logs': 'System Logs',
  'admin.section.logs.description':
    'Every authentication, security and administrative event on the platform.',
  'admin.section.reports': 'Reports',
  'admin.section.reports.description':
    'Growth, utilization, clinical operations and platform performance.',
  'admin.section.settings': 'Platform Settings',
  'admin.section.settings.description':
    'Organization, communication, security and data configuration.',
  'admin.section.preferences': 'My Settings',
  'admin.section.preferences.description':
    'Your personal account, appearance, and workspace preferences.',
  'admin.section.profile': 'My Profile',
  'admin.section.profile.description': 'Your administrator identity, security and activity.',
  /* ── Form validation, continued (auth schemas) ────────────── */
  'validation.enterEmail': 'Enter your email',
  'validation.enterPassword': 'Enter your password',
  'validation.confirmYourPassword': 'Confirm your password',
  'validation.codeLength': 'Enter the {count}-digit code',
  'validation.digitsOnly': 'Code must be digits only',
  'validation.passwordLength': {
    one: 'Use at least {count} characters',
    other: 'Use at least {count} characters',
  },
  'validation.passwordLower': 'Add a lowercase letter',
  'validation.passwordUpper': 'Add an uppercase letter',
  'validation.passwordDigit': 'Add a number',
  'validation.passwordSymbol': 'Add a symbol',
  'validation.firstName': 'Enter your first name',
  'validation.lastName': 'Enter your last name',
  'validation.phone': 'Enter your phone number',
  'validation.phoneInvalid': 'Enter a valid phone number',
  'validation.acceptTerms': 'You must accept the Terms & Conditions',
  'validation.acceptPrivacy': 'You must accept the Privacy Policy',
  'validation.professionalNumber': 'Enter your professional registration number',
  'validation.professionalCategory': 'Select your professional category',
  'validation.specialty': 'Enter your specialty',
  'validation.dateFormat': 'Use the format YYYY-MM-DD',
  'validation.realDate': 'Enter a real date',
  'validation.registrationExpired': 'That registration has already expired',
  /* ── Auth, continued ──────────────────────────────────────── */
  'signup.category.physician': 'Physician',
  'signup.category.dentist': 'Dentist',
  'signup.category.pharmacist': 'Pharmacist',
  'signup.category.nurse': 'Nurse',
  'signup.category.technician': 'Technician',
  'otp.codeLabel': 'Verification code',
  'otp.digitOf': 'Digit {index} of {total}',
  'login.demoPassword': 'Password: {password}',
  'demo.account.doctor': 'Doctor',
  'demo.account.admin': 'Admin',
  'demo.account.doctorUnverified': 'Doctor (unverified)',
  'demo.account.doctorTwoFactor': 'Doctor (2FA)',
  'demo.account.reception': 'Reception',
  'demo.account.laboratory': 'Laboratory',
  'demo.account.pharmacy': 'Pharmacy',
  'demo.note.unverified': 'Email unverified — see the verification screen',
  'demo.note.twoFactor': '2FA enabled — see the OTP step-up',
  /* ── Shared clinical vocabularies (features/shared-domain) ─── */
  'lab.status.ordered': 'Ordered',
  'lab.status.collected': 'Collected',
  'lab.status.processing': 'Processing',
  'lab.status.completed': 'Completed',
  'lab.status.cancelled': 'Cancelled',
  'lab.priority.routine': 'Routine',
  'lab.priority.urgent': 'Urgent',
  'lab.priority.stat': 'STAT',
  'lab.flag.normal': 'Normal',
  'lab.flag.low': 'Low',
  'lab.flag.high': 'High',
  'lab.flag.criticalLow': 'Critical low',
  'lab.flag.criticalHigh': 'Critical high',
  'lab.flag.abnormal': 'Abnormal',
  'lab.attachment.report': 'Report',
  'lab.attachment.addendum': 'Addendum',
  'lab.attachment.external': 'External',
  'lab.attachment.raw': 'Raw data',
  'patient.status.active': 'Active',
  'patient.status.underTreatment': 'Under treatment',
  'patient.status.critical': 'Critical',
  'patient.status.followUp': 'Follow-up',
  'patient.status.discharged': 'Discharged',
  'patient.risk.low': 'Low',
  'patient.risk.medium': 'Medium',
  'patient.risk.high': 'High',
  'patient.risk.critical': 'Critical',
  'rx.status.draft': 'Draft — not issued',
  'rx.status.active': 'Active',
  'rx.status.dispensed': 'Dispensed',
  'rx.status.completed': 'Completed',
  'rx.status.discontinued': 'Discontinued',
  'rx.status.pendingApproval': 'Pending approval',
  'rx.status.expired': 'Expired',
  'rx.refill.none': 'No refills',
  'rx.refill.available': 'Refills available',
  'rx.refill.due': 'Refill due',
  'rx.refill.pending': 'Refill pending',
  'rx.warning.interaction': 'Drug interaction',
  'rx.warning.allergy': 'Allergy conflict',
  'rx.warning.duplicate': 'Duplicate therapy',
  'rx.warning.dosage': 'Dosage alert',
  'rx.severity.info': 'Info',
  'rx.severity.warning': 'Warning',
  'rx.severity.critical': 'Critical',
  'rx.timeline.prescribed': 'Prescribed',
  'rx.timeline.dispensed': 'Dispensed',
  'rx.timeline.refillRequested': 'Refill requested',
  'rx.timeline.refillApproved': 'Refill approved',
  'rx.timeline.renewed': 'Renewed',
  'rx.timeline.noteAdded': 'Note added',
  'rx.timeline.discontinued': 'Discontinued',
  'rx.timeline.expired': 'Expired',
  /* ── Prescription safety screening (authoring) ────────────── */
  'rx.severityBadge': '{severity} severity',
  'rx.cannotOverride': 'Cannot be overridden',
  'rx.foundAgainst': 'Found against:',
  'rx.acknowledge': 'I have reviewed this {severity} {kind} and accept it',
  'rx.evidence.demoFormulary': 'Demo formulary',
  'rx.evidence.demoFormulary.detail':
    'Screened against a five-medication demo formulary and its canned notes — not a clinical interaction service. Verdicts here are illustrative and must not be relied on for care.',
  'rx.evidence.clinicalService': 'Clinical interaction service',
  'rx.evidence.clinicalService.detail':
    'Screened against the licensed drug interaction and allergy service.',
  'patient.riskLabel': 'Risk: {level}',
} as const;

/**
 * A CLDR plural category, as `Intl.PluralRules#select` returns it.
 *
 * English uses two (`one`, `other`); Arabic uses all six — zero, one, two,
 * few (3–10), many (11–99) and other (100, 101, …).
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * A message that varies with `{count}`: one form per plural category the
 * language uses. `other` is the one every language has and the form chosen
 * when a category is missing.
 */
export type PluralForms = { readonly other: string } & {
  readonly [Category in Exclude<PluralCategory, 'other'>]?: string;
};

type Source = typeof en;

/** Every key the app can translate. */
export type MessageKey = keyof Source;

/** The keys whose English value is a plural object rather than a string. */
export type PluralMessageKey = {
  [Key in MessageKey]: Source[Key] extends string ? never : Key;
}[MessageKey];

/**
 * A complete catalogue: every key, a string where English has a string and a
 * plural object where English has one. Arabic is typed this way, so a key
 * added to `en` without its Arabic is a compile error.
 */
export type Messages = {
  readonly [Key in MessageKey]: Source[Key] extends string ? string : PluralForms;
};

/**
 * A partial catalogue — what French, Persian and Turkish are typed as (owner
 * decision, 2026-11-23). A key they lack renders in English, which is what
 * those users already saw for every untranslated feature interior, rather
 * than blocking a string from shipping in Arabic until three more languages
 * have it. See `src/i18n/README.md`.
 */
export type PartialMessages = Partial<Messages>;
