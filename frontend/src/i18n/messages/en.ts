/**
 * English — the source catalogue (F-19).
 *
 * **English is the only file written by hand as prose.** Every other locale
 * is typed as `Record<MessageKey, string>` against this object, so a missing
 * or misspelled key in a translation is a compile error rather than a
 * silent fallback. Adding a string is therefore: add it here, then add it to
 * the four translations — the typechecker will not let you forget one.
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
  'nav.appointments': 'Appointments',
  'nav.appointmentsNew': 'Add Appointment',
  'nav.medicalRecords': 'Medical Records',
  'nav.medicalRecordsNew': 'New Medical Record',
  'nav.assistant': 'Medora AI',
  'nav.section.clinical': 'Clinical',
  'nav.myClinic': 'My clinic',
  'nav.labs': 'Labs',
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
} as const;

/** Every key the app can translate. */
export type MessageKey = keyof typeof en;

/** The shape every other locale must satisfy, in full. */
export type Messages = Record<MessageKey, string>;
