/**
 * English — the source catalogue (C-09).
 *
 * **English is the only file written by hand as prose.** Every other
 * locale is typed as `Record<MessageKey, string>` against this object, so
 * a missing or misspelled key in a translation is a compile error rather
 * than a silent fallback. Adding a string is: add it here, then add it to
 * every translation — the typechecker will not let you forget one.
 *
 * ── What is in here, and what is deliberately not ────────────────────
 *
 * The catalogue covers **every screen**. The state and auth-failure
 * blocks came first — they are what a patient reads when something has
 * gone wrong, which is the worst moment to be facing a language you do
 * not speak — and the rest of the app followed.
 *
 * ── The line: what does NOT get a key ───────────────────────────────
 *
 * Until 2026-11-23 there were three exclusions: the emergency guidance,
 * the affordances leading to it, and the clinical vocabulary the record
 * is written in (allergy severity, medication and prescription status,
 * lab flags, history kinds). On that date the W-10 owner APPROVED
 * localizing all application-controlled copy, those three included. They
 * now have keys here — `emergency.*`, `crash.*`, `support.urgent.*`,
 * `upgrade.emergency`, `messages.urgencyNotice`, `health.allergy.severity.*`,
 * `health.medication.status.*`, `health.history.kind.*`,
 * `health.labs.flag.*`, `health.prescriptions.status.*` — with English
 * byte-identical to what the screens showed before.
 *
 * ⚠ **The approval covers translating only.** The W-10 clinical and legal
 * sign-off (`docs/SIGNOFF.md`) is still NOT given. The Arabic of every
 * emergency and clinical key is an engineering draft awaiting the named
 * clinical reviewer; `i18n.test.tsx` lists those namespaces so the
 * review has a definite scope.
 *
 * What still gets no key is **data**: patient-entered text, names, doctor
 * names, the clinic's records, server-supplied notification text, and
 * operator-configured emergency number labels (`whenToUse`, `label`).
 * "Medora" is a name and is not a key either.
 *
 * **Disclaimers are on the near side of the line and DO get keys** — "does
 * not give medical advice", "not monitored around the clock", "support is
 * about the app, not your health". They say what Medora is not, which is
 * product and legal copy rather than clinical guidance. W-10's sign-off
 * covers this catalogue along with everything else before a build ships,
 * and the patient who chooses Arabic is told, in Arabic, that no native
 * speaker has read it yet (`language.reviewPending`).
 *
 * Keys are namespaced by surface (`state.*`, `action.*`, `a11y.*`,
 * `nav.*`, `home.*`, and so on). Interpolation is `{name}`; see `useT`.
 */

export const en = {
  // ── Generic screen states ──────────────────────────────────────────
  'state.empty.title': 'Nothing here yet',
  'state.empty.body': 'When there is something to show, it will appear here.',
  'state.offline.banner':
    "You're offline. You can read what's already here, but changes won't save.",

  // ── Errors, one pair per `ApiError` kind ───────────────────────────
  // The pairing is what `ErrorState` renders: a title that names what
  // happened and a body that says what to do about it. A kind with no
  // distinct pair here would be a kind the patient cannot tell apart
  // from another (checklist R-03).
  'state.error.title': 'Something went wrong',
  'state.error.body': 'An unexpected problem stopped this from loading.',
  'state.error.network.title': "You're offline",
  'state.error.network.body':
    'Medora could not reach the clinic. Check your connection and try again.',
  'state.error.timeout.title': 'That took too long',
  'state.error.timeout.body': 'The clinic did not respond in time. Try again in a moment.',
  'state.error.auth.title': 'Please sign in again',
  'state.error.auth.body': 'Your session has ended for your security.',
  'state.error.forbidden.title': 'Not available to you',
  'state.error.forbidden.body': 'This information is not part of what you can see in Medora.',
  'state.error.notFound.title': 'Not found',
  'state.error.notFound.body': 'This is no longer here. It may have been changed or removed.',
  'state.error.conflict.title': 'This changed while you were looking',
  'state.error.conflict.body':
    'Someone at the clinic updated it. Reload to see the current version.',
  'state.error.rateLimited.title': 'Too many attempts',
  'state.error.rateLimited.body': 'Please wait {seconds} seconds before trying again.',
  'state.error.validation.title': "That didn't work",
  'state.error.validation.body':
    'Some of the details were not accepted. Check the form and try again.',
  'state.error.cancelled.title': 'Cancelled',
  'state.error.cancelled.body': 'That request was stopped.',
  // `{ref}` is a correlation id, not free text — see `ErrorState`'s rule
  // about never rendering a server message.
  'state.error.server.title': 'Medora had a problem',
  'state.error.server.body': 'Something failed on our side. Reference {ref}.',
  'state.error.contract.title': 'Something looks wrong',
  'state.error.contract.body':
    'Medora received an unexpected response. Try again, and contact the clinic if it keeps happening.',
  'state.error.unavailable.title': 'Not available yet',
  // ── What an unbuilt endpoint was going to do (the seam) ───────────
  //
  // `EndpointNotImplementedError` carries one of these, and `ErrorState`
  // and `authErrorKey` interpolate it into a translated sentence. They
  // used to be plain English strings in the service layer, which made
  // every refusal half-translated: "Recent activity غير متاح بعد."
  'capability.departments': 'The list of departments',
  'capability.profileEdit': 'Editing your personal details',
  'capability.privacyRequests': 'Your privacy requests',
  'capability.dataExport': 'Requesting your data',
  'capability.accountClosure': 'Requesting to close your account',
  'capability.clinic': 'Clinic information',
  'capability.recentActivity': 'Recent activity',
  'capability.healthRecords': 'Your health records',
  'capability.messages': 'Messages',

  'state.error.unavailable.body':
    '{capability} is still being built. It will appear here once it is ready.',

  // ── Authentication failures ────────────────────────────────────────
  // The same class of string as the block above — what a patient reads
  // when something has gone wrong — and, like it, entirely non-clinical.
  //
  // `auth.error.unknownAddress` is deliberately ABSENT. The backend
  // answers a wrong password and an unknown address identically, with
  // identical timing, and a catalogue entry saying "no account with that
  // email" would hand back the distinction the server hides.
  'auth.error.unknown': 'Something went wrong. Please try again.',
  'auth.error.unavailable':
    '{capability} is not available yet. This part of Medora is still being built.',
  'auth.error.invalidCredentials':
    'That email and password do not match. Check them and try again.',
  'auth.error.emailUnverified':
    'Confirm your email address before signing in. Check your inbox for the link.',
  'auth.error.accountInactive':
    'This account is not active, so it cannot sign in right now. Contact support for help.',
  'auth.error.otpInvalid':
    'That code is not right. Check it against the newest code in your authenticator app.',
  'auth.error.tokenInvalid': 'That link is no longer valid. Request a new one.',
  'auth.error.emailTaken': 'There is already an account with that email address.',
  'auth.error.weakPassword': 'Choose a stronger password.',
  'auth.error.rateLimited': 'Too many attempts. Wait {seconds} seconds and try again.',
  'auth.error.validation': 'Some details were not accepted. Check the form and try again.',
  'auth.error.network': "Medora couldn't reach the clinic. Check your connection.",
  'auth.error.timeout': 'That took too long. Try again in a moment.',
  'auth.error.forbidden': 'This account cannot sign in to the Medora patient app.',
  'auth.error.conflict': 'There is already an account with those details.',
  'auth.error.server': 'Medora had a problem. Reference {ref}.',
  'auth.error.currentPasswordWrong': 'That is not your current password.',

  // ── Generic actions ────────────────────────────────────────────────
  'action.retry': 'Try again',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.back': 'Back',

  // ── Accessibility labels that are not visible text ─────────────────
  'a11y.loading': 'Loading, please wait',
  // A read-only row, as a screen reader announces it.
  'a11y.readOnly': '{value}, read only',
  'a11y.listSeparator': '{title}, {value}',
  'a11y.password.show': 'Show password',
  'a11y.password.hide': 'Hide password',
  // Announced when a "Show more" brings a page in. Nothing moves focus
  // and nothing new is read, so without this a screen-reader user gets
  // silence where a sighted user gets twenty more rows (S-07).
  'a11y.pageLoaded': 'Loaded. Showing {shown} of {total}.',

  // ── The language switcher itself ───────────────────────────────────
  'language.title': 'Language',
  'language.restartRequired':
    'Arabic lays the screen out right to left. Close and reopen Medora to apply it.',

  'language.reviewPending': 'The Arabic translation has not yet been reviewed by a native speaker.',

  // Preferences — the first screen migrated onto the catalogue.
  'preferences.appearance.title': 'Appearance',
  'preferences.theme.title': 'Theme',
  'preferences.theme.system': 'Follow my phone',
  'preferences.theme.light': 'Light',
  'preferences.theme.dark': 'Dark',
  'preferences.textSize.title': 'Text size',
  'preferences.textSize.body':
    "Medora follows the text size set on your phone. Change it in your phone's accessibility settings and Medora will match.",

  'auth.field.email': 'Email',
  'auth.field.password': 'Password',
  'auth.field.firstName': 'First name',
  'auth.field.lastName': 'Last name',
  'auth.field.phone': 'Phone number',
  'auth.field.confirmPassword': 'Confirm password',
  'auth.action.signIn': 'Sign in',
  'auth.action.createAccount': 'Create an account',
  'auth.action.backToSignIn': 'Back to sign in',

  'auth.welcome.tagline': 'Your appointments, your records and your clinic, in one place.',
  'auth.welcome.disclaimer':
    'Medora is a clinical service. It does not give medical advice and it is not monitored around the clock.',

  'auth.login.notice.sessionExpired': 'Your session ended for your security. Sign in to continue.',
  // `{duration}` is `formatMinutes`, not a bare number: "1 minutes" is
  // wrong in English and "5 دقيقة" is wrong in Arabic.
  'auth.login.notice.locked':
    'Medora signed you out after {duration} in the background, for your security. Sign in to continue.',
  'auth.login.forgotPassword': 'Forgot your password?',

  // The second factor is an authenticator app's code (backend StepUpService):
  // nothing is sent, and `POST /auth/otp/resend` extends the challenge window.
  // The previous copy told a patient to wait for a message that never comes.
  // When email or SMS delivery exists (RM M19) the wording changes back.
  'auth.otp.title': 'Two-step verification',
  'auth.otp.body':
    'Enter the 6-digit code from your authenticator app. The code changes every 30 seconds.',
  'auth.otp.field': 'Verification code',
  'auth.otp.submit': 'Verify',
  'auth.otp.resend': 'I need more time',
  'auth.otp.resendCooldown': 'I need more time ({seconds}s)',
  'auth.otp.resent': 'You have more time. Enter the newest code from your app.',
  'auth.otp.expired': 'This sign-in has expired. Go back and sign in again.',
  'auth.otp.useRecovery': 'Use a recovery code instead',
  'auth.otp.useAuthenticator': 'Use my authenticator app instead',
  'auth.otp.recoveryBody':
    'Enter one of the recovery codes you saved when you turned on two-factor authentication. Each code works only once.',
  'auth.otp.recoveryField': 'Recovery code',
  'auth.otp.recoverySubmit': 'Verify recovery code',
  'auth.otp.recoveryRequired': 'Enter a recovery code.',
  'auth.otp.recoveryInvalid': 'That recovery code is not valid. Check it and try again.',

  'auth.register.title': 'Create your account',
  'auth.register.passwordHint':
    'At least 8 characters, with an uppercase letter, a number and a symbol.',
  'auth.register.acceptTerms': 'I accept the Terms & Conditions',
  'auth.register.acceptPrivacy': 'I accept the Privacy Policy',

  // ── Consent (E-05) ────────────────────────────────────────────────
  'consent.title': 'Terms and privacy',
  'consent.intro':
    'What you agree to when you use Medora, and what your clinic does with your information.',
  'consent.terms.title': 'Terms and conditions',
  'consent.terms.body':
    'How Medora may be used, and what it is not — it is not an emergency service and it does not give medical advice.',
  'consent.privacy.title': 'Privacy policy',
  'consent.privacy.body':
    'What your clinic records about you, who may see it, and how long it is kept.',
  'consent.read': 'Read the document',
  'consent.unpublished':
    'Your clinic has not published this document in the app yet. Ask reception for a copy.',
  'consent.openFailed': 'That document could not be opened. Check your connection and try again.',
  'consent.version': 'Version {version}',
  'consent.reviewLink': 'Read the terms and the privacy policy',
  'profile.consent': 'Terms and privacy',
  'auth.register.submit': 'Create account',
  'auth.register.recordsNotice':
    'Creating an account does not give Medora access to records held elsewhere. Your clinic links your account to your medical record separately.',
  'auth.register.haveAccount': 'I already have an account',

  'auth.verify.title': 'Confirm your email',
  'auth.verify.body': 'We sent a link to {email}. Open it to finish setting up your account.',
  'auth.verify.resend': 'Send the link again',
  'auth.verify.resendCooldown': 'Send the link again ({seconds}s)',
  'auth.verify.resent': 'We have sent the link again.',

  'auth.forgot.title': 'Reset your password',
  'auth.forgot.body':
    'Enter the email address on your Medora account and we will send a reset link.',
  // Worded "if there is an account" in every language. A confirmation
  // that only appears for real addresses is an enumeration oracle with a
  // friendly tone, and a translation that says "we have sent you an
  // email" would reintroduce it.
  'auth.forgot.sent':
    'If there is an account with that address, a reset link is on its way. The link expires shortly.',
  'auth.forgot.submit': 'Send reset link',
  'auth.forgot.haveCode': 'I have a reset code',

  'auth.reset.title': 'Choose a new password',
  'auth.reset.tokenLabel': 'Reset code',
  'auth.reset.tokenHint': 'From the email we sent you.',
  'auth.reset.newPassword': 'New password',
  'auth.reset.confirmNewPassword': 'Confirm new password',
  'auth.reset.submit': 'Save new password',
  'auth.reset.done': 'Your password has been changed. Sign in with your new password.',

  'auth.password.rule.length': 'At least {count} characters',
  'auth.password.rule.lower': 'A lowercase letter',
  'auth.password.rule.upper': 'An uppercase letter',
  'auth.password.rule.digit': 'A number',
  'auth.password.rule.symbol': 'A symbol',
  'auth.password.rules.a11y': 'Password requirements. {missing} still needed.',
  'auth.password.rules.a11yMet': 'Password requirements. All met.',

  // ── Security: password change and 2FA (P-05, D-16) ────────────────
  'security.changePassword.success':
    'Your password has been changed. Any other device signed in to Medora has been signed out.',
  'security.changePassword.current': 'Current password',
  'security.changePassword.new': 'New password',
  'security.changePassword.confirm': 'Confirm new password',
  'security.changePassword.notice':
    'Changing your password signs you out everywhere else. You stay signed in on this phone.',
  'security.changePassword.submit': 'Change password',

  'security.twoFactor.start': 'Set up two-factor authentication',
  'security.twoFactor.passwordIntro':
    'First confirm it is you: enter your password. Nothing is set up until it checks out.',
  'security.twoFactor.continue': 'Continue',
  'security.twoFactor.cancel': 'Cancel',
  'security.twoFactor.intro':
    'Add Medora to your authenticator app, then enter the 6-digit code it shows.',
  'security.twoFactor.openApp': 'Open my authenticator app',
  'security.twoFactor.manualKey': 'Or enter this key by hand',
  'security.twoFactor.recoveryTitle': 'Recovery codes',
  'security.twoFactor.recoveryBody':
    'Write these down and keep them somewhere safe. They are shown once and cannot be shown again — if you lose your phone, they are how you get back in.',
  'security.twoFactor.codeLabel': '6-digit code',
  'security.twoFactor.confirm': 'Turn on two-factor authentication',
  'security.twoFactor.enabled':
    'Two-factor authentication is on. You will be asked for a code the next time you sign in.',
  'security.twoFactor.disableIntro':
    'Already using two-factor authentication? Enter your password to turn it off. Every other device will be signed out.',
  'security.twoFactor.disable': 'Turn off two-factor authentication',
  'security.twoFactor.disabled':
    'Two-factor authentication is off, and every other device has been signed out.',
  'security.twoFactor.statusOn': 'Two-factor authentication is on.',
  'security.twoFactor.statusOff': 'Two-factor authentication is off.',
  'security.twoFactor.codesLeftOne': '1 recovery code left.',
  'security.twoFactor.codesLeftMany': '{count} recovery codes left.',
  'security.twoFactor.codesLow':
    'Running low. Replacing your authenticator app gives you a new set.',
  'security.twoFactor.codesNone':
    'No recovery codes left. If you lose your authenticator app you will not be able to sign in. Replace the app to get a new set.',
  'security.twoFactor.replace': 'Replace my authenticator app',
  'security.twoFactor.replaceIntro':
    'Your current app and recovery codes keep working until the new app is confirmed.',
  'security.twoFactor.currentCodeLabel': 'Code from your current app',
  'security.twoFactor.newCodeLabel': 'Code from the new app',
  'security.twoFactor.replaceConfirm': 'Replace authenticator app',
  'security.twoFactor.replaced':
    'Your new authenticator app is in use. The old app and the old recovery codes no longer work.',
  'security.twoFactor.newCodesTitle': 'Your new recovery codes',
  'security.twoFactor.replaceExpired':
    'This replacement expired before it was confirmed. Start again.',
  'security.twoFactor.currentCodeInvalid':
    'That code did not match your current authenticator app.',
  'security.twoFactor.lockedOut':
    'Too many failed attempts. For your security, this session has been signed out.',
  'security.twoFactor.signInAgain': 'Sign in again',
  'security.twoFactor.done': 'Done',

  // ── Navigation (the shell) ────────────────────────────────────────
  //
  // "Medora" is not a key anywhere: it is a name, and a name does not
  // get translated.
  'nav.tab.home': 'Home',
  'nav.tab.discover': 'Discover',
  'nav.tab.appointments': 'Appointments',
  'nav.tab.messages': 'Messages',
  'nav.tab.profile': 'Profile',
  // `{count}` is a whole number of unread notifications; the two forms
  // are the reason this is two keys rather than one with a plural slot.
  'nav.tab.unreadOne': '{tab}, 1 unread notification',
  'nav.tab.unreadMany': '{tab}, {count} unread notifications',
  'nav.title.discover': 'Discover',
  'nav.title.doctor': 'Doctor',
  'nav.title.clinic': 'Our clinic',
  'nav.title.hospitals': 'Hospitals',
  'nav.title.hospital': 'Hospital',
  'nav.title.rescheduleRequest': 'Reschedule request',
  'nav.title.appointments': 'Appointments',
  'nav.title.appointment': 'Appointment',
  'nav.title.messages': 'Messages',
  'nav.title.conversation': 'Conversation',
  'nav.title.profile': 'Profile',
  'nav.title.yourDetails': 'Your details',
  'nav.title.healthRecords': 'Health records',
  'nav.title.labResults': 'Lab results',
  'nav.title.prescriptions': 'Prescriptions',
  'nav.title.documents': 'Documents',
  'nav.title.visits': 'Visit summaries',
  'nav.title.visit': 'Visit',
  'nav.title.notifications': 'Notifications',
  'nav.title.notificationPrefs': 'Notification settings',
  'nav.title.privacy': 'Your data',
  'nav.title.consent': 'Terms and privacy',
  'nav.title.appearance': 'Appearance',
  'nav.title.security': 'Security',
  'nav.title.help': 'Help',

  // ── Home (F-01…F-04) ──────────────────────────────────────────────
  'home.greeting': 'Hello, {name}',
  // Used when the session carries no display name. "there" is what the
  // English sentence needs; Arabic greets without one.
  'home.greetingAnonymous': 'Hello there',
  'home.subtitle': 'Here is what is coming up.',
  'home.nextAppointment': 'Next appointment',
  'home.seeAll': 'See all',
  'home.empty.title': 'Nothing booked',
  'home.empty.body': 'When you have an appointment it will show here.',
  'home.empty.action': 'Book an appointment',
  'home.nextAppointment.a11y': 'Next appointment, {when} with {doctor}',
  'home.nextAppointment.hint': 'Opens the appointment',
  'home.quickActions': 'Quick actions',
  'home.action.book': 'Book',
  'home.action.find': 'Find a doctor',
  'home.action.messages': 'Messages',
  'home.action.records': 'Records',
  'home.disclaimer':
    'Medora does not give medical advice. For anything urgent, call your clinic. For an emergency, use Emergency help.',
  'home.activity.title': 'Recent activity',
  'home.announcements.title': 'From your clinic',
  'home.activity.empty.title': 'Nothing has happened yet',
  'home.activity.empty.body':
    'Appointments, results and messages will be listed here as they arrive.',
  'home.activity.hint': 'Opens the appointment',
  'home.activity.note':
    'Details stay inside each section, so this list can be read over your shoulder.',
  'home.activity.appointment-booked': 'You booked an appointment',
  'home.activity.appointment-confirmed': 'An appointment was confirmed',
  'home.activity.appointment-cancelled': 'An appointment was cancelled',
  'home.activity.appointment-rescheduled': 'An appointment was moved',
  'home.activity.record-updated': 'Your health record was updated',
  'home.activity.result-available': 'A new test result is available',
  'home.activity.prescription-updated': 'A prescription was updated',
  'home.activity.message-received': 'You received a message',

  // ── Onboarding (E-02) ─────────────────────────────────────────────
  'onboarding.slide.appointments.title': 'Your appointments, in one place',
  'onboarding.slide.appointments.body':
    'See what is booked, when it is, and who you are seeing — without calling the clinic to ask.',
  'onboarding.slide.clinic.title': 'Find the right doctor',
  'onboarding.slide.clinic.body':
    'Browse the clinic’s practitioners by specialty, and read who they are before you book.',
  'onboarding.slide.emergency.title': 'Emergency help is always here',
  'onboarding.slide.emergency.body':
    'It works without signing in and without a connection. It is on the first screen, and in the app whenever you need it.',
  'onboarding.skip': 'Skip',
  'onboarding.next': 'Next',
  'onboarding.finish': 'Get started',
  'onboarding.progress': 'Slide {position} of {total}',

  // ── Notifications (O-01, O-02) ────────────────────────────────────
  'notifications.title': 'Notifications',
  'notifications.unreadBadge': '{count} new',
  'notifications.markAll': 'Mark all as read',
  'notifications.new': 'New',
  'notifications.loadMore': 'Show older notifications',
  'notifications.loadMore.hint': 'Showing {shown} of {total}. Loads the next page.',
  'notifications.end': 'That is all {total} of them.',
  'notifications.empty.title': 'Nothing to catch up on',
  'notifications.empty.body': 'Updates about your appointments and results will appear here.',
  'notifications.markRead.failed': 'That notification could not be marked as read.',
  'notifications.markAll.failed': 'Your notifications could not be marked as read.',
  'notifications.unread.a11y': 'Unread. {title}. {body}',
  'notifications.open.hint': 'Opens the appointment',
  'notifications.open.hint.unread': 'Marks it as read and opens the appointment',
  'notifications.markUnread': 'Mark as unread',
  'notifications.markUnread.hint': 'Puts it back in the unread count',
  'notifications.markUnread.failed': 'That notification could not be marked as unread.',
  'notifications.markRead.hint': 'Marks it as read',
  'notifications.noPush': 'Medora does not send push notifications yet. Check here for updates.',

  // ── Notification preferences (O-06) ───────────────────────────────
  'notificationPrefs.title': 'Notification settings',
  'notificationPrefs.intro':
    'Choose how Medora reaches you and what it tells you about. Your clinic still records everything either way.',
  'notificationPrefs.saveFailed': 'That setting could not be saved. It has been put back.',

  'notificationPrefs.section.channels': 'How Medora reaches you',
  'notificationPrefs.channel.push': 'Push notifications',
  'notificationPrefs.channel.push.body': 'Alerts on this phone, even when Medora is closed.',
  'notificationPrefs.channel.inApp': 'In the app',
  'notificationPrefs.channel.inApp.body': 'The bell on your profile, and the badge on the tab bar.',
  'notificationPrefs.channel.email': 'Email',
  'notificationPrefs.channel.email.body': 'To the address on your account.',
  'notificationPrefs.channel.sms': 'Text message',
  'notificationPrefs.channel.sms.body': 'Urgent alerts only, to your registered number.',
  'notificationPrefs.channel.unavailable': 'Not available yet',
  'notificationPrefs.channel.push.unavailable':
    'Medora does not send push notifications yet, so there is nothing to turn on.',

  'notificationPrefs.section.categories': 'What to tell you about',
  'notificationPrefs.category.appointments': 'Appointments',
  'notificationPrefs.category.appointments.body': 'Confirmations, changes and reminders.',
  'notificationPrefs.category.medical-records': 'Your health record',
  'notificationPrefs.category.medical-records.body': 'When your clinic adds something to it.',
  'notificationPrefs.category.laboratory': 'Test results',
  'notificationPrefs.category.laboratory.body': 'When a result is ready for you to see.',
  'notificationPrefs.category.pharmacy': 'Prescriptions',
  'notificationPrefs.category.pharmacy.body': 'Refills, and changes your clinic makes.',
  'notificationPrefs.category.system': 'About Medora',
  'notificationPrefs.category.system.body': 'Planned maintenance and app updates.',
  'notificationPrefs.category.security': 'Sign-ins and account security',
  'notificationPrefs.category.security.body':
    'Always on. If someone signs in as you, that is the message you need most.',
  'notificationPrefs.category.alwaysOn': 'Always on',

  'notificationPrefs.section.quietHours': 'Quiet hours',
  'notificationPrefs.quietHours.toggle': 'Hold notifications overnight',
  'notificationPrefs.quietHours.from': 'From',
  'notificationPrefs.quietHours.to': 'Until',
  'notificationPrefs.quietHours.hint': '24-hour time, like 22:00',
  'notificationPrefs.quietHours.invalid': 'Enter a 24-hour time, like 22:00.',
  'notificationPrefs.quietHours.identical': 'Choose two different times.',
  'notificationPrefs.quietHours.window': 'Held between {from} and {to}.',
  'notificationPrefs.quietHours.urgent':
    'Urgent alerts always come through, whatever the time. Quiet hours hold back everything else until morning.',

  'notificationPrefs.entry': 'Notification settings',
  'notificationPrefs.entry.subtitle': 'Channels, categories and quiet hours',

  // ── Profile (P-01, P-08) ──────────────────────────────────────────
  'profile.linked': 'Linked to your clinical record',
  'profile.notLinked': 'Not linked to a clinical record',
  // F-09: Home and Appointments, for an account with no clinical record.
  // No call to action — how an account is linked is undecided (RA-030.1).
  'profile.unlinked.title': 'Your account is not linked to a clinical record yet',
  'profile.unlinked.body':
    'Appointments and records from your clinic appear here once your account is linked to your record. Until then there is nothing to show, and that is not an error.',
  'profile.section.health': 'Your health',
  'profile.section.account': 'Account',
  'profile.healthRecords': 'Health records',
  'profile.healthRecords.subtitle': 'Allergies, conditions, medicines and history',
  'profile.labResults': 'Lab results',
  'profile.prescriptions': 'Prescriptions',
  'profile.documents': 'Documents',
  'profile.personalDetails': 'Personal details',
  'profile.notifications': 'Notifications',
  'profile.appearance': 'Appearance',
  'profile.security': 'Security',
  'profile.help': 'Help and feedback',
  'profile.signOut': 'Sign out',
  'profile.signOut.confirmTitle': 'Sign out of Medora?',
  'profile.signOut.confirmDetail':
    'You will need your password to sign back in. Emergency help stays available while you are signed out.',

  // ── Privacy requests (P-09, P-10) ─────────────────────────────────
  'privacy.title': 'Your data',
  'privacy.requestedOn': 'Requested on {date}',
  'privacy.failed': 'That request could not be sent. Try again in a moment.',
  'privacy.status.pending': 'In progress',
  'privacy.status.ready': 'Ready',
  'privacy.status.refused': 'Not approved',

  'privacy.export.title': 'Get a copy of your data',
  'privacy.export.body':
    'Your clinic prepares a file with the information Medora holds about you. It takes a little while, and you will get a notification when it is ready.',
  'privacy.export.cta': 'Request a copy',
  'privacy.export.pendingCta': 'Already requested',
  'privacy.export.requested': 'Your clinic has your request. You will hear when the file is ready.',

  'privacy.close.title': 'Close your account',
  'privacy.close.body':
    'Your clinic can close your Medora account. You will not be able to sign in, and you will stop getting messages and reminders here.',
  'privacy.close.retention':
    'Your medical record is not deleted. Your clinic has to keep it, and closing this account does not change what is in it or who may see it.',
  'privacy.close.cta': 'Ask to close my account',
  'privacy.close.pendingCta': 'Already requested',
  'privacy.close.confirmTitle': 'Ask your clinic to close this account?',
  'privacy.close.confirmDetail':
    'Your clinic decides, and will be in touch. Reopening the account afterwards means asking them.',
  'privacy.close.confirmCta': 'Send the request',
  'privacy.close.requested': 'Your clinic has your request and will be in touch.',

  'profile.privacy': 'Your data',
  'profile.privacy.subtitle': 'Get a copy, or close your account',

  // ── Security (P-05, P-06, D-16) ───────────────────────────────────
  'security.title': 'Security',
  'security.section.password': 'Password',
  'security.password.notice': 'Medora will never ask you for your password by email or message.',
  'security.section.twoFactor': 'Two-factor authentication',
  'security.twoFactor.blurb':
    'A code from an authenticator app, on top of your password. It means someone who learns your password still cannot sign in as you.',
  'security.section.devices': 'Where you are signed in',
  'security.devices.empty': 'No other devices',
  'security.devices.lastUsed': 'Last used {when}',
  'security.devices.thisDevice': 'This device',
  'security.devices.unnamed': 'Unrecognised device',
  /**
   * Revoking a session (P-06). The confirmation names the device and
   * says what does NOT happen — a patient signing another phone out
   * needs to know the phone in their hand is not about to be signed out
   * with it.
   */
  'security.devices.signOut': 'Sign out this device',
  'security.devices.hint': 'Signs this device out of Medora',
  'security.devices.confirmTitle': 'Sign out {device}?',
  'security.devices.confirmDetail':
    'That device will have to sign in again. This phone stays signed in.',
  'security.devices.signedOut': 'That device has been signed out.',
  'security.devices.failed': 'That device could not be signed out. Try again.',
  'security.devices.notice':
    'If you do not recognise a device here, sign it out and change your password.',
  'security.section.protection': 'How Medora protects your information',
  'security.protection.body':
    "Your medical information is never saved onto this phone. It is kept in memory only while you are using the app, and cleared when you sign out or leave the app for a while. Your sign-in is stored in your phone's secure keychain.",

  // ── Help and feedback (W-11) ──────────────────────────────────────
  'support.title': 'Help and feedback',
  'support.care.title': 'Questions about your care',
  'support.care.body':
    'Send those to your clinic through Messages, where they reach the people looking after you and are kept with your record. Please do not describe how you are feeling or share medical details below — support is about the app, not your health.',
  'support.app.title': 'Problems with the app',
  'support.app.noAddress':
    'Contact details for app support have not been set up in this build yet. Ask at reception, or use the phone number on your appointment letter.',
  'support.app.body':
    'Write to {address}. Your message will open in your mail app so you can see exactly what is sent.',
  'support.app.contact': 'Contact support',
  'support.build.title': 'This build',

  // ── Discover and doctor profiles (G-01…G-10) ──────────────────────
  'discover.title': 'Find a doctor',
  'discover.search.label': 'Search',
  'discover.search.placeholder': 'Name or specialty',
  'discover.search.hint': 'Searching happens at the clinic, so results stay current.',
  'discover.specialty.all': 'All',
  'discover.specialty.label': 'Specialty',
  'discover.department.label': 'Department',
  'discover.department.all': 'Any department',
  'discover.hospital.label': 'Hospital',
  'discover.hospital.all': 'Any hospital',
  'discover.hospitalsCard.title': 'Hospitals',
  'discover.hospitalsCard.subtitle': 'Where you can be seen, and who works there',
  'discover.hospitalsCard.hint': 'Opens the list of hospitals',
  'discover.recent': 'Recently viewed',
  'discover.doctors': 'Doctors',
  'discover.doctors.count': '{count} available',
  'discover.empty.title': 'No doctors match that',
  'discover.empty.body': 'Try a different name or specialty, or clear the filters.',
  'discover.loadMore': 'Show more doctors',
  'discover.loadMore.hint': 'Showing {shown} of {total}. Loads the next results.',
  'discover.end': 'That is all {total} of them.',
  // The rating is spoken as well as drawn: a star is not a number to a
  // screen reader and not a comparison to a colour-blind reader.
  'doctor.card.a11y': '{name}, {specialty}',
  'doctor.card.a11yRated': '{name}, {specialty}, rated {rating} out of 5',
  'doctor.card.hint': "Opens this doctor's profile",
  'doctor.card.a11yHospital': '{summary}, at {hospital}',
  'doctor.card.years': '{count} yrs',
  'doctor.rating': '{rating} / 5',
  'doctor.years': '{count} years',
  'doctor.book': 'Book an appointment',
  'doctor.availability.title': 'Next available times',
  'doctor.availability.slot': '{date} · {time}',
  'doctor.availability.seeAll': 'See available times',
  'doctor.availability.empty':
    'No open times in the next week. You can still ask for an appointment — the clinic will offer a time.',
  'doctor.about': 'About',
  'doctor.languages': 'Languages',
  'doctor.education': 'Education',
  'doctor.where': "Where you'll be seen",

  // ── Our clinic (H-01…H-04) ────────────────────────────────────────
  'clinic.call': 'Call {phone}',
  'clinic.openMap': 'Open in maps',
  'clinic.openWebsite': 'Visit the website',
  'clinic.hours': 'Opening hours',
  'clinic.hours.empty.title': 'Opening hours are not published',
  'clinic.hours.empty.body': 'Call the clinic to check when it is open.',
  'clinic.closed': 'Closed',
  'clinic.holidays': 'Closures',
  'clinic.holidays.subtitle': 'Days the clinic has published as closed',
  'clinic.holidays.empty.title': 'No closures published',
  'clinic.holidays.empty.body':
    'This does not mean there are none. Call the clinic before travelling for an appointment.',
  'clinic.departments': 'Departments',
  'clinic.departments.empty': 'No departments listed',
  'clinic.department.hint': 'Shows the doctors in this department',
  'department.doctors': 'Doctors in this department',
  'department.empty.title': 'No doctors listed here yet',
  'department.empty.body': 'Try another department, or search by name on Find a doctor.',
  'clinic.singleClinicNote':
    'Medora serves one clinic. Searching other hospitals, and showing distance to them, is not part of this version.',
  // The backend sends `Weekday` as a lowercase literal. An unrecognised
  // value falls back to the server's own string rather than to a guess.
  'weekday.sunday': 'Sunday',
  'weekday.monday': 'Monday',
  'weekday.tuesday': 'Tuesday',
  'weekday.wednesday': 'Wednesday',
  'weekday.thursday': 'Thursday',
  'weekday.friday': 'Friday',
  'weekday.saturday': 'Saturday',

  // ── Appointment status (C-08) ─────────────────────────────────────
  //
  // The server's kebab-case literal is never rendered — `awaiting-patient`
  // is a database value and "Needs your response" is what a patient
  // reads — but the literal is what the client sends and compares,
  // verbatim (A-07).
  'appointment.status.scheduled': 'Scheduled',
  'appointment.status.confirmed': 'Confirmed',
  'appointment.status.pending': 'Awaiting clinic',
  'appointment.status.completed': 'Completed',
  'appointment.status.cancelled': 'Cancelled',
  'appointment.status.rescheduled': 'Rescheduled',
  'appointment.status.noShow': 'Missed',
  'appointment.status.awaitingPatient': 'Needs your response',

  // ── Appointments (I-01…I-10) ──────────────────────────────────────
  'appointments.title': 'Appointments',
  'appointments.scope.upcoming': 'Upcoming',
  'appointments.scope.past': 'Past',
  'appointments.book': 'Book an appointment',
  'appointments.empty.upcoming.title': 'Nothing booked',
  'appointments.empty.upcoming.body': 'When you book an appointment it will appear here.',
  'appointments.empty.past.title': 'No past appointments',
  'appointments.empty.past.body': 'Appointments you have already had will be listed here.',
  'appointments.loadMore': 'Show earlier appointments',
  'appointments.loadMore.upcoming': 'Show later appointments',
  'appointments.loadMore.hint': 'Showing {shown} of {total}. Loads the next page.',
  'appointments.end': 'That is all {total} of them.',
  // Shown only when the phone is in a different zone from the clinic.
  // The time is always the clinic's; this says so, once, where a patient
  // is deciding when to leave.
  'appointment.clinicTime': 'Shown in the clinic’s time zone.',
  'appointments.card.a11y': '{when} with {doctor}, {specialty}',
  'appointments.card.hint': 'Opens the appointment',
  'appointments.card.a11yHospital': '{when} with {doctor}, {specialty}, at {hospital}',
  'appointment.hospital.a11y': 'At {hospital}',
  'appointment.duration': '{minutes} minutes',
  'appointment.details': 'Details',
  'appointment.visitType': 'Visit type',
  'appointment.reason': 'Reason',
  'appointment.notes': 'Notes',
  'appointment.cancelledBecause': 'Cancelled because',
  'appointment.history': 'History',
  'appointment.event.a11y': '{actor} updated this on {when}',
  'appointment.event.a11yStatus': '{actor} set this to {status} on {when}',

  'appointment.action.reschedule': 'Ask to reschedule',
  'appointment.action.cancel': 'Cancel appointment',
  'appointment.cancel.sheetTitle': 'Cancel this appointment?',
  'appointment.cancel.body':
    'Choose a reason. The time is released straight away, so another patient can book it.',
  'appointment.cancel.keep': 'Keep it',
  'appointment.cancel.done': 'Appointment cancelled',
  'appointment.action.failed': 'That did not go through. Try again.',
  'appointment.error.slotTaken':
    'Someone else booked that time. What you entered is kept — choose another time.',
  'appointment.error.requestPending':
    'You already have a reschedule request waiting for the hospital. Withdraw it before asking for a different time.',
  'appointment.error.conflict':
    'This appointment changed while you were working on it. It has been refreshed.',
  'appointment.error.insurance':
    'Your insurance on file does not cover this booking at this hospital.',
  'appointment.error.visitType': 'Choose a visit type to continue.',
  'appointment.error.notLinked':
    'Your account is not linked to a patient record yet. The hospital desk links it after checking your ID in person.',
  'appointment.error.offline':
    'Medora could not be reached. Nothing was lost — check your connection and try again.',
  'appointment.error.linkAction': 'Link your account',
  'appointment.cancel.reasonLabel': 'Reason for cancelling',
  'appointment.cancel.noteLabel': 'Add a note (optional)',
  'appointment.cancel.noteHint': '{used} of {max} characters.',
  'appointment.cancel.reason.scheduleConflict': 'I have a scheduling conflict',
  'appointment.cancel.reason.feelingBetter': 'I am feeling better',
  'appointment.cancel.reason.bookedElsewhere': 'I booked somewhere else',
  'appointment.cancel.reason.transport': 'I cannot get there',
  'appointment.cancel.reason.cost': 'Cost',
  'appointment.cancel.reason.other': 'Another reason',

  // ── Booking (I-03…I-05) ───────────────────────────────────────────
  'booking.step': 'Step {position} of {total}',
  'booking.doctor.title': 'Choose a doctor',
  'booking.doctor.empty.title': 'No doctors available',
  'booking.doctor.empty.body': 'Try again shortly.',
  'booking.date.title': 'Choose a day',
  'booking.date.next': 'Choose a time',
  'booking.time.title': 'Choose a time',
  'booking.time.note': 'Times are set by the clinic and update as other people book.',
  'booking.time.empty.title': 'No times on that day',
  'booking.time.empty.body': 'Go back and try another day.',
  'booking.time.next': 'Continue',
  'booking.reason.title': 'Why are you coming in?',
  'booking.reason.label': 'Reason for the appointment',
  'booking.reason.hint': '{used} of {max} characters. The clinic reads this before your visit.',
  'booking.reason.next': 'Review',
  'booking.confirm.title': 'Check and send',
  'booking.confirm.doctor': 'Doctor',
  'booking.confirm.when': 'When',
  'booking.confirm.reason': 'Reason',
  'booking.notes.label': 'Anything else the clinic should know (optional)',
  'booking.notes.hint': 'Leave this empty if there is nothing to add.',
  'booking.confirm.notes': 'Your note',
  'booking.confirm.note':
    'This is a request. The clinic confirms it, and you will see the status change here.',
  'booking.submit': 'Send request',
  'booking.submitted.toast': 'Your request is with the clinic',
  'booking.submitted.a11y': 'Appointment requested. The clinic will confirm it.',
  'booking.slotTaken.a11y': 'That time was taken. Choose another.',
  'booking.discard.title': 'Leave without booking?',
  'booking.discard.detail': 'Nothing has been sent to the clinic. What you entered will be lost.',
  'booking.discard.confirm': 'Leave',
  'booking.discard.cancel': 'Keep booking',
  'booking.slot.a11y': '{when}, at {hospital}',
  'booking.visitType.label': 'Type of visit (optional)',
  'booking.visitType.hint': 'Leave this empty and the hospital chooses the usual one.',
  'booking.confirm.hospital': 'Hospital',
  'booking.confirm.visitType': 'Visit type',

  // ── Reschedule requests ───────────────────────────────────────────
  'reschedule.title': 'Ask to reschedule',
  'reschedule.current': 'Your appointment now',
  'reschedule.explainer.title': 'This is a request, not a change',
  'reschedule.stays':
    'Your appointment stays booked at its current time until the hospital approves a new one.',
  'reschedule.notHeld':
    'The time you ask for is not held for you. Someone else can still book it before the hospital answers.',
  'reschedule.pick.title': 'Choose a new time',
  'reschedule.pick.empty.title': 'No other times open',
  'reschedule.pick.empty.body':
    'This doctor has no free times at this hospital in the next two weeks. Your appointment is unchanged.',
  'reschedule.note.label': 'Note for the hospital (optional)',
  'reschedule.note.hint': '{used} of {max} characters.',
  'reschedule.chosen': 'You are asking for {when}.',
  'reschedule.submit': 'Send request',
  'reschedule.submitted.toast': 'Request sent. Your appointment has not changed yet.',
  'reschedule.submitted.a11y':
    'Reschedule request sent. Your appointment stays as it is until the hospital approves.',
  'reschedule.unavailable':
    'You cannot ask to reschedule this appointment right now. Open it again to see what is possible.',
  'reschedule.status.pending': 'Waiting for the hospital',
  'reschedule.status.approved': 'Approved',
  'reschedule.status.rejected': 'Not approved',
  'reschedule.status.withdrawn': 'Withdrawn',
  'reschedule.status.superseded': 'No longer needed',
  'reschedule.pending.title': 'Reschedule requested',
  'reschedule.pending.requested': 'You asked for {when}.',
  'reschedule.yourNote': 'Your note: {note}',
  'reschedule.withdraw.action': 'Withdraw request',
  'reschedule.withdraw.title': 'Withdraw this request?',
  'reschedule.withdraw.detail':
    'Your appointment stays as it is. You can ask for another time afterwards.',
  'reschedule.withdraw.confirm': 'Withdraw',
  'reschedule.withdraw.keep': 'Keep the request',
  'reschedule.withdraw.done': 'Request withdrawn',
  'reschedule.history': 'Earlier requests',
  'reschedule.decisionReason': 'The hospital said: {reason}',
  'reschedule.decidedAt': 'Answered {when}',

  // ── Hospitals ─────────────────────────────────────────────────────
  'hospitals.title': 'Hospitals',
  'hospitals.search.label': 'Search hospitals',
  'hospitals.search.placeholder': 'Hospital name',
  'hospitals.empty.title': 'No hospitals found',
  'hospitals.empty.body': 'Try a different name.',
  'hospitals.card.counts': 'Clinics: {clinics} · Departments: {departments}',
  'hospitals.card.a11y': '{name}. {counts}',
  'hospitals.card.a11yCity': '{name}, {city}. {counts}',
  'hospitals.card.hint': 'Opens this hospital',
  'hospitals.loadMore': 'Show more hospitals',
  'hospitals.loadMore.hint': 'Showing {shown} of {total}. Loads the next results.',
  'hospitals.end': 'That is all {total} of them.',
  'hospital.findDoctors': 'Find doctors here',
  'hospital.call': 'Call {phone}',
  'hospital.locations': 'Where to find it',
  'hospital.openMap': 'Open in maps',
  'hospital.clinics': 'Clinics',
  'hospital.departments': 'Departments',
  'hospital.specialties': 'Specialties',

  // ── Messages (M-01…M-05) ──────────────────────────────────────────
  'messages.title': 'Messages',
  'messages.empty.title': 'No messages',
  'messages.empty.body': 'Conversations with your clinic will appear here.',
  'messages.conversation.a11yUnread': '{title}, {count} unread. {preview}',
  'messages.conversation.hint': 'Opens the conversation',
  'thread.a11y': 'Conversation with {name}',
  'thread.empty.title': 'No messages yet',
  'thread.empty.body': 'Start the conversation below.',
  'thread.sendFailed': 'That message was not sent. Try again.',
  'thread.offline': "You're offline. Messages can't be sent until you reconnect.",
  'thread.composer.label': 'Message',
  'thread.composer.placeholder': 'Write a message',
  'thread.send': 'Send',
  'thread.attachments': 'Attachments are not available yet.',
  'thread.closed.title': 'This conversation is closed',
  'thread.closed.body':
    'You cannot reply here. Call the clinic, or raise it at your next appointment.',
  'thread.message.a11y': '{author}, {when}. {body}. {status}',
  'thread.message.edited': 'edited',
  'thread.status.sending': 'Sending',
  'thread.status.sent': 'Sent',
  'thread.status.delivered': 'Delivered',
  'thread.status.read': 'Read',
  'thread.status.failed': 'Not sent',

  // ── Health records (J-01…J-09) ────────────────────────────────────
  //
  // The section titles, the empty states and the notices are here. The
  // CLINICAL VOCABULARY is not — see the exclusion note at the top.
  'health.title': 'Health records',
  'health.notice':
    'These records are kept by your clinic. You cannot change them here — if something looks wrong, tell the clinic at your next appointment.',
  'health.allergies': 'Allergies',
  'health.allergies.empty': 'No allergies recorded',
  'health.conditions': 'Long-term conditions',
  'health.conditions.empty': 'No long-term conditions recorded',
  'health.conditions.recorded': 'Recorded {date}',
  'health.medications': 'Medicines',
  'health.medications.empty': 'No medicines recorded',
  'health.medications.started': 'Started {date}',
  'health.more': 'More',
  'health.more.subtitle': 'Lab results, prescriptions and documents',
  'health.history': 'Medical history',
  'health.history.empty': 'Nothing recorded yet',
  'health.history.subtitle': 'Newest first',
  'health.labs.title': 'Lab results',
  'health.labs.section': 'Your tests',
  'health.labs.empty.title': 'No lab tests yet',
  'health.labs.empty.body': 'Tests your clinic orders will appear here.',
  'health.labs.hint': 'Opens the results',
  'health.labs.hide': 'Hide results',
  'health.labs.hide.hint': 'Collapses {panel}',
  'health.labs.resultCount': '{count} results',
  'health.prescriptions.title': 'Prescriptions',
  'health.prescriptions.empty.title': 'No prescriptions',
  'health.prescriptions.empty.body': 'Anything prescribed for you will be listed here.',
  'health.documents.title': 'Documents',
  'health.documents.empty.title': 'No documents',
  'health.documents.empty.body': 'Letters and forms from your clinic will appear here.',
  'health.documents.open': 'Open',
  'health.documents.notAvailable': 'Opening documents is not available yet.',
  'health.release.pending.title': 'Waiting for a clinician to review',
  'health.release.pending.body':
    'Your results are back and a clinician is looking at them. You will see them here once that is done.',
  'health.release.withheld.title': 'Not shared with you',
  'health.release.withheld.body':
    'The clinic has not shared this in Medora. Ask at your next appointment or message the clinic.',
  'health.release.notReady.title': 'Not ready yet',
  'health.release.notReady.body': 'This is still being processed at the laboratory.',

  // ── Forced upgrade (W-06) ─────────────────────────────────────────
  'upgrade.title': 'Update Medora to continue',
  'upgrade.action': 'Update Medora',

  'health.labs.notice':
    "Medora shows the values and the laboratory's own flags. It does not tell you what they mean — ask the doctor who ordered the test.",
  'health.labs.a11y': '{panel}, {status}',
  'health.labs.ordered': 'Ordered {date}',
  // Where the order is in the laboratory's WORKFLOW — the same class of
  // fact as an appointment's status, and on the near side of the line in
  // the docblock above. The result FLAGS are not here and must not be:
  // "Critically high" is clinical vocabulary and is W-10's to sign off.
  'health.labs.status.ordered': 'Ordered',
  'health.labs.status.collected': 'Sample taken',
  'health.labs.status.processing': 'At the laboratory',
  'health.labs.status.completed': 'Complete',
  'health.labs.status.cancelled': 'Cancelled',
  'health.labs.range': 'Laboratory range {range}',
  'health.labs.result.a11y': '{analyte}, {value}, {flag}',
  'health.labs.result.noValue': 'no value',
  'health.labs.result.unflagged': 'unflagged',
  'health.prescriptions.notice':
    'This is a record of what has been prescribed for you. Repeat prescriptions are arranged with your clinic, not here.',
  'health.prescriptions.issued': 'Issued {date}',
  'health.prescriptions.refills': '{count} refills left',
  'health.documents.added': 'Added {date}',
  'health.documents.scanning': 'Being checked for safety. It will be available shortly.',
  'health.documents.scanFailed':
    'This file could not be checked and cannot be opened. The clinic has been told.',
  /**
   * How the clinic filed a document — administrative, not clinical, so
   * it is translated. It reached a patient's screen as the wire literal
   * until 2026-09-13: `<Badge label={document.category} />` rendered
   * `external-record`, hyphen and all, in both languages.
   */
  'health.documents.category.referral': 'Referral',
  'health.documents.category.consent': 'Consent form',
  'health.documents.category.external-record': 'External record',
  'health.documents.category.insurance': 'Insurance',
  'health.documents.category.report': 'Report',

  /**
   * Visit summaries (J-08). "Summary" is doing deliberate work: this is
   * the patient projection of `medical_records`, not the clinician's
   * note, and the notice says so on both screens rather than leaving a
   * patient to assume they are reading everything their clinician wrote.
   */
  'health.visits.title': 'Visit summaries',
  'health.visits.notice':
    'A short summary of each visit, written for you. It is not the full note your clinician keeps, and it does not tell you what your results mean — ask your clinic about anything here.',
  'health.visits.empty.title': 'No visit summaries yet',
  'health.visits.empty.body':
    'A summary appears here after a visit, once your clinician has shared it with you.',
  'health.visits.with': 'With {doctor}',
  'health.visits.on': 'Seen {date}',
  'health.visits.hint': 'Opens the summary',
  'health.visits.a11y': '{title}, {date}',
  'health.visits.noSummary': 'Your clinician has not written a summary of this visit for you.',
  'health.visits.notFound.title': 'This summary is not in your record',
  'health.visits.notFound.body': 'Go back to your visit summaries and open it from the list.',

  'upgrade.body':
    'This version of Medora is no longer supported. Update to the latest version to sign in and see your appointments and records.',
  'upgrade.noStoreLink': 'Open the App Store or Google Play on this phone and update Medora.',
  'deprecation.available': 'A newer version of Medora is available. Please update when you can.',
  'deprecation.sunset':
    'This version of Medora stops working on {date}. Please update before then.',

  'profile.edit.title': 'Personal details',
  'profile.edit.editable': 'You can change these',
  'profile.edit.save': 'Save changes',
  'profile.edit.saved': 'Your details were saved',
  'profile.edit.saveFailed': 'Those changes were not saved. Try again.',
  'profile.edit.clinicHeld': 'Held by your clinic',
  'profile.edit.clinicHeldBody':
    'Ask at reception or at your next appointment if any of this is wrong.',
  'profile.edit.keptBy': 'Kept by {owner}',
  'app.booting': 'Opening Medora',

  // ── A stored sign-in the server could not be reached to confirm ────
  'session.unconfirmed.title': 'We couldn’t confirm you’re signed in',
  'session.unconfirmed.body':
    'Medora could not be reached. You are still signed in on this phone, and nothing has been removed.',
  'session.unconfirmed.offline':
    'This phone is offline. We will try again when the connection comes back.',
  'session.unconfirmed.online':
    'The connection may be slow, or Medora may be busy. Try again in a moment.',
  'session.unconfirmed.still': 'Medora still could not be reached. Try again in a moment.',
  'session.unconfirmed.retry': 'Try again',
  'session.unconfirmed.signOut': 'Sign out of this phone',
  'session.unconfirmed.signOut.confirmTitle': 'Sign out of this phone?',
  'session.unconfirmed.signOut.confirmDetail':
    'Medora cannot be reached, so only this phone will be signed out. Your sign-in on Medora’s side will end by itself when it expires. You will need your password to sign back in. Emergency help stays available.',

  'nav.title.signIn': 'Sign in',
  'nav.title.sessionCheck': 'Checking your sign-in',
  'nav.title.verify': 'Verify',
  'nav.title.createAccount': 'Create account',
  'nav.title.confirmEmail': 'Confirm email',
  'nav.title.resetPassword': 'Reset password',
  'nav.title.newPassword': 'New password',

  // ── Biometric app-unlock (D-15) ───────────────────────────────────
  'biometric.locked.title': 'Medora is locked',
  'biometric.locked.a11y': 'Medora is locked. {message}',
  'biometric.locked.default': 'Medora is locked. Unlock to continue.',
  'biometric.locked.cancelled':
    'Medora is locked. Unlock to continue, or sign in with your password.',
  'biometric.locked.failed': 'That was not recognised. Try again, or sign in with your password.',
  'biometric.locked.unavailable':
    'This phone cannot check your fingerprint or face right now. Sign in with your password to continue.',
  'biometric.unlock': 'Unlock',
  'biometric.usePassword': 'Use your password instead',
  // `{method}` names the sensor: "Face ID" is Apple's product name and
  // stays as written; "Fingerprint" and the fallback are keys
  // (`biometric.method.fingerprint`, below).
  'biometric.setting.fallbackName': 'Biometrics',
  'biometric.setting.toggle': 'Unlock with {method}',
  'biometric.setting.body':
    'After Medora has been closed for a few minutes, it will ask for {method} before showing your information again. This stops someone using your unlocked phone from reading your records. It does not encrypt anything, and it does not replace signing out.',
  'biometric.setting.password': 'You can always sign in with your password instead.',
  // ── The assistant (Phase K, Phase L) ───────────────────────────────
  //
  // These screens are DESIGNED and NOT CONNECTED — `features/ai/
  // availability.ts` says at length why, and what must never be done to
  // change it. The copy below is written for that state and not as a
  // placeholder for a working one: nothing here is a greeting from an
  // assistant, a generated sentence, or a promise that something is
  // arriving on a date.
  //
  // Disclaimers ARE on the near side of the catalogue's clinical line
  // (see this file's header): they say what Medora is not, which is
  // product and legal copy. The symptom DESCRIPTIONS sit closer to the
  // line and are covered by W-10's review along with everything else.
  'ai.disclaimer.body':
    'Medora Assistant gives general information only. It is not a doctor, it cannot diagnose you, and it must never be used for an emergency.',

  'ai.badge.notConnected': 'Not connected yet',

  'ai.home.title': 'Medora Assistant',
  'ai.home.subtitle': 'General health information, and help finding the right care.',
  'ai.home.entry': 'See what the assistant will do, and what to use instead until it is connected.',
  'ai.home.capabilities': 'What it will help with',
  'ai.home.capabilitiesSubtitle': 'None of these is connected to an assistant yet.',
  'ai.home.safety': 'Before you use it',
  'ai.home.scope.title': 'What it is for',
  'ai.home.scope.body':
    'Finding the right specialty, describing a symptom so you can tell a clinician, help with booking, and general information about a medicine.',
  'ai.home.scope.excluded':
    'It will not read your records, your test results or your prescriptions, and it will not tell you what is wrong with you.',

  'ai.capability.hint': 'Opens the screen for this part of the assistant.',
  'ai.capability.chat.title': 'Ask a question',
  'ai.capability.chat.body': 'General health information, in your own words.',
  'ai.capability.symptoms.title': 'Describe a symptom',
  'ai.capability.symptoms.body':
    'A short set of questions, so you can say clearly what is wrong when you speak to someone.',
  'ai.capability.image.title': 'Show a photo',
  'ai.capability.image.body': 'For a rash or a wound, when words are hard.',

  'ai.unavailable.title': 'No assistant is connected',
  'ai.unavailable.body':
    'This copy of Medora has not been connected to an assistant, so nothing on this screen can answer you. This is not a fault and retrying will not change it.',
  'ai.unavailable.instead':
    'For anything about your own health, message your care team or book an appointment. For an emergency, use the button below.',
  'ai.unavailable.blockedBy': 'Waiting on: {rows}',

  'ai.safety.emergency.title': 'This is not for emergencies',
  'ai.safety.emergency.body':
    'If someone is badly hurt, cannot breathe, is unconscious, or you think this could be life-threatening, do not use this screen.',
  'ai.safety.emergency.action': 'Emergency help',
  'ai.safety.emergency.hint': 'Opens emergency guidance. It does not place a call.',
  'ai.safety.notADoctor.title': 'It is software, not a doctor',
  'ai.safety.notADoctor.body':
    'It cannot examine you, it cannot diagnose you, and it will never tell you to start, stop or change a medicine.',
  'ai.safety.limits.title': 'It can be wrong',
  'ai.safety.limits.body':
    'Anything it writes is general information that no clinician has read before you. Treat it as a starting point for a conversation, never as an answer.',
  'ai.safety.escalate.title': 'A person should decide',
  'ai.safety.escalate.body':
    'Anything about your own body, your results or your treatment belongs with a clinician who can see your record.',
  'ai.safety.findCare': 'Find a doctor',

  'ai.chat.title': 'Ask a question',
  'ai.chat.author.you': 'You',
  'ai.chat.author.assistant': 'Medora Assistant',
  'ai.chat.typing': 'Writing a reply',
  'ai.chat.empty.title': 'Nothing here yet',
  'ai.chat.empty.body':
    'When an assistant is connected, what you ask and what it replies will appear here.',
  'ai.chat.bubble.a11y': '{author} said: {body}. {time}',
  'ai.chat.bubble.failedA11y': '{author} said: {body}. Not sent.',
  'ai.chat.bubble.failed': 'Not sent',

  'ai.composer.label': 'Your message',
  'ai.composer.placeholder': 'Type your question',
  'ai.composer.send': 'Send',
  'ai.composer.attach': 'Add a photo',
  'ai.composer.attachHint': 'Opens the photo screen.',
  'ai.composer.disabled': 'Not available yet',
  'ai.composer.disabledHint': 'No assistant is connected, so nothing can be sent.',
  'ai.composer.disabledReason':
    'You cannot send anything yet — no assistant is connected to this copy of Medora.',

  'ai.intake.title': 'Describe a symptom',
  'ai.intake.step': 'Step {step} of {total}',
  'ai.intake.next': 'Continue',
  'ai.intake.what.title': 'What are you noticing?',
  'ai.intake.what.subtitle': 'Choose everything that applies. Nothing here is sent anywhere.',
  'ai.intake.when.title': 'How long has it been going on?',
  'ai.intake.when.subtitle': 'An approximate answer is fine.',
  'ai.intake.review.title': 'What you told us',
  'ai.intake.alwaysEmergency':
    'Whatever you choose on this screen, if it feels like an emergency, treat it as one. This screen does not decide that for you.',

  'ai.result.title': 'Nothing has looked at this',
  'ai.result.body':
    'No assistant is connected to this copy of Medora, so nothing has read what you entered and there is no result to show.',
  'ai.result.notSent': 'Nothing has been sent anywhere, and nothing has been saved on this phone.',
  'ai.result.summaryTitle': 'What you chose',
  'ai.result.summaryA11y': 'What you chose: {items}',
  'ai.result.findCare': 'Find a doctor',

  'ai.image.title': 'Show a photo',
  'ai.image.subtitle': 'For a rash or a wound, when words are hard.',
  'ai.image.section': 'Your photo',
  'ai.image.empty.title': 'No photo chosen',
  'ai.image.empty.body': 'Choosing a photo is not available in this build.',
  'ai.image.choose': 'Choose a photo',
  'ai.image.disabledHint': 'Choosing a photo is not available in this build.',
  'ai.image.remove': 'Remove photo',
  'ai.image.previewA11y': 'Photo you chose: {name}. Nothing has looked at it.',
  'ai.image.unnamed': 'unnamed',
  'ai.image.localOnly': 'This photo is only on your phone. It has not been sent anywhere.',
  'ai.image.processing': 'Looking at your photo',
  'ai.image.done': 'Finished.',
  'ai.image.privacy.title': 'What would happen to your photo',
  'ai.image.privacy.body':
    'When this is built, a photo will have its location and camera details removed before it leaves your phone, and it will be checked before anyone can open it. None of that exists yet, which is why you cannot choose one.',

  // The intake vocabulary. Plain descriptions, not clinical terms — the
  // point of the screen is that a patient can say what they notice.
  'ai.symptomGroup.general': 'All over',
  'ai.symptomGroup.head': 'Head and throat',
  'ai.symptomGroup.chest': 'Chest and breathing',
  'ai.symptomGroup.abdomen': 'Stomach',
  'ai.symptomGroup.skin': 'Skin',
  'ai.symptomGroup.mood': 'Mood and sleep',
  'ai.symptom.fever': 'Fever',
  'ai.symptom.fatigue': 'Very tired',
  'ai.symptom.chills': 'Chills',
  'ai.symptom.appetite': 'Not eating',
  'ai.symptom.headache': 'Headache',
  'ai.symptom.dizziness': 'Dizzy',
  'ai.symptom.vision': 'Trouble seeing',
  'ai.symptom.soreThroat': 'Sore throat',
  'ai.symptom.chestPain': 'Chest pain',
  'ai.symptom.breathless': 'Short of breath',
  'ai.symptom.cough': 'Cough',
  'ai.symptom.palpitations': 'Racing heart',
  'ai.symptom.nausea': 'Feeling sick',
  'ai.symptom.abdominalPain': 'Stomach pain',
  'ai.symptom.bowel': 'Bowel changes',
  'ai.symptom.rash': 'Rash',
  'ai.symptom.swelling': 'Swelling',
  'ai.symptom.wound': 'A wound that is not healing',
  'ai.symptom.lowMood': 'Low mood',
  'ai.symptom.anxiety': 'Anxious',
  'ai.symptom.sleep': 'Not sleeping',
  'ai.duration.today': 'Today',
  'ai.duration.days': 'A few days',
  'ai.duration.weeks': 'A few weeks',
  'ai.duration.longer': 'Longer than that',

  'nav.title.assistant': 'Assistant',
  'nav.title.assistantChat': 'Ask a question',
  'nav.title.assistantSymptoms': 'Describe a symptom',
  'nav.title.assistantImage': 'Show a photo',
  'security.section.unlock': 'Unlocking this app',
  // ── Emergency (N-07, W-10) ────────────────────────────────────────
  //
  // Translation approved by the owner on 2026-11-23 (W-10). The CLINICAL
  // sign-off is still not given: every `emergency.*` key, and the clinical
  // vocabulary below, is an engineering draft in Arabic awaiting the named
  // clinical reviewer (`docs/SIGNOFF.md`). Recognition only — no key here
  // may carry a treatment instruction (`test/signoff.test.ts`).
  'emergency.help': 'Emergency help',
  'emergency.short': 'Emergency',
  'emergency.entry.hint': 'Opens emergency guidance. It does not place a call.',
  'emergency.entry.welcomeDetail': 'Available without signing in, and without a connection.',
  'emergency.entry.homeDetail': 'What to do, and who to call. Works offline.',
  'emergency.entry.threadHint': 'Messages are not urgent care',
  'emergency.disclaimer':
    'Medora is not an emergency service. Nobody is monitoring this app right now. If this is a life-threatening emergency, call your local emergency number immediately.',
  'emergency.numbers.title': 'Call for help',
  'emergency.numbers.subtitle': 'Numbers provided by your clinic for this region',
  'emergency.unconfigured.title': 'Call your local emergency number',
  'emergency.unconfigured.body':
    "This copy of Medora has not been given emergency numbers for your region, so it will not show one. Use the emergency number for the country you are in — it is usually on the back of your phone's SIM card, and every mobile phone can dial it even when locked or out of credit.",
  'emergency.redFlags.title': 'Call immediately if you see any of these',
  'emergency.redFlag.breathing.title': 'Trouble breathing',
  'emergency.redFlag.breathing.detail':
    'Struggling for breath, choking, or unable to speak a full sentence.',
  'emergency.redFlag.chest.title': 'Chest pain or pressure',
  'emergency.redFlag.chest.detail':
    'Pain, tightness or heaviness in the chest, especially with sweating or nausea.',
  'emergency.redFlag.stroke.title': 'Signs of a stroke',
  'emergency.redFlag.stroke.detail':
    'A drooping face, weakness on one side, or sudden trouble speaking or understanding.',
  'emergency.redFlag.consciousness.title': 'Unconscious or unresponsive',
  'emergency.redFlag.consciousness.detail':
    'Someone who cannot be woken, or who has had a seizure that is not stopping.',
  'emergency.redFlag.bleeding.title': 'Severe bleeding',
  'emergency.redFlag.bleeding.detail':
    'Bleeding that does not slow, or a serious injury after a fall or accident.',
  'emergency.redFlag.allergy.title': 'A severe allergic reaction',
  'emergency.redFlag.allergy.detail':
    'Swelling of the face, lips or throat, a spreading rash, or sudden difficulty breathing.',
  'emergency.redFlag.selfharm.title': 'Thoughts of harming yourself',
  'emergency.redFlag.selfharm.detail':
    'You are not alone and this is an emergency. Call now, or ask someone near you to.',
  'emergency.contacts.title': 'Your emergency contacts',
  'emergency.contacts.subtitle': 'Recorded by your clinic',
  'emergency.contacts.primary': 'First to call',
  'emergency.contacts.other': 'Emergency contact',
  'emergency.contacts.relationshipPrimary': '{relationship} · first to call',
  'emergency.clinic.title': 'Your clinic',
  'emergency.clinic.subtitle': 'For urgent problems that are not emergencies',
  'emergency.clinic.target': 'the clinic',
  'emergency.clinic.openMaps': 'Open in maps',
  'emergency.when.title': 'When to call, and when to book',
  'emergency.when.callNow.label': 'Call the emergency number',
  'emergency.when.callNow.body':
    'Any of the signs above, or anything you believe is life-threatening.',
  'emergency.when.callClinic.label': 'Call the clinic',
  'emergency.when.callClinic.body':
    'Worsening symptoms, a reaction to a medicine, or a wound that needs looking at today.',
  'emergency.when.book.label': 'Book an appointment',
  'emergency.when.book.body':
    'A new symptom that is not getting worse, a follow-up, a repeat prescription, or a routine check.',
  'emergency.when.neverMessage':
    'Do not use Medora messages for anything urgent. A clinician may not read a message for a day or more.',
  'emergency.source.unconfigured': 'No emergency numbers are configured for this deployment.',
  'emergency.source.operator': 'Emergency numbers are supplied by your clinic.',
  'emergency.call.label': 'Call {label}',
  'emergency.call.hint': 'Opens a confirmation before calling {number}',
  'emergency.call.failedAnnouncement': 'Could not open the dialler. The number is {number}.',
  'emergency.call.failedA11y': 'This device cannot place calls. Dial {number} from another phone.',
  'emergency.call.failedText':
    'This device cannot place calls. Dial this number from another phone:',
  'emergency.call.confirmTitle': 'Call {label}?',
  'emergency.call.confirmDetail':
    "Medora will open your phone's dialler with {number}. Only continue if you need emergency help now.",
  'emergency.call.confirmAction': 'Call {number}',
  'emergency.call.notNow': 'Not now',

  // ── Urgent-help lines outside the emergency screen (W-10 review) ──
  'crash.title': 'Medora ran into a problem',
  'crash.body':
    'This screen stopped working. Nothing you entered was sent. If you need urgent help, call your local emergency number.',
  'support.urgent.title': 'If you need urgent medical help',
  'support.urgent.body':
    "Call your local emergency number from your phone's dialler. Do not wait for a reply here — this inbox is not monitored for medical emergencies.",
  'upgrade.emergency':
    "If you need urgent help, call your local emergency number from your phone's dialler.",

  // ── Clinical vocabulary of the record (W-10 review) ───────────────
  //
  // The words the record is written in. Keyed by the wire literal in
  // `types/vocabularies.ts`; the literal itself never reaches a screen.
  'health.allergy.severity.mild': 'Mild',
  'health.allergy.severity.moderate': 'Moderate',
  'health.allergy.severity.severe': 'Severe',
  'health.medication.status.active': 'Active',
  'health.medication.status.completed': 'Completed',
  'health.medication.status.discontinued': 'Discontinued',
  'health.history.kind.diagnosis': 'Diagnosis',
  'health.history.kind.surgery': 'Surgery',
  'health.history.kind.procedure': 'Procedure',
  'health.history.kind.hospitalization': 'Hospitalization',
  'health.history.kind.vaccination': 'Vaccination',
  'health.labs.flag.normal': 'Normal',
  'health.labs.flag.low': 'Low',
  'health.labs.flag.high': 'High',
  'health.labs.flag.criticalLow': 'Critically low',
  'health.labs.flag.criticalHigh': 'Critically high',
  'health.labs.flag.abnormal': 'Abnormal',
  'health.prescriptions.status.draft': 'Draft',
  'health.prescriptions.status.pendingApproval': 'Awaiting approval',
  'health.prescriptions.status.active': 'Active',
  'health.prescriptions.status.dispensed': 'Dispensed',
  'health.prescriptions.status.completed': 'Finished',
  'health.prescriptions.status.discontinued': 'Stopped',
  'health.prescriptions.status.expired': 'Expired',

  // ── Form validation (C-09) ────────────────────────────────────────
  //
  // `features/auth/schemas.ts` keeps its English messages — they mirror
  // the backend DTOs word for word. These keys are the same sentences,
  // and `i18n/validation.ts` maps a schema message to its key at render.
  // The English value of each key MUST equal the schema's message.
  'validation.password.length': 'Use at least {count} characters',
  'validation.password.lower': 'Add a lowercase letter',
  'validation.password.upper': 'Add an uppercase letter',
  'validation.password.digit': 'Add a number',
  'validation.password.symbol': 'Add a symbol',
  'validation.password.required': 'Enter your password',
  'validation.password.mismatch': 'Passwords do not match',
  'validation.password.reused': 'Choose a password you have not used here before',
  'validation.confirmPassword.required': 'Re-enter your password',
  'validation.currentPassword.required': 'Enter your current password',
  'validation.confirmNewPassword.required': 'Re-enter your new password',
  'validation.email.required': 'Enter your email',
  'validation.email.invalid': 'Enter a valid email address',
  'validation.code.length': 'Enter the 6-digit code',
  'validation.code.digits': 'Code must be digits only',
  'validation.firstName.required': 'Enter your first name',
  'validation.lastName.required': 'Enter your last name',
  'validation.name.max': 'Use {count} characters or fewer',
  'validation.phone.required': 'Enter your phone number',
  'validation.phone.invalid': 'Enter a valid phone number',
  'validation.terms.required': 'You must accept the Terms & Conditions',
  'validation.privacy.required': 'You must accept the Privacy Policy',
  'validation.token.required': 'Paste the code from your email',

  // ── Profile fields (P-03) ─────────────────────────────────────────
  'profile.field.fullName': 'Full name',
  'profile.field.dateOfBirth': 'Date of birth',
  'profile.field.bloodType': 'Blood type',
  'profile.field.email': 'Email',
  'profile.field.phone': 'Phone',
  'profile.field.address': 'Address',
  // Lower-case: they complete "Kept by {owner}".
  'profile.field.owner.clinic': 'your clinic',
  // Whole sentences, not owners: see `keptByLine` in EditProfileScreen.
  'profile.field.keptInAccount': 'Kept by your account',
  'profile.field.keptByYou': 'Kept by you',

  // ── The OS biometric sheet (JS-controlled text inside it) ─────────
  'biometric.prompt': 'Unlock Medora',
  'biometric.method.fingerprint': 'Fingerprint',

  // ── The app-switcher privacy cover (T-05) ─────────────────────────
  'privacy.cover': 'Medora is hidden while you are in another app.',

  // ── The Messages screen's urgency notice (W-10 review) ────────────
  'messages.urgencyNotice':
    'Messages are not urgent care. A clinician may not read this for a day or more. If something is urgent, call the clinic; if it is an emergency, use Emergency help.',
} as const;
