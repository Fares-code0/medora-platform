import type { Messages } from './en';

/**
 * Persian / Farsi (فارسی) — right-to-left.
 *
 * Persian is not Arabic with different words, and the differences that
 * matter here are typographic. Persian uses ک and ی (U+06A9, U+06CC), not
 * the Arabic ك and ي, and the zero-width non-joiner (U+200C, «‌») separates
 * the plural «‌ها» and the prefix «می‌» without breaking the word — writing
 * «بیمار ها» with a space, or «بیمارها» joined, are both wrong. Both are
 * used correctly below.
 */
export const fa: Messages = {
  // Brand panel
  'brand.welcome': 'به مدورا خوش آمدید',
  'brand.tagline': 'پلتفرم مبتنی بر هوش مصنوعی برای تیم‌های درمانی امروز.',
  'brand.benefit.records': 'پرونده‌ی بیماران، آزمایش‌ها و نسخه‌ها یکجا',
  'brand.benefit.scheduling': 'زمان‌بندی هوشمند که با روز شما هماهنگ می‌شود',
  'brand.benefit.ai': 'کمک هوش مصنوعی برای یادداشت‌ها، خلاصه‌ها و بررسی‌های ایمنی',
  'brand.security': 'سازگار با HIPAA · رمزنگاری سرتاسری',

  // Shared
  'common.email': 'نشانی ایمیل',
  'common.password': 'گذرواژه',
  'common.confirmPassword': 'تکرار گذرواژه',
  'common.emailPlaceholder': 'you@hospital.org',
  'common.back': 'بازگشت به ورود',
  'common.showPassword': 'نمایش گذرواژه',
  'common.hidePassword': 'پنهان کردن گذرواژه',
  'common.language': 'زبان',
  'common.theme': 'پوسته',
  'common.rateLimited': 'تلاش‌ها بیش از حد بود. چند دقیقه صبر کنید و دوباره تلاش کنید.',

  // Login
  'login.title': 'ورود به مدورا',
  'login.subtitle': 'برای دسترسی به فضای کاری خود اطلاعات ورود را وارد کنید.',
  'login.remember': 'مرا به خاطر بسپار',
  'login.forgot': 'گذرواژه را فراموش کرده‌اید؟',
  'login.submit': 'ورود',
  'login.noAccount': 'حساب کاربری ندارید؟',
  'login.signupLink': 'ایجاد حساب',
  'login.demoTitle': 'اطلاعات نمونه',
  'login.demoBody': 'از این حساب‌های نمونه برای آشنایی با سامانه استفاده کنید.',
  'login.error.invalid': 'ایمیل یا گذرواژه نادرست است. دوباره تلاش کنید.',
  'login.error.generic': 'هنگام ورود مشکلی پیش آمد. دوباره تلاش کنید.',
  'login.sessionEnded': 'نشست شما به پایان رسید. برای ادامه دوباره وارد شوید.',
  'login.error.inactive': 'این حساب فعال نیست. با مدیر سیستم تماس بگیرید.',
  'login.error.twoFactorRequired':
    'این حساب به احراز هویت دومرحله‌ای نیاز دارد. با مدیر سیستم تماس بگیرید.',
  'login.error.rateLimited': 'تلاش‌های ورود بیش از حد بود. چند دقیقه صبر کنید و دوباره تلاش کنید.',
  'login.error.unsupportedRole':
    'نقش این حساب هنوز در نسخهٔ وب مدورا فضای کاری ندارد. از مدیر سیستم بخواهید یک نقش پشتیبانی‌شده به این حساب اختصاص دهد.',
  'login.error.patientRole':
    'بیماران از برنامهٔ موبایل بیماران مدورا استفاده می‌کنند. لطفاً از آنجا وارد شوید؛ نسخهٔ وب ویژهٔ کارکنان کلینیک است.',

  // Signup
  'signup.title': 'ایجاد حساب کاربری',
  'signup.subtitle': 'به تیم درمانی خود در مدورا بپیوندید.',
  'signup.firstName': 'نام',
  'signup.lastName': 'نام خانوادگی',
  'signup.phone': 'شماره تلفن',
  'signup.professionalSection': 'اطلاعات حرفه‌ای',
  'signup.professionalNumber': 'شماره ثبت حرفه‌ای',
  'signup.professionalNumberHelp': 'شماره درج‌شده در پروانه اشتغال شما',
  'signup.professionalCategory': 'رستهٔ حرفه‌ای',
  'signup.specialty': 'تخصص',
  'signup.registrationExpiry': 'تاریخ انقضای ثبت',
  'signup.registrationExpiryHelp': 'اختیاری',
  'signup.verificationNotice':
    'ثبت حرفه‌ای شما پیش از فعال‌سازی حساب برای استفادهٔ بالینی بررسی می‌شود.',
  'signup.terms': 'با شرایط و قوانین موافقم',
  'signup.privacy': 'سیاست حریم خصوصی را خوانده‌ام',
  'signup.submit': 'ایجاد حساب',
  'signup.haveAccount': 'از پیش حساب دارید؟',
  'signup.loginLink': 'ورود',
  'signup.error.taken': 'حسابی با این ایمیل از پیش وجود دارد.',
  'signup.error.professionalNumberTaken': 'این شماره ثبت حرفه‌ای پیش‌تر ثبت شده است.',
  'signup.error.generic': 'ایجاد حساب ممکن نشد. دوباره تلاش کنید.',

  // Password strength
  'strength.label': 'قدرت گذرواژه',
  'strength.0': 'بسیار ضعیف',
  'strength.1': 'ضعیف',
  'strength.2': 'متوسط',
  'strength.3': 'قوی',
  'strength.4': 'بسیار قوی',

  // Forgot password
  'forgot.title': 'بازنشانی گذرواژه',
  'forgot.subtitle': 'ایمیل خود را وارد کنید تا پیوند بازنشانی را برایتان بفرستیم.',
  'forgot.submit': 'ارسال پیوند بازنشانی',
  'forgot.successTitle': 'صندوق ورودی خود را ببینید',
  'forgot.successBody':
    'اگر حسابی با این ایمیل وجود داشته باشد، پیوند بازنشانی در راه است. این پیوند تا 30 دقیقه معتبر است.',
  'forgot.error.generic': 'ارسال پیوند بازنشانی ممکن نشد. دوباره تلاش کنید.',

  // Reset password
  'reset.title': 'گذرواژه‌ی تازه‌ای انتخاب کنید',
  'reset.subtitle': 'گذرواژه‌ی تازه باید با گذرواژه‌های پیشین متفاوت باشد.',
  'reset.newPassword': 'گذرواژه‌ی تازه',
  'reset.submit': 'بازنشانی گذرواژه',
  'reset.successTitle': 'گذرواژه به‌روزرسانی شد',
  'reset.successBody': 'گذرواژه‌ی شما تغییر کرد. اکنون می‌توانید وارد شوید.',
  'reset.successCta': 'ادامه به صفحه‌ی ورود',
  'reset.error.token': 'این پیوند بازنشانی نامعتبر است یا منقضی شده.',
  'reset.error.generic': 'بازنشانی گذرواژه ممکن نشد. دوباره تلاش کنید.',

  // Verify email
  'verifyEmail.title': 'تأیید ایمیل',
  'verifyEmail.subtitle': 'پیوند تأیید را به صندوق ورودی شما فرستادیم.',
  'verifyEmail.pending': 'دریافت نکردید؟ پوشه‌ی هرزنامه را ببینید یا از پایین دوباره بفرستید.',
  'verifyEmail.resend': 'ارسال دوباره‌ی ایمیل',
  'verifyEmail.resendIn': 'ارسال دوباره تا',
  'verifyEmail.verifying': 'در حال تأیید ایمیل…',
  'verifyEmail.successTitle': 'ایمیل تأیید شد',
  'verifyEmail.successBody': 'ایمیل شما تأیید شد. اکنون می‌توانید وارد شوید.',
  'verifyEmail.successCta': 'ادامه به صفحه‌ی ورود',
  'verifyEmail.error.token': 'این پیوند تأیید نامعتبر است یا منقضی شده.',
  'verifyEmail.error.resend': 'ارسال ایمیل تأیید جدید ممکن نشد. دوباره تلاش کنید.',

  // Verify OTP
  'otp.title': 'تأیید دومرحله‌ای',
  'otp.subtitle': 'کد 6 رقمی را از برنامه‌ی احرازِ هویت وارد کنید.',
  'otp.hint': 'کد نمونه: 123456',
  'otp.submit': 'تأیید',
  'otp.resend': 'به زمان بیشتری نیاز دارید؟',
  'otp.resendIn': 'زمان بیشتر در دسترس تا',
  'otp.error.invalid': 'این کد نادرست است. دوباره تلاش کنید.',
  'otp.error.generic': 'تأیید کد ممکن نشد. دوباره تلاش کنید.',
  'otp.error.expired': 'این ورود منقضی شده است. برگردید و دوباره وارد شوید.',
  'otp.useRecoveryCode': 'استفاده از کد بازیابی به‌جای آن',
  'otp.useAuthenticator': 'استفاده از برنامهٔ احراز هویت به‌جای آن',
  'otp.recovery.subtitle':
    'یکی از کدهای بازیابی را که هنگام فعال‌سازی احراز هویت دومرحله‌ای ذخیره کردید وارد کنید. هر کد فقط یک بار کار می‌کند.',
  'otp.recovery.label': 'کد بازیابی',
  'otp.recovery.submit': 'تأیید کد بازیابی',
  'otp.recovery.error.invalid': 'این کد بازیابی معتبر نیست. آن را بررسی کنید و دوباره تلاش کنید.',
  'otp.recovery.error.generic': 'تأیید کد بازیابی ممکن نشد. دوباره تلاش کنید.',

  // Lock screen
  'lock.title': 'نشست قفل شد',
  'lock.subtitle': 'برای ادامه‌ی کار گذرواژه‌ی خود را وارد کنید.',
  'lock.unlock': 'باز کردن قفل',
  'lock.logout': 'شما نیستید؟ خروج',
  'lock.error.invalid': 'گذرواژه نادرست است. دوباره تلاش کنید.',
  'lock.error.twoFactor':
    'این حساب از ورود دومرحله‌ای استفاده می‌کند که در صفحهٔ قفل قابل انجام نیست. از حساب خارج شوید و دوباره وارد شوید.',
  'lock.error.generic': 'باز کردن قفل نشست ممکن نشد. دوباره تلاش کنید.',
  'lock.error.lockedOut':
    'تلاش‌های نادرست بیش از حد. برای امنیت شما، این نشست خاتمه یافت. چند دقیقه صبر کنید و سپس دوباره وارد شوید.',
  'lock.signInAgain': 'ورود دوباره',

  // Language switcher
  'locale.label': 'زبان',
  'locale.en': 'انگلیسی',
  'locale.ar': 'عربی',
  'locale.fr': 'فرانسوی',
  'locale.fa': 'فارسی',
  'locale.tr': 'ترکی',

  // Shell chrome
  'shell.skipToContent': 'پرش به محتوای اصلی',
  'shell.navigation': 'ناوبری',
  'shell.toggleNavigation': 'نمایش یا پنهان کردن ناوبری',
  'shell.primary': 'اصلی',
  'shell.breadcrumb': 'مسیر صفحه',
  'shell.breadcrumbExpand': 'نمایش همه‌ی سطح‌های مسیر',
  'shell.globalSearch': 'جست‌وجوی سراسری',
  'shell.searchResults': 'نتایج جست‌وجو',
  'shell.searchPlaceholder': 'جست‌وجو…',
  'shell.searchPatientsPlaceholder': 'جست‌وجوی بیمار…',
  'shell.notifications': 'اعلان‌ها',
  'shell.dismissNotification': 'بستن اعلان',
  'shell.unread': 'خوانده‌نشده',
  'shell.more': 'بیشتر',
  'shell.account': 'حساب کاربری',
  'shell.profile': 'نمایه‌ی من',
  'shell.settings': 'تنظیمات',
  'shell.help': 'راهنما',
  'shell.signOut': 'خروج',
  'shell.theme': 'پوسته',
  'shell.themeLight': 'پوسته‌ی روشن',
  'shell.themeDark': 'پوسته‌ی تیره',
  'shell.themeSystem': 'پوسته‌ی سامانه',
  'shell.openAssistant': 'گشودن Medora AI',

  // Navigation — doctor
  'nav.overview': 'نمای کلی',
  'nav.patients': 'بیماران',
  'nav.appointments': 'نوبت‌ها',
  'nav.appointmentsNew': 'افزودن نوبت',
  'nav.medicalRecords': 'پرونده‌های پزشکی',
  'nav.medicalRecordsNew': 'پرونده پزشکی جدید',
  'nav.assistant': 'Medora AI',
  'nav.section.clinical': 'بالینی',
  'nav.myClinic': 'درمانگاه من',
  'nav.labs': 'آزمایشگاه',
  'nav.pharmacy': 'داروخانه',
  'nav.pharmacyAll': 'نسخه‌ها',
  'nav.pharmacyNew': 'نسخه جدید',
  'nav.testCatalogue': 'فهرست آزمایش‌ها',
  'nav.section.inbox': 'صندوق ورودی',
  'nav.messages': 'پیام‌ها',
  'nav.notifications': 'اعلان‌ها',
  'nav.reports': 'گزارش‌ها',

  // Navigation — administrator
  'nav.clinicOverview': 'نمای کلی درمانگاه',
  'nav.section.liveOperations': 'عملیات جاری',
  'nav.doctors': 'پزشکان',
  'nav.queue': 'نوبت‌دهی',
  'nav.waitingRoom': 'اتاق انتظار',
  'nav.section.peopleAndTime': 'کارکنان و زمان',
  'nav.staff': 'کارکنان',
  'nav.departments': 'بخش‌ها',
  'nav.shifts': 'شیفت‌ها',
  'nav.workingSchedule': 'ساعت‌های کاری',
  'nav.holidays': 'تعطیلات',
  'nav.section.facility': 'تأسیسات',
  'nav.rooms': 'اتاق‌ها',
  'nav.resources': 'منابع',
  'nav.section.governance': 'نظارت',
  'nav.communications': 'پایش مکاتبات',
  'nav.logs': 'گزارش‌های سامانه',
  'nav.announcements': 'اطلاعیه‌ها',
  'nav.policies': 'سیاست‌های درمانگاه',
  'nav.templates': 'الگوهای سند',
  'nav.section.account': 'حساب کاربری',

  // Shared states
  'state.loading': 'در حال بارگذاری…',
  'state.error': 'مشکلی پیش آمد',
  'state.errorBody': 'بارگذاری این بخش ممکن نشد. دوباره تلاش کنید.',
  'state.retry': 'تلاش دوباره',
  'state.empty': 'چیزی برای نمایش نیست',
  'state.emptyBody': 'هنوز چیزی اینجا نیست.',
  'state.noResults': 'نتیجه‌ای یافت نشد',
  'state.noResultsBody': 'موردی با پالایه‌های کنونی همخوانی ندارد.',
  'state.offline': 'به نظر می‌رسد آفلاین هستید.',

  // Shared controls
  'ui.search': 'جست‌وجو',
  'ui.clearSearch': 'پاک کردن جست‌وجو',
  'ui.filters': 'پالایه‌ها',
  'ui.activeFilters': 'پالایه‌های فعال',
  'ui.clearFilters': 'پاک کردن پالایه‌ها',
  'ui.export': 'برون‌بری',
  'ui.close': 'بستن',
  'ui.closeDialog': 'بستن پنجره',
  'ui.closePanel': 'بستن پنل',
  'ui.dismiss': 'بستن پیام',
  'ui.cancel': 'انصراف',
  'ui.confirm': 'تأیید',
  'ui.save': 'ذخیره',
  'ui.saving': 'در حال ذخیره…',
  'ui.edit': 'ویرایش',
  'ui.delete': 'حذف',
  'ui.add': 'افزودن',
  'ui.required': 'الزامی',
  'ui.optional': 'اختیاری',
  'ui.select': 'انتخاب کنید…',
  'ui.selectAllRows': 'انتخاب همه‌ی سطرها',
  'ui.sortBy': 'مرتب‌سازی بر پایه‌ی',
  'ui.pagination': 'صفحه‌بندی',
  'ui.previousPage': 'صفحه‌ی پیشین',
  'ui.nextPage': 'صفحه‌ی بعدی',
  'ui.rowsPerPage': 'سطر در هر صفحه',
  'ui.pageOf': 'صفحه‌ی {page} از {total}',
  'ui.zoomIn': 'بزرگ‌نمایی',
  'ui.zoomOut': 'کوچک‌نمایی',

  // Multi-step flows
  'flow.stepOf': 'گام {step} از {total}',
  'flow.complete': 'انجام‌شده',
  'flow.current': 'کنونی',
  'flow.locked': 'قفل‌شده',

  // Form validation
  'validation.required': 'این فیلد الزامی است',
  'validation.email': 'یک نشانی ایمیل معتبر وارد کنید',
  'validation.minLength': 'دست‌کم {count} نویسه لازم است',
  'validation.passwordMismatch': 'گذرواژه‌ها یکسان نیستند',
  'validation.selectOne': 'یک گزینه انتخاب کنید',

  // Administrator invitation (ADR-035 §5)
  'invitation.title': 'پذیرش دعوت',
  'invitation.subtitle': 'برای حساب مدیریتی خود در مدورا یک گذرواژه انتخاب کنید.',
  'invitation.mfaNotice':
    'حساب‌های مدیریتی به احراز هویت دومرحله‌ای نیاز دارند و در گام بعد آن را تنظیم می‌کنید.',
  'invitation.submitPassword': 'ادامه',
  'invitation.mfaTitle': 'تنظیم احراز هویت دومرحله‌ای',
  'invitation.mfaSubtitle':
    'این کلید را به برنامهٔ احرازکننده بیفزایید و سپس کد نمایش‌داده‌شده را وارد کنید.',
  'invitation.secretLabel': 'کلید راه‌اندازی',
  'invitation.secretHelp': 'این کلید را به‌صورت دستی در برنامهٔ احرازکنندهٔ خود وارد کنید.',
  'invitation.recoveryLabel': 'کدهای بازیابی',
  'invitation.recoveryHelp':
    'همین حالا ذخیره‌شان کنید؛ تنها یک بار نشان داده می‌شوند و بعداً قابل بازیابی نیستند.',
  'invitation.codeLabel': 'کد 6 رقمی را وارد کنید',
  'invitation.submitCode': 'فعال‌سازی حساب',
  'invitation.successTitle': 'حساب شما فعال شد',
  'invitation.successBody': 'با ایمیل، گذرواژهٔ تازه و کد برنامهٔ احرازکننده وارد شوید.',
  'invitation.successCta': 'رفتن به ورود',
  'invitation.error.token': 'این پیوند دعوت دیگر معتبر نیست. از مدیر پیوند تازه‌ای بخواهید.',
  'invitation.error.code': 'این کد معتبر نیست. برنامهٔ احرازکننده را بررسی و دوباره تلاش کنید.',
  'invitation.error.taken': 'حسابی با این ایمیل از پیش وجود دارد.',
  'invitation.error.weakPassword': 'گذرواژهٔ قوی‌تری انتخاب کنید.',
  'invitation.error.generic': 'تکمیل دعوت شما ممکن نشد. دوباره تلاش کنید.',
};
