import type { Messages } from './en';

/**
 * Arabic (العربية) — right-to-left.
 *
 * Typed as `Messages`, so a key added to `en.ts` and forgotten here is a
 * compile error. Clinical vocabulary follows the usage common in Gulf and
 * Levantine healthcare software: «موعد» for appointment, «وصفة» for
 * prescription, «مختبر» for laboratory.
 *
 * Two things that are easy to get wrong in an RTL catalogue and are correct
 * here: the interpolation placeholders keep their Latin names ({step},
 * {total}) because they are identifiers, not text; and the Arabic comma «،»
 * and question mark «؟» are used rather than their Latin lookalikes.
 */
export const ar: Messages = {
  // Brand panel
  'brand.welcome': 'مرحبًا بك في ميدورا',
  'brand.tagline': 'المنصة المدعومة بالذكاء الاصطناعي لفرق الرعاية الصحية الحديثة.',
  'brand.benefit.records': 'سجلات المرضى والتحاليل والوصفات في مكان واحد',
  'brand.benefit.scheduling': 'جدولة ذكية تتكيف مع يومك',
  'brand.benefit.ai': 'مساعدة ذكية للملاحظات والملخصات وفحوصات السلامة',
  'brand.security': 'متوافق مع HIPAA · تشفير من طرف إلى طرف',

  // Shared
  'common.email': 'البريد الإلكتروني',
  'common.password': 'كلمة المرور',
  'common.confirmPassword': 'تأكيد كلمة المرور',
  'common.emailPlaceholder': 'you@hospital.org',
  'common.back': 'العودة إلى تسجيل الدخول',
  'common.showPassword': 'إظهار كلمة المرور',
  'common.hidePassword': 'إخفاء كلمة المرور',
  'common.language': 'اللغة',
  'common.theme': 'المظهر',
  'common.rateLimited': 'محاولات كثيرة جدًا. انتظر بضع دقائق ثم حاول مرة أخرى.',

  // Login
  'login.title': 'تسجيل الدخول إلى ميدورا',
  'login.subtitle': 'أدخل بياناتك للوصول إلى مساحة عملك.',
  'login.remember': 'تذكّرني',
  'login.forgot': 'نسيت كلمة المرور؟',
  'login.submit': 'تسجيل الدخول',
  'login.noAccount': 'ليس لديك حساب؟',
  'login.signupLink': 'أنشئ حسابًا',
  'login.demoTitle': 'بيانات تجريبية',
  'login.demoBody': 'استخدم هذه الحسابات التجريبية لاستكشاف النظام.',
  'login.error.invalid': 'البريد الإلكتروني أو كلمة المرور غير صحيحة. حاول مرة أخرى.',
  'login.error.generic': 'حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى.',
  'login.sessionEnded': 'انتهت جلستك. سجّل الدخول من جديد للمتابعة.',
  'login.error.inactive': 'هذا الحساب غير نشط. تواصل مع المسؤول.',
  'login.error.twoFactorRequired': 'يتطلب هذا الحساب المصادقة الثنائية. تواصل مع المسؤول.',
  'login.error.rateLimited': 'محاولات تسجيل دخول كثيرة جدًا. انتظر بضع دقائق ثم حاول مرة أخرى.',
  'login.error.unsupportedRole':
    'لا تتوفر بعد مساحة عمل لدور هذا الحساب في تطبيق ميدورا على الويب. اطلب من المسؤول تعيين دور مدعوم.',
  'login.error.patientRole':
    'المرضى يستخدمون تطبيق ميدورا للهاتف المحمول الخاص بالمرضى. سجّل الدخول من هناك، فالتطبيق على الويب مخصص لموظفي العيادة.',

  // Signup
  'signup.title': 'إنشاء حسابك',
  'signup.subtitle': 'انضم إلى فريق الرعاية الخاص بك على ميدورا.',
  'signup.firstName': 'الاسم الأول',
  'signup.lastName': 'اسم العائلة',
  'signup.phone': 'رقم الهاتف',
  'signup.professionalSection': 'البيانات المهنية',
  'signup.professionalNumber': 'رقم التسجيل المهني',
  'signup.professionalNumberHelp': 'الرقم المدوَّن في قيدك بسجل مزاولة المهنة',
  'signup.professionalCategory': 'الفئة المهنية',
  'signup.specialty': 'التخصص',
  'signup.registrationExpiry': 'تاريخ انتهاء التسجيل',
  'signup.registrationExpiryHelp': 'اختياري',
  'signup.verificationNotice': 'ستتم مراجعة تسجيلك المهني قبل تفعيل حسابك للاستخدام السريري.',
  'signup.terms': 'أوافق على الشروط والأحكام',
  'signup.privacy': 'لقد قرأت سياسة الخصوصية',
  'signup.submit': 'إنشاء الحساب',
  'signup.haveAccount': 'لديك حساب بالفعل؟',
  'signup.loginLink': 'تسجيل الدخول',
  'signup.error.taken': 'يوجد حساب مسجَّل بهذا البريد الإلكتروني بالفعل.',
  'signup.error.professionalNumberTaken': 'رقم التسجيل المهني هذا مستخدَم بالفعل.',
  'signup.error.generic': 'تعذّر إنشاء حسابك. حاول مرة أخرى.',

  // Password strength
  'strength.label': 'قوة كلمة المرور',
  'strength.0': 'ضعيفة جدًا',
  'strength.1': 'ضعيفة',
  'strength.2': 'متوسطة',
  'strength.3': 'قوية',
  'strength.4': 'قوية جدًا',

  // Forgot password
  'forgot.title': 'إعادة تعيين كلمة المرور',
  'forgot.subtitle': 'أدخل بريدك الإلكتروني وسنرسل إليك رابط إعادة التعيين.',
  'forgot.submit': 'إرسال رابط إعادة التعيين',
  'forgot.successTitle': 'تحقّق من بريدك',
  'forgot.successBody':
    'إذا كان هناك حساب مرتبط بهذا البريد، فرابط إعادة التعيين في طريقه إليك. تنتهي صلاحية الرابط خلال 30 دقيقة.',
  'forgot.error.generic': 'تعذّر إرسال رابط إعادة التعيين. حاول مرة أخرى.',

  // Reset password
  'reset.title': 'اختر كلمة مرور جديدة',
  'reset.subtitle': 'يجب أن تختلف كلمة المرور الجديدة عن السابقة.',
  'reset.newPassword': 'كلمة المرور الجديدة',
  'reset.submit': 'إعادة تعيين كلمة المرور',
  'reset.successTitle': 'تم تحديث كلمة المرور',
  'reset.successBody': 'تم تغيير كلمة المرور. يمكنك الآن تسجيل الدخول.',
  'reset.successCta': 'المتابعة إلى تسجيل الدخول',
  'reset.error.token': 'رابط إعادة التعيين هذا غير صالح أو انتهت صلاحيته.',
  'reset.error.generic': 'تعذّر إعادة تعيين كلمة المرور. حاول مرة أخرى.',

  // Verify email
  'verifyEmail.title': 'تأكيد بريدك الإلكتروني',
  'verifyEmail.subtitle': 'أرسلنا رابط تأكيد إلى بريدك.',
  'verifyEmail.pending': 'لم يصلك؟ تحقّق من مجلد الرسائل غير المرغوب فيها أو أعد الإرسال أدناه.',
  'verifyEmail.resend': 'إعادة إرسال الرسالة',
  'verifyEmail.resendIn': 'إعادة الإرسال متاحة خلال',
  'verifyEmail.verifying': 'جارٍ تأكيد بريدك…',
  'verifyEmail.successTitle': 'تم تأكيد البريد',
  'verifyEmail.successBody': 'تم تأكيد بريدك الإلكتروني. يمكنك الآن تسجيل الدخول.',
  'verifyEmail.successCta': 'المتابعة إلى تسجيل الدخول',
  'verifyEmail.error.token': 'رابط التأكيد هذا غير صالح أو انتهت صلاحيته.',
  'verifyEmail.error.resend': 'تعذّر إرسال رسالة تحقق جديدة. حاول مرة أخرى.',

  // Verify OTP
  'otp.title': 'التحقّق بخطوتين',
  'otp.subtitle': 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.',
  'otp.hint': 'الرمز التجريبي: 123456',
  'otp.submit': 'تحقّق',
  'otp.resend': 'تحتاج إلى مزيد من الوقت؟',
  'otp.resendIn': 'يتوفر مزيد من الوقت خلال',
  'otp.error.invalid': 'الرمز غير صحيح. حاول مرة أخرى.',
  'otp.error.generic': 'تعذّر التحقّق من الرمز. حاول مرة أخرى.',
  'otp.error.expired': 'انتهت صلاحية تسجيل الدخول هذا. ارجع وسجّل الدخول مرة أخرى.',
  'otp.useRecoveryCode': 'استخدام رمز استرداد بدلًا من ذلك',
  'otp.useAuthenticator': 'استخدام تطبيق المصادقة بدلًا من ذلك',
  'otp.recovery.subtitle':
    'أدخل أحد رموز الاسترداد التي حفظتها عند تفعيل المصادقة الثنائية. يعمل كل رمز مرة واحدة فقط.',
  'otp.recovery.label': 'رمز الاسترداد',
  'otp.recovery.submit': 'تحقّق من رمز الاسترداد',
  'otp.recovery.error.invalid': 'رمز الاسترداد غير صالح. تحقّق منه وحاول مرة أخرى.',
  'otp.recovery.error.generic': 'تعذّر التحقّق من رمز الاسترداد. حاول مرة أخرى.',

  // Lock screen
  'lock.title': 'الجلسة مقفلة',
  'lock.subtitle': 'أدخل كلمة المرور لمتابعة ما كنت تعمل عليه.',
  'lock.unlock': 'إلغاء القفل',
  'lock.logout': 'لست أنت؟ تسجيل الخروج',
  'lock.error.invalid': 'كلمة المرور غير صحيحة. حاول مرة أخرى.',
  'lock.error.twoFactor':
    'يستخدم هذا الحساب تسجيل الدخول الثنائي، ولا يمكن إكماله من شاشة القفل. سجّل الخروج ثم سجّل الدخول من جديد.',
  'lock.error.generic': 'تعذّر إلغاء قفل الجلسة. حاول مرة أخرى.',
  'lock.error.lockedOut':
    'محاولات خاطئة كثيرة. حفاظًا على أمانك، تم تسجيل الخروج من هذه الجلسة. انتظر بضع دقائق، ثم سجّل الدخول مرة أخرى.',
  'lock.signInAgain': 'تسجيل الدخول مرة أخرى',

  // Language switcher
  'locale.label': 'اللغة',
  'locale.en': 'الإنجليزية',
  'locale.ar': 'العربية',
  'locale.fr': 'الفرنسية',
  'locale.fa': 'الفارسية',
  'locale.tr': 'التركية',

  // Shell chrome
  'shell.skipToContent': 'تخطَّ إلى المحتوى الرئيسي',
  'shell.navigation': 'التنقّل',
  'shell.toggleNavigation': 'إظهار أو إخفاء قائمة التنقّل',
  'shell.primary': 'الرئيسية',
  'shell.breadcrumb': 'مسار التنقّل',
  'shell.breadcrumbExpand': 'إظهار جميع مستويات المسار',
  'shell.globalSearch': 'البحث الشامل',
  'shell.searchResults': 'نتائج البحث',
  'shell.searchPlaceholder': 'ابحث…',
  'shell.searchPatientsPlaceholder': 'ابحث عن مريض…',
  'shell.notifications': 'الإشعارات',
  'shell.dismissNotification': 'إخفاء الإشعار',
  'shell.unread': 'غير مقروء',
  'shell.more': 'المزيد',
  'shell.account': 'الحساب',
  'shell.profile': 'ملفي الشخصي',
  'shell.settings': 'الإعدادات',
  'shell.help': 'المساعدة',
  'shell.signOut': 'تسجيل الخروج',
  'shell.theme': 'المظهر',
  'shell.themeLight': 'المظهر الفاتح',
  'shell.themeDark': 'المظهر الداكن',
  'shell.themeSystem': 'مظهر النظام',
  'shell.openAssistant': 'فتح Medora AI',

  // Navigation — doctor
  'nav.overview': 'نظرة عامة',
  'nav.patients': 'المرضى',
  'nav.appointments': 'المواعيد',
  'nav.appointmentsNew': 'إضافة موعد',
  'nav.medicalRecords': 'السجلات الطبية',
  'nav.medicalRecordsNew': 'سجل طبي جديد',
  'nav.assistant': 'Medora AI',
  'nav.section.clinical': 'العمل السريري',
  'nav.myClinic': 'عيادتي',
  'nav.labs': 'المختبر',
  'nav.pharmacy': 'الصيدلية',
  'nav.pharmacyAll': 'الوصفات',
  'nav.pharmacyNew': 'وصفة جديدة',
  'nav.testCatalogue': 'دليل الفحوصات',
  'nav.section.inbox': 'الوارد',
  'nav.messages': 'الرسائل',
  'nav.notifications': 'الإشعارات',
  'nav.reports': 'التقارير',

  // Navigation — administrator
  'nav.clinicOverview': 'نظرة عامة على العيادة',
  'nav.section.liveOperations': 'العمليات الجارية',
  'nav.doctors': 'الأطباء',
  'nav.queue': 'قائمة الانتظار',
  'nav.waitingRoom': 'غرفة الانتظار',
  'nav.section.peopleAndTime': 'الموظفون والأوقات',
  'nav.staff': 'الطاقم',
  'nav.departments': 'الأقسام',
  'nav.shifts': 'المناوبات',
  'nav.workingSchedule': 'مواعيد العمل',
  'nav.holidays': 'العطلات',
  'nav.section.facility': 'المرفق',
  'nav.rooms': 'الغرف',
  'nav.resources': 'الموارد',
  'nav.section.governance': 'الحوكمة',
  'nav.communications': 'مراقبة المراسلات',
  'nav.logs': 'سجلات النظام',
  'nav.announcements': 'الإعلانات',
  'nav.policies': 'سياسات العيادة',
  'nav.templates': 'قوالب المستندات',
  'nav.section.account': 'الحساب',

  // Shared states
  'state.loading': 'جارٍ التحميل…',
  'state.error': 'حدث خطأ ما',
  'state.errorBody': 'تعذّر تحميل هذا المحتوى. حاول مرة أخرى.',
  'state.retry': 'حاول مرة أخرى',
  'state.empty': 'لا يوجد ما يُعرض',
  'state.emptyBody': 'لا يوجد شيء هنا بعد.',
  'state.noResults': 'لا توجد نتائج',
  'state.noResultsBody': 'لا توجد عناصر تطابق عوامل التصفية الحالية.',
  'state.offline': 'يبدو أنك غير متصل بالإنترنت.',

  // Shared controls
  'ui.search': 'بحث',
  'ui.clearSearch': 'مسح البحث',
  'ui.filters': 'عوامل التصفية',
  'ui.activeFilters': 'عوامل التصفية المُفعّلة',
  'ui.clearFilters': 'مسح عوامل التصفية',
  'ui.export': 'تصدير',
  'ui.close': 'إغلاق',
  'ui.closeDialog': 'إغلاق النافذة',
  'ui.closePanel': 'إغلاق اللوحة',
  'ui.dismiss': 'إخفاء الرسالة',
  'ui.cancel': 'إلغاء',
  'ui.confirm': 'تأكيد',
  'ui.save': 'حفظ',
  'ui.saving': 'جارٍ الحفظ…',
  'ui.edit': 'تعديل',
  'ui.delete': 'حذف',
  'ui.add': 'إضافة',
  'ui.required': 'مطلوب',
  'ui.optional': 'اختياري',
  'ui.select': 'اختر…',
  'ui.selectAllRows': 'تحديد كل الصفوف',
  'ui.sortBy': 'ترتيب حسب',
  'ui.pagination': 'ترقيم الصفحات',
  'ui.previousPage': 'الصفحة السابقة',
  'ui.nextPage': 'الصفحة التالية',
  'ui.rowsPerPage': 'عدد الصفوف في الصفحة',
  'ui.pageOf': 'الصفحة {page} من {total}',
  'ui.zoomIn': 'تكبير',
  'ui.zoomOut': 'تصغير',

  // Multi-step flows
  'flow.stepOf': 'الخطوة {step} من {total}',
  'flow.complete': 'مكتملة',
  'flow.current': 'الحالية',
  'flow.locked': 'مقفلة',

  // Form validation
  'validation.required': 'هذا الحقل مطلوب',
  'validation.email': 'أدخل بريدًا إلكترونيًا صالحًا',
  'validation.minLength': 'يجب ألا يقل عن {count} حرفًا',
  'validation.passwordMismatch': 'كلمتا المرور غير متطابقتين',
  'validation.selectOne': 'اختر أحد الخيارات',

  // Administrator invitation (ADR-035 §5)
  'invitation.title': 'قبول الدعوة',
  'invitation.subtitle': 'اختر كلمة مرور لحساب المسؤول الخاص بك في ميدورا.',
  'invitation.mfaNotice':
    'تتطلب حسابات المسؤولين مصادقة ثنائية العامل، وسيتم إعدادها في الخطوة التالية.',
  'invitation.submitPassword': 'متابعة',
  'invitation.mfaTitle': 'إعداد المصادقة الثنائية',
  'invitation.mfaSubtitle': 'أضف هذا المفتاح إلى تطبيق المصادقة، ثم أدخل الرمز الذي يعرضه.',
  'invitation.secretLabel': 'مفتاح الإعداد',
  'invitation.secretHelp': 'أدخل هذا المفتاح يدويًا في تطبيق المصادقة لديك.',
  'invitation.recoveryLabel': 'رموز الاسترداد',
  'invitation.recoveryHelp': 'احفظها الآن؛ فهي تُعرض مرة واحدة ولا يمكن استرجاعها لاحقًا.',
  'invitation.codeLabel': 'أدخل الرمز المكوَّن من 6 أرقام',
  'invitation.submitCode': 'تفعيل الحساب',
  'invitation.successTitle': 'أصبح حسابك مفعَّلًا',
  'invitation.successBody':
    'سجِّل الدخول ببريدك الإلكتروني وكلمة المرور الجديدة ورمز تطبيق المصادقة.',
  'invitation.successCta': 'الانتقال إلى تسجيل الدخول',
  'invitation.error.token': 'لم يعد رابط الدعوة صالحًا. اطلب رابطًا جديدًا من المسؤول.',
  'invitation.error.code': 'هذا الرمز غير صحيح. راجع تطبيق المصادقة وحاول مجددًا.',
  'invitation.error.taken': 'يوجد حساب مسجَّل بهذا البريد الإلكتروني بالفعل.',
  'invitation.error.weakPassword': 'اختر كلمة مرور أقوى.',
  'invitation.error.generic': 'تعذّر إكمال دعوتك. حاول مرة أخرى.',
};
