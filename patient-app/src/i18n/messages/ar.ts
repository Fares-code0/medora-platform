import type { Messages } from './index';

/**
 * Arabic (C-09).
 *
 * Typed as `Messages`, which is `Record<MessageKey, string>` derived from
 * the English catalogue — so a key added to English and forgotten here is
 * a **compile error**, and a key misspelled here is one too. There is no
 * runtime "untranslated" state to discover on a device.
 *
 * ⚠ **These translations have not been reviewed by a native speaker.**
 * They are plain, non-clinical interface strings — "Try again", "You are
 * offline" — chosen for exactly that reason, and they are honest to the
 * English rather than idiomatic. The row that ships Arabic to patients
 * (S-08, RTL verified) should have them read by someone who speaks it
 * before that happens. Recording the caveat here rather than in a commit
 * message is deliberate: this file is where the next person looks.
 *
 * No clinical content is translated here. Emergency guidance is
 * clinically reviewed material (N-07, W-10) and is not in this
 * catalogue.
 */

export const ar: Messages = {
  'state.empty.title': 'لا يوجد شيء هنا بعد',
  'state.empty.body': 'عندما يتوفر شيء لعرضه، سيظهر هنا.',
  'state.offline.banner':
    'أنت غير متصل بالإنترنت. يمكنك قراءة ما هو معروض، لكن التغييرات لن تُحفظ.',

  'state.error.title': 'حدث خطأ ما',
  'state.error.body': 'حالت مشكلة غير متوقعة دون تحميل هذا المحتوى.',
  'state.error.network.title': 'أنت غير متصل بالإنترنت',
  'state.error.network.body': 'تعذّر على ميدورا الوصول إلى العيادة. تحقق من اتصالك وحاول مرة أخرى.',
  'state.error.timeout.title': 'استغرق ذلك وقتًا طويلًا',
  'state.error.timeout.body': 'لم تستجب العيادة في الوقت المحدد. حاول مرة أخرى بعد قليل.',
  'state.error.auth.title': 'يرجى تسجيل الدخول مرة أخرى',
  'state.error.auth.body': 'انتهت جلستك حفاظًا على أمانك.',
  'state.error.forbidden.title': 'غير متاح لك',
  'state.error.forbidden.body': 'هذه المعلومات ليست ضمن ما يمكنك الاطلاع عليه في ميدورا.',
  'state.error.notFound.title': 'غير موجود',
  'state.error.notFound.body': 'لم يعد هذا موجودًا. ربما تم تغييره أو حذفه.',
  'state.error.conflict.title': 'تغيّر هذا أثناء اطلاعك عليه',
  'state.error.conflict.body':
    'قام أحد العاملين في العيادة بتحديثه. أعد التحميل لعرض النسخة الحالية.',
  'state.error.rateLimited.title': 'محاولات كثيرة جدًا',
  'state.error.rateLimited.body': 'يرجى الانتظار {seconds} ثانية قبل المحاولة مرة أخرى.',
  'state.error.validation.title': 'لم ينجح ذلك',
  'state.error.validation.body': 'لم يتم قبول بعض البيانات. راجع النموذج وحاول مرة أخرى.',
  'state.error.cancelled.title': 'أُلغي',
  'state.error.cancelled.body': 'تم إيقاف هذا الطلب.',
  'state.error.server.title': 'واجه ميدورا مشكلة',
  'state.error.server.body': 'حدث خطأ من جانبنا. الرقم المرجعي {ref}.',
  'state.error.contract.title': 'يبدو أن هناك خطأ ما',
  'state.error.contract.body':
    'تلقّى ميدورا استجابة غير متوقعة. حاول مرة أخرى، وتواصل مع العيادة إذا تكرر ذلك.',
  'state.error.unavailable.title': 'غير متاح بعد',
  // ── What an unbuilt endpoint was going to do (the seam) ───────────
  //
  // `EndpointNotImplementedError` carries one of these, and `ErrorState`
  // and `authErrorKey` interpolate it into a translated sentence. They
  // used to be plain English strings in the service layer, which made
  // every refusal half-translated: "Recent activity غير متاح بعد."
  'capability.departments': 'قائمة الأقسام',
  'capability.profileEdit': 'تعديل بياناتك الشخصية',
  'capability.privacyRequests': 'طلبات الخصوصية الخاصة بك',
  'capability.dataExport': 'طلب بياناتك',
  'capability.accountClosure': 'طلب إغلاق حسابك',
  'capability.clinic': 'معلومات العيادة',
  'capability.recentActivity': 'النشاط الأخير',
  'capability.healthRecords': 'سجلّك الصحي',
  'capability.messages': 'الرسائل',
  'capability.slots': 'اختيار وقت الموعد',
  'capability.booking': 'حجز موعد',
  'capability.cancel': 'إلغاء موعد',
  'capability.reschedule': 'تغيير موعد',
  'capability.acceptProposal': 'قبول وقت مقترح',


  'state.error.unavailable.body':
    'ما زال {capability} قيد الإنشاء. سيظهر هنا بمجرد أن يصبح جاهزًا.',

  'auth.error.unknown': 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
  'auth.error.unavailable': '{capability} غير متاح بعد. هذا الجزء من ميدورا ما زال قيد الإنشاء.',
  'auth.error.invalidCredentials':
    'البريد الإلكتروني وكلمة المرور غير متطابقين. تحقق منهما وحاول مرة أخرى.',
  'auth.error.emailUnverified':
    'أكّد بريدك الإلكتروني قبل تسجيل الدخول. تحقق من بريدك بحثًا عن الرابط.',
  'auth.error.accountLocked':
    'تم قفل هذا الحساب بعد محاولات كثيرة. حاول لاحقًا أو أعد تعيين كلمة المرور.',
  'auth.error.otpInvalid': 'هذا الرمز غير صحيح. تحقق منه مقابل أحدث رمز في تطبيق المصادقة.',
  'auth.error.otpExpired': 'انتهت صلاحية هذا الرمز. اطلب رمزًا جديدًا.',
  'auth.error.tokenInvalid': 'لم يعد هذا الرابط صالحًا. اطلب رابطًا جديدًا.',
  'auth.error.emailTaken': 'يوجد حساب بالفعل بهذا البريد الإلكتروني.',
  'auth.error.weakPassword': 'اختر كلمة مرور أقوى.',
  'auth.error.rateLimited': 'محاولات كثيرة جدًا. انتظر {seconds} ثانية وحاول مرة أخرى.',
  'auth.error.validation': 'لم يتم قبول بعض البيانات. راجع النموذج وحاول مرة أخرى.',
  'auth.error.network': 'تعذّر على ميدورا الوصول إلى العيادة. تحقق من اتصالك.',
  'auth.error.timeout': 'استغرق ذلك وقتًا طويلًا. حاول مرة أخرى بعد قليل.',
  'auth.error.forbidden': 'لا يمكن لهذا الحساب تسجيل الدخول إلى تطبيق ميدورا للمرضى.',
  'auth.error.conflict': 'يوجد حساب بالفعل بهذه البيانات.',
  'auth.error.server': 'واجه ميدورا مشكلة. الرقم المرجعي {ref}.',
  'auth.error.currentPasswordWrong': 'هذه ليست كلمة المرور الحالية.',

  'action.retry': 'حاول مرة أخرى',
  'action.cancel': 'إلغاء',
  'action.close': 'إغلاق',
  'action.back': 'رجوع',

  'a11y.loading': 'جارٍ التحميل، يرجى الانتظار',
  'a11y.pageLoaded': 'تم التحميل. يتم عرض {shown} من {total}.',

  'language.title': 'اللغة',
  'language.restartRequired':
    'تعرض اللغة العربية الشاشة من اليمين إلى اليسار. أغلق ميدورا وأعد فتحه لتطبيق ذلك.',

  'language.reviewPending': 'لم تراجَع الترجمة العربية بعد من متحدث أصلي باللغة.',

  // Preferences — the first screen migrated onto the catalogue.
  'preferences.appearance.title': 'المظهر',
  'preferences.theme.title': 'السمة',
  'preferences.theme.system': 'اتّبع إعدادات هاتفي',
  'preferences.theme.light': 'فاتح',
  'preferences.theme.dark': 'داكن',
  'preferences.textSize.title': 'حجم النص',
  'preferences.textSize.body':
    'يتبع ميدورا حجم النص المضبوط على هاتفك. غيّره من إعدادات الوصول في هاتفك وسيطابقه ميدورا.',

  'auth.field.email': 'البريد الإلكتروني',
  'auth.field.password': 'كلمة المرور',
  'auth.field.firstName': 'الاسم الأول',
  'auth.field.lastName': 'اسم العائلة',
  'auth.field.phone': 'رقم الهاتف',
  'auth.field.confirmPassword': 'تأكيد كلمة المرور',
  'auth.action.signIn': 'تسجيل الدخول',
  'auth.action.createAccount': 'إنشاء حساب',
  'auth.action.backToSignIn': 'العودة إلى تسجيل الدخول',

  'auth.welcome.tagline': 'مواعيدك وسجلاتك وعيادتك في مكان واحد.',
  'auth.welcome.disclaimer':
    'ميدورا خدمة طبية. لا يقدّم استشارات طبية ولا تتم متابعته على مدار الساعة.',

  'auth.login.notice.sessionExpired': 'انتهت جلستك من أجل حماية حسابك. سجّل الدخول للمتابعة.',
  // `{duration}` is `formatMinutes`, not a bare number: "1 minutes" is
  // wrong in English and "5 دقيقة" is wrong in Arabic.
  'auth.login.notice.locked':
    'سجّل ميدورا خروجك بعد {duration} في الخلفية، من أجل حماية حسابك. سجّل الدخول للمتابعة.',
  'auth.login.forgotPassword': 'هل نسيت كلمة المرور؟',

  'auth.otp.title': 'التحقق بخطوتين',
  'auth.otp.body': 'أدخل الرمز المكوّن من ٦ أرقام من تطبيق المصادقة. يتغيّر الرمز كل ٣٠ ثانية.',
  'auth.otp.field': 'رمز التحقق',
  'auth.otp.submit': 'تحقّق',
  'auth.otp.resend': 'أحتاج إلى مزيد من الوقت',
  'auth.otp.resendCooldown': 'أحتاج إلى مزيد من الوقت ({seconds} ث)',
  'auth.otp.resent': 'لديك مزيد من الوقت. أدخل أحدث رمز من التطبيق.',
  'auth.otp.expired': 'انتهت صلاحية تسجيل الدخول هذا. ارجع وسجّل الدخول مرة أخرى.',
  'auth.otp.useRecovery': 'استخدام رمز استرداد بدلًا من ذلك',
  'auth.otp.useAuthenticator': 'استخدام تطبيق المصادقة بدلًا من ذلك',
  'auth.otp.recoveryBody':
    'أدخل أحد رموز الاسترداد التي حفظتها عند تفعيل التحقق بخطوتين. يعمل كل رمز مرة واحدة فقط.',
  'auth.otp.recoveryField': 'رمز الاسترداد',
  'auth.otp.recoverySubmit': 'تحقّق من رمز الاسترداد',
  'auth.otp.recoveryRequired': 'أدخل رمز استرداد.',
  'auth.otp.recoveryInvalid': 'رمز الاسترداد غير صالح. تحقّق منه وحاول مرة أخرى.',

  'auth.register.title': 'أنشئ حسابك',
  'auth.register.passwordHint': 'ثمانية أحرف على الأقل، مع حرف كبير ورقم ورمز.',
  'auth.register.acceptTerms': 'أوافق على الشروط والأحكام',
  'auth.register.acceptPrivacy': 'أوافق على سياسة الخصوصية',

  // ── Consent (E-05) ────────────────────────────────────────────────
  'consent.title': 'الشروط والخصوصية',
  'consent.intro': 'ما توافق عليه عند استخدام ميدورا، وما تفعله عيادتك بمعلوماتك.',
  'consent.terms.title': 'الشروط والأحكام',
  'consent.terms.body':
    'كيف يمكن استخدام ميدورا، وما ليس هو — فهو ليس خدمة طوارئ ولا يقدّم استشارات طبية.',
  'consent.privacy.title': 'سياسة الخصوصية',
  'consent.privacy.body': 'ما تسجّله عيادتك عنك، ومن يمكنه الاطلاع عليه، ومدة الاحتفاظ به.',
  'consent.read': 'اقرأ الوثيقة',
  'consent.unpublished': 'لم تنشر عيادتك هذه الوثيقة في التطبيق بعد. اطلب نسخة من الاستقبال.',
  'consent.openFailed': 'تعذّر فتح الوثيقة. تحقق من اتصالك وحاول مرة أخرى.',
  'consent.version': 'الإصدار {version}',
  'consent.reviewLink': 'اقرأ الشروط وسياسة الخصوصية',
  'profile.consent': 'الشروط والخصوصية',
  'auth.register.submit': 'إنشاء الحساب',
  'auth.register.recordsNotice':
    'إنشاء حساب لا يمنح ميدورا الوصول إلى سجلات محفوظة في مكان آخر. تربط عيادتك حسابك بسجلك الطبي بشكل منفصل.',
  'auth.register.haveAccount': 'لديّ حساب بالفعل',

  'auth.verify.title': 'أكّد بريدك الإلكتروني',
  'auth.verify.body': 'أرسلنا رابطًا إلى {email}. افتحه لإكمال إعداد حسابك.',
  'auth.verify.resend': 'إعادة إرسال الرابط',
  'auth.verify.resendCooldown': 'إعادة إرسال الرابط ({seconds} ث)',
  'auth.verify.resent': 'أعدنا إرسال الرابط.',

  'auth.forgot.title': 'إعادة تعيين كلمة المرور',
  'auth.forgot.body':
    'أدخل البريد الإلكتروني المسجّل في حسابك على ميدورا وسنرسل رابط إعادة التعيين.',
  // Worded "if there is an account" in every language. A confirmation
  // that only appears for real addresses is an enumeration oracle with a
  // friendly tone, and a translation that says "we have sent you an
  // email" would reintroduce it.
  'auth.forgot.sent':
    'إذا كان هناك حساب مسجّل بهذا العنوان، فإن رابط إعادة التعيين في طريقه إليه. تنتهي صلاحية الرابط بعد وقت قصير.',
  'auth.forgot.submit': 'إرسال رابط إعادة التعيين',
  'auth.forgot.haveCode': 'لديّ رمز إعادة تعيين',

  'auth.reset.title': 'اختر كلمة مرور جديدة',
  'auth.reset.tokenLabel': 'رمز إعادة التعيين',
  'auth.reset.tokenHint': 'من الرسالة التي أرسلناها إليك.',
  'auth.reset.newPassword': 'كلمة المرور الجديدة',
  'auth.reset.confirmNewPassword': 'تأكيد كلمة المرور الجديدة',
  'auth.reset.submit': 'حفظ كلمة المرور الجديدة',
  'auth.reset.done': 'تم تغيير كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.',

  'auth.password.rule.length': '{count} أحرف على الأقل',
  'auth.password.rule.lower': 'حرف لاتيني صغير',
  'auth.password.rule.upper': 'حرف لاتيني كبير',
  'auth.password.rule.digit': 'رقم',
  'auth.password.rule.symbol': 'رمز',
  'auth.password.rules.a11y': 'متطلبات كلمة المرور. ما زال مطلوبًا: {missing}.',
  'auth.password.rules.a11yMet': 'متطلبات كلمة المرور. جميعها مستوفاة.',

  // ── Security: password change and 2FA (P-05, D-16) ────────────────
  'security.changePassword.success':
    'تم تغيير كلمة المرور. تم تسجيل الخروج من كل جهاز آخر مسجّل الدخول إلى ميدورا.',
  'security.changePassword.current': 'كلمة المرور الحالية',
  'security.changePassword.new': 'كلمة المرور الجديدة',
  'security.changePassword.confirm': 'تأكيد كلمة المرور الجديدة',
  'security.changePassword.notice':
    'يؤدي تغيير كلمة المرور إلى تسجيل خروجك من كل مكان آخر. ويبقى هذا الهاتف مسجَّل الدخول.',
  'security.changePassword.submit': 'تغيير كلمة المرور',

  'security.twoFactor.start': 'إعداد التحقق بخطوتين',
  'security.twoFactor.passwordIntro':
    'أكّد هويتك أولًا بإدخال كلمة المرور. لن يُعدّ أي شيء قبل التحقق منها.',
  'security.twoFactor.continue': 'متابعة',
  'security.twoFactor.cancel': 'إلغاء',
  'security.twoFactor.intro':
    'أضف ميدورا إلى تطبيق المصادقة لديك، ثم أدخل الرمز المكوّن من ٦ أرقام الذي يعرضه.',
  'security.twoFactor.openApp': 'فتح تطبيق المصادقة',
  'security.twoFactor.manualKey': 'أو أدخل هذا المفتاح يدويًا',
  'security.twoFactor.recoveryTitle': 'رموز الاسترداد',
  'security.twoFactor.recoveryBody':
    'دوّن هذه الرموز واحتفظ بها في مكان آمن. تُعرض مرة واحدة ولا يمكن عرضها مجددًا — وإذا فقدت هاتفك فهي وسيلتك للعودة.',
  'security.twoFactor.codeLabel': 'رمز من ٦ أرقام',
  'security.twoFactor.confirm': 'تفعيل التحقق بخطوتين',
  'security.twoFactor.enabled':
    'التحقق بخطوتين مفعّل. سيُطلب منك رمز في المرة القادمة التي تسجّل فيها الدخول.',
  'security.twoFactor.disableIntro':
    'هل تستخدم التحقق بخطوتين بالفعل؟ أدخل كلمة المرور لإيقافه. سيتم تسجيل الخروج من كل جهاز آخر.',
  'security.twoFactor.disable': 'إيقاف التحقق بخطوتين',
  'security.twoFactor.disabled': 'تم إيقاف التحقق بخطوتين، وسُجّل الخروج من كل جهاز آخر.',
  'security.twoFactor.statusOn': 'التحقق بخطوتين مُفعّل.',
  'security.twoFactor.statusOff': 'التحقق بخطوتين غير مُفعّل.',
  'security.twoFactor.codesLeftOne': 'تبقّى رمز استرداد واحد.',
  'security.twoFactor.codesLeftMany': 'تبقّى {count} من رموز الاسترداد.',
  'security.twoFactor.codesLow':
    'الرموز توشك على النفاد. استبدال تطبيق المصادقة يمنحك مجموعة جديدة.',
  'security.twoFactor.codesNone':
    'لم يتبقَّ أي رمز استرداد. إذا فقدت تطبيق المصادقة فلن تتمكن من تسجيل الدخول. استبدل التطبيق للحصول على مجموعة جديدة.',
  'security.twoFactor.replace': 'استبدال تطبيق المصادقة',
  'security.twoFactor.replaceIntro':
    'يبقى تطبيقك الحالي ورموز الاسترداد صالحة حتى تأكيد التطبيق الجديد.',
  'security.twoFactor.currentCodeLabel': 'رمز من تطبيقك الحالي',
  'security.twoFactor.newCodeLabel': 'رمز من التطبيق الجديد',
  'security.twoFactor.replaceConfirm': 'استبدال تطبيق المصادقة',
  'security.twoFactor.replaced':
    'أصبح تطبيق المصادقة الجديد قيد الاستخدام. لم يعد التطبيق القديم ولا رموز الاسترداد القديمة صالحة.',
  'security.twoFactor.newCodesTitle': 'رموز الاسترداد الجديدة',
  'security.twoFactor.replaceExpired': 'انتهت صلاحية هذا الاستبدال قبل تأكيده. ابدأ من جديد.',
  'security.twoFactor.currentCodeInvalid': 'هذا الرمز لا يطابق تطبيق المصادقة الحالي.',
  'security.twoFactor.lockedOut':
    'محاولات فاشلة كثيرة. حفاظًا على أمانك، تم تسجيل الخروج من هذه الجلسة.',
  'security.twoFactor.signInAgain': 'تسجيل الدخول مرة أخرى',
  'security.twoFactor.done': 'تم',

  // ── Navigation (the shell) ────────────────────────────────────────
  //
  // "Medora" is not a key anywhere: it is a name, and a name does not
  // get translated.
  'nav.tab.home': 'الرئيسية',
  'nav.tab.discover': 'استكشاف',
  'nav.tab.appointments': 'المواعيد',
  'nav.tab.messages': 'الرسائل',
  'nav.tab.profile': 'حسابي',
  // `{count}` is a whole number of unread notifications; the two forms
  // are the reason this is two keys rather than one with a plural slot.
  'nav.tab.unreadOne': '{tab}، إشعار واحد غير مقروء',
  'nav.tab.unreadMany': '{tab}، {count} إشعارًا غير مقروء',
  'nav.title.discover': 'استكشاف',
  'nav.title.doctor': 'الطبيب',
  'nav.title.clinic': 'عيادتنا',
  'nav.title.appointments': 'المواعيد',
  'nav.title.appointment': 'الموعد',
  'nav.title.messages': 'الرسائل',
  'nav.title.conversation': 'المحادثة',
  'nav.title.profile': 'حسابي',
  'nav.title.yourDetails': 'بياناتك',
  'nav.title.healthRecords': 'السجلات الصحية',
  'nav.title.labResults': 'نتائج التحاليل',
  'nav.title.prescriptions': 'الوصفات الطبية',
  'nav.title.documents': 'المستندات',
  'nav.title.visits': 'ملخصات الزيارات',
  'nav.title.visit': 'زيارة',
  'nav.title.notifications': 'الإشعارات',
  'nav.title.notificationPrefs': 'إعدادات الإشعارات',
  'nav.title.privacy': 'بياناتك',
  'nav.title.consent': 'الشروط والخصوصية',
  'nav.title.appearance': 'المظهر',
  'nav.title.security': 'الأمان',
  'nav.title.help': 'المساعدة',

  // ── Home (F-01…F-04) ──────────────────────────────────────────────
  'home.greeting': 'مرحبًا، {name}',
  // Used when the session carries no display name. "there" is what the
  // English sentence needs; Arabic greets without one.
  'home.greetingAnonymous': 'مرحبًا بك',
  'home.subtitle': 'هذا ما هو قادم.',
  'home.nextAppointment': 'الموعد القادم',
  'home.seeAll': 'عرض الكل',
  'home.empty.title': 'لا توجد مواعيد محجوزة',
  'home.empty.body': 'عندما يكون لديك موعد سيظهر هنا.',
  'home.empty.action': 'حجز موعد',
  'home.nextAppointment.a11y': 'الموعد القادم، {when} مع {doctor}',
  'home.nextAppointment.hint': 'يفتح الموعد',
  'home.quickActions': 'إجراءات سريعة',
  'home.action.book': 'حجز',
  'home.action.find': 'البحث عن طبيب',
  'home.action.messages': 'الرسائل',
  'home.action.records': 'السجلات',
  'home.disclaimer':
    'لا يقدّم ميدورا استشارات طبية. لأي أمر عاجل اتصل بعيادتك. وفي حالة الطوارئ استخدم Emergency help.',
  'home.activity.title': 'النشاط الأخير',
  'home.announcements.title': 'من عيادتك',
  'home.activity.empty.title': 'لم يحدث شيء بعد',
  'home.activity.empty.body': 'ستُدرج هنا المواعيد والنتائج والرسائل فور وصولها.',
  'home.activity.hint': 'يفتح الموعد',
  'home.activity.note':
    'التفاصيل تبقى داخل كل قسم، حتى تبقى هذه القائمة آمنة إن نظر إليها أحد بجانبك.',
  'home.activity.appointment-booked': 'قمت بحجز موعد',
  'home.activity.appointment-confirmed': 'تم تأكيد أحد المواعيد',
  'home.activity.appointment-cancelled': 'تم إلغاء أحد المواعيد',
  'home.activity.appointment-rescheduled': 'تم نقل أحد المواعيد',
  'home.activity.record-updated': 'تم تحديث سجلك الصحي',
  'home.activity.result-available': 'تتوفر نتيجة فحص جديدة',
  'home.activity.prescription-updated': 'تم تحديث إحدى الوصفات',
  'home.activity.message-received': 'وصلتك رسالة',

  // ── Onboarding (E-02) ─────────────────────────────────────────────
  'onboarding.slide.appointments.title': 'مواعيدك في مكان واحد',
  'onboarding.slide.appointments.body':
    'اطّلع على ما هو محجوز ومتى ومع مَن، دون الحاجة للاتصال بالعيادة للسؤال.',
  'onboarding.slide.clinic.title': 'اعثر على الطبيب المناسب',
  'onboarding.slide.clinic.body': 'تصفّح أطباء العيادة حسب التخصص، واقرأ عنهم قبل الحجز.',
  'onboarding.slide.emergency.title': 'مساعدة الطوارئ متاحة دائمًا',
  'onboarding.slide.emergency.body':
    'تعمل دون تسجيل الدخول ودون اتصال بالإنترنت. وهي على الشاشة الأولى وداخل التطبيق وقتما تحتاجها.',
  'onboarding.skip': 'تخطٍّ',
  'onboarding.next': 'التالي',
  'onboarding.finish': 'ابدأ',
  'onboarding.progress': 'الشريحة {position} من {total}',

  // ── Notifications (O-01, O-02) ────────────────────────────────────
  'notifications.title': 'الإشعارات',
  'notifications.unreadBadge': '{count} جديد',
  'notifications.markAll': 'تعليم الكل كمقروء',
  'notifications.new': 'جديد',
  'notifications.loadMore': 'عرض إشعارات أقدم',
  'notifications.loadMore.hint': 'يُعرض {shown} من {total}. يحمّل الصفحة التالية.',
  'notifications.end': 'هذه جميع الـ {total}.',
  'notifications.empty.title': 'لا يوجد ما تطّلع عليه',
  'notifications.empty.body': 'ستظهر هنا التحديثات المتعلقة بمواعيدك ونتائجك.',
  'notifications.markRead.failed': 'تعذّر تعليم هذا الإشعار كمقروء.',
  'notifications.markAll.failed': 'تعذّر تعليم إشعاراتك كمقروءة.',
  'notifications.unread.a11y': 'غير مقروء. {title}. {body}',
  'notifications.open.hint': 'يفتح الموعد',
  'notifications.open.hint.unread': 'يضع علامة مقروء ويفتح الموعد',
  'notifications.markUnread': 'وضع علامة غير مقروء',
  'notifications.markUnread.hint': 'يعيده إلى عدد غير المقروءة',
  'notifications.markUnread.failed': 'تعذّر وضع علامة غير مقروء على هذا الإشعار.',
  'notifications.markRead.hint': 'يعلّمه كمقروء',
  'notifications.noPush': 'لا يرسل ميدورا إشعارات فورية بعد. تابع التحديثات من هنا.',

  // ── Notification preferences (O-06) ───────────────────────────────
  'notificationPrefs.title': 'إعدادات الإشعارات',
  'notificationPrefs.intro':
    'اختر كيف يصل إليك ميدورا وبماذا يخبرك. عيادتك تسجّل كل شيء في الحالتين.',
  'notificationPrefs.saveFailed': 'تعذّر حفظ هذا الإعداد، وقد أُعيد كما كان.',

  'notificationPrefs.section.channels': 'كيف يصل إليك ميدورا',
  'notificationPrefs.channel.push': 'الإشعارات الفورية',
  'notificationPrefs.channel.push.body': 'تنبيهات على هذا الهاتف، حتى عندما يكون ميدورا مغلقًا.',
  'notificationPrefs.channel.inApp': 'داخل التطبيق',
  'notificationPrefs.channel.inApp.body': 'الجرس في صفحة حسابك، والشارة على شريط التبويبات.',
  'notificationPrefs.channel.email': 'البريد الإلكتروني',
  'notificationPrefs.channel.email.body': 'إلى العنوان المسجّل في حسابك.',
  'notificationPrefs.channel.sms': 'رسالة نصية',
  'notificationPrefs.channel.sms.body': 'التنبيهات العاجلة فقط، إلى رقمك المسجّل.',
  'notificationPrefs.channel.unavailable': 'غير متاح بعد',
  'notificationPrefs.channel.push.unavailable':
    'لا يرسل ميدورا إشعارات فورية بعد، فلا يوجد ما يمكن تفعيله.',

  'notificationPrefs.section.categories': 'بماذا تريد أن نخبرك',
  'notificationPrefs.category.appointments': 'المواعيد',
  'notificationPrefs.category.appointments.body': 'التأكيدات والتغييرات والتذكيرات.',
  'notificationPrefs.category.medical-records': 'سجلك الصحي',
  'notificationPrefs.category.medical-records.body': 'عندما تضيف عيادتك شيئًا إليه.',
  'notificationPrefs.category.laboratory': 'نتائج الفحوصات',
  'notificationPrefs.category.laboratory.body': 'عندما تصبح نتيجة جاهزة للاطلاع.',
  'notificationPrefs.category.pharmacy': 'الوصفات',
  'notificationPrefs.category.pharmacy.body': 'إعادة الصرف والتغييرات التي تجريها عيادتك.',
  'notificationPrefs.category.system': 'عن ميدورا',
  'notificationPrefs.category.system.body': 'الصيانة المجدولة وتحديثات التطبيق.',
  'notificationPrefs.category.security': 'تسجيل الدخول وأمان الحساب',
  'notificationPrefs.category.security.body':
    'مفعّلة دائمًا. إذا سجّل أحدهم الدخول باسمك، فهذه هي الرسالة التي تحتاجها أكثر من غيرها.',
  'notificationPrefs.category.alwaysOn': 'مفعّلة دائمًا',

  'notificationPrefs.section.quietHours': 'ساعات الهدوء',
  'notificationPrefs.quietHours.toggle': 'تأجيل الإشعارات ليلًا',
  'notificationPrefs.quietHours.from': 'من',
  'notificationPrefs.quietHours.to': 'حتى',
  'notificationPrefs.quietHours.hint': 'بنظام 24 ساعة، مثل 22:00',
  'notificationPrefs.quietHours.invalid': 'أدخل وقتًا بنظام 24 ساعة، مثل 22:00.',
  'notificationPrefs.quietHours.identical': 'اختر وقتين مختلفين.',
  'notificationPrefs.quietHours.window': 'تُؤجَّل بين {from} و{to}.',
  'notificationPrefs.quietHours.urgent':
    'التنبيهات العاجلة تصلك دائمًا مهما كان الوقت. ساعات الهدوء تؤجّل ما عداها حتى الصباح.',

  'notificationPrefs.entry': 'إعدادات الإشعارات',
  'notificationPrefs.entry.subtitle': 'القنوات والفئات وساعات الهدوء',

  // ── Profile (P-01, P-08) ──────────────────────────────────────────
  'profile.linked': 'مرتبط بسجلك الطبي',
  'profile.notLinked': 'غير مرتبط بسجل طبي',
  'profile.section.health': 'صحتك',
  'profile.section.account': 'الحساب',
  'profile.healthRecords': 'السجلات الصحية',
  'profile.healthRecords.subtitle': 'الحساسيات والحالات والأدوية والتاريخ الطبي',
  'profile.labResults': 'نتائج التحاليل',
  'profile.prescriptions': 'الوصفات الطبية',
  'profile.documents': 'المستندات',
  'profile.personalDetails': 'البيانات الشخصية',
  'profile.notifications': 'الإشعارات',
  'profile.appearance': 'المظهر',
  'profile.security': 'الأمان',
  'profile.help': 'المساعدة والملاحظات',
  'profile.signOut': 'تسجيل الخروج',
  'profile.signOut.confirmTitle': 'تسجيل الخروج من ميدورا؟',
  'profile.signOut.confirmDetail':
    'ستحتاج إلى كلمة المرور لتسجيل الدخول مجددًا. وتبقى مساعدة الطوارئ متاحة أثناء تسجيل خروجك.',

  // ── Privacy requests (P-09, P-10) ─────────────────────────────────
  'privacy.title': 'بياناتك',
  'privacy.requestedOn': 'طُلب في {date}',
  'privacy.failed': 'تعذّر إرسال الطلب. حاول مرة أخرى بعد قليل.',
  'privacy.status.pending': 'قيد التنفيذ',
  'privacy.status.ready': 'جاهز',
  'privacy.status.refused': 'لم يُعتمد',

  'privacy.export.title': 'احصل على نسخة من بياناتك',
  'privacy.export.body':
    'تُجهّز عيادتك ملفًا يضم المعلومات التي يحتفظ بها ميدورا عنك. يستغرق ذلك بعض الوقت، وسيصلك إشعار عندما يصبح جاهزًا.',
  'privacy.export.cta': 'اطلب نسخة',
  'privacy.export.pendingCta': 'سبق أن طلبتها',
  'privacy.export.requested': 'وصل طلبك إلى عيادتك، وسنخبرك عندما يصبح الملف جاهزًا.',

  'privacy.close.title': 'إغلاق حسابك',
  'privacy.close.body':
    'يمكن لعيادتك إغلاق حسابك في ميدورا. عندها لن تتمكن من تسجيل الدخول، وستتوقف الرسائل والتذكيرات هنا.',
  'privacy.close.retention':
    'لا يُحذف سجلك الطبي. عيادتك ملزمة بالاحتفاظ به، وإغلاق هذا الحساب لا يغيّر ما فيه ولا من يمكنه الاطلاع عليه.',
  'privacy.close.cta': 'أطلب إغلاق حسابي',
  'privacy.close.pendingCta': 'سبق أن طلبت ذلك',
  'privacy.close.confirmTitle': 'هل تطلب من عيادتك إغلاق هذا الحساب؟',
  'privacy.close.confirmDetail':
    'القرار لعيادتك وستتواصل معك. إعادة فتح الحساب لاحقًا تتطلب مراجعتهم.',
  'privacy.close.confirmCta': 'إرسال الطلب',
  'privacy.close.requested': 'وصل طلبك إلى عيادتك وستتواصل معك.',

  'profile.privacy': 'بياناتك',
  'profile.privacy.subtitle': 'احصل على نسخة، أو أغلق حسابك',

  // ── Security (P-05, P-06, D-16) ───────────────────────────────────
  'security.title': 'الأمان',
  'security.section.password': 'كلمة المرور',
  'security.password.notice':
    'لن يطلب منك ميدورا كلمة المرور عبر البريد الإلكتروني أو الرسائل أبدًا.',
  'security.section.twoFactor': 'التحقق بخطوتين',
  'security.twoFactor.blurb':
    'رمز من تطبيق مصادقة، إضافةً إلى كلمة المرور. هذا يعني أن مَن يعرف كلمة مرورك لا يستطيع مع ذلك الدخول باسمك.',
  'security.section.devices': 'الأجهزة المسجّل دخولك منها',
  'security.devices.empty': 'لا توجد أجهزة أخرى',
  'security.devices.lastUsed': 'آخر استخدام {when}',
  'security.devices.thisDevice': 'هذا الجهاز',
  'security.devices.unnamed': 'جهاز غير معروف',
  'security.devices.signOut': 'تسجيل خروج هذا الجهاز',
  'security.devices.hint': 'يسجّل خروج هذا الجهاز من ميدورا',
  'security.devices.confirmTitle': 'تسجيل خروج {device}؟',
  'security.devices.confirmDetail':
    'سيحتاج ذلك الجهاز إلى تسجيل الدخول من جديد. ويبقى هذا الهاتف مسجَّل الدخول.',
  'security.devices.signedOut': 'تم تسجيل خروج ذلك الجهاز.',
  'security.devices.failed': 'تعذّر تسجيل خروج ذلك الجهاز. حاول مرة أخرى.',
  'security.devices.notice': 'إذا لم تتعرّف على جهاز هنا، فسجّل خروجه وغيّر كلمة المرور.',
  'security.section.protection': 'كيف يحمي ميدورا معلوماتك',
  'security.protection.body':
    'لا تُحفظ معلوماتك الطبية على هذا الهاتف إطلاقًا. تبقى في الذاكرة فقط أثناء استخدامك للتطبيق، وتُمحى عند تسجيل الخروج أو بعد تركك التطبيق مدة من الوقت. أما بيانات دخولك فتُحفظ في مخزن المفاتيح الآمن في هاتفك.',

  // ── Help and feedback (W-11) ──────────────────────────────────────
  'support.title': 'المساعدة والملاحظات',
  'support.care.title': 'أسئلة عن رعايتك',
  'support.care.body':
    'أرسلها إلى عيادتك عبر الرسائل، حيث تصل إلى مَن يتابعون حالتك وتُحفظ مع سجلك. يرجى عدم وصف ما تشعر به أو مشاركة تفاصيل طبية أدناه — الدعم يخصّ التطبيق لا صحتك.',
  'support.app.title': 'مشكلات في التطبيق',
  'support.app.noAddress':
    'لم تُضبط بيانات التواصل مع دعم التطبيق في هذه النسخة بعد. اسأل في الاستقبال، أو استخدم رقم الهاتف المدوّن في خطاب موعدك.',
  'support.app.body':
    'راسلنا على {address}. ستُفتح رسالتك في تطبيق البريد لديك لترى بالضبط ما سيُرسل.',
  'support.app.contact': 'التواصل مع الدعم',
  'support.build.title': 'هذه النسخة',

  // ── Discover and doctor profiles (G-01…G-10) ──────────────────────
  'discover.title': 'ابحث عن طبيب',
  'discover.search.label': 'بحث',
  'discover.search.placeholder': 'الاسم أو التخصص',
  'discover.search.hint': 'يجري البحث في العيادة، لذا تبقى النتائج محدّثة.',
  'discover.specialty.all': 'الكل',
  'discover.specialty.label': 'التخصص',
  'discover.department.label': 'القسم',
  'discover.department.all': 'كل الأقسام',
  'discover.clinicCard.title': 'عيادتنا',
  'discover.clinicCard.subtitle': 'العنوان وساعات العمل والأقسام',
  'discover.recent': 'اطّلعت عليهم مؤخرًا',
  'discover.doctors': 'الأطباء',
  'discover.doctors.count': '{count} متاح',
  'discover.empty.title': 'لا يوجد أطباء مطابقون',
  'discover.empty.body': 'جرّب اسمًا أو تخصصًا آخر، أو امسح عوامل التصفية.',
  'discover.loadMore': 'عرض المزيد من الأطباء',
  'discover.loadMore.hint': 'يُعرض {shown} من {total}. يحمّل النتائج التالية.',
  'discover.end': 'هؤلاء جميع الـ {total}.',
  // The rating is spoken as well as drawn: a star is not a number to a
  // screen reader and not a comparison to a colour-blind reader.
  'doctor.card.a11y': '{name}، {specialty}',
  'doctor.card.a11yRated': '{name}، {specialty}، بتقييم {rating} من ٥',
  'doctor.card.hint': 'يفتح ملف هذا الطبيب',
  'doctor.card.years': '{count} سنة',
  'doctor.rating': '{rating} / ٥',
  'doctor.years': '{count} سنة',
  'doctor.book': 'حجز موعد',
  'doctor.availability.title': 'أقرب المواعيد المتاحة',
  // The separator differs on purpose: Arabic sets a list with «،»
  // (U+060C), not the middle dot. There are no words in this string,
  // and that is exactly why the punctuation has to be the right one.
  'doctor.availability.slot': '{date}، {time}',
  'doctor.availability.seeAll': 'عرض كل الأوقات',
  'doctor.availability.empty':
    'لا توجد أوقات متاحة خلال الأسبوع القادم. يمكنك طلب موعد على أي حال، وستقترح العيادة وقتًا.',
  'doctor.about': 'نبذة',
  'doctor.languages': 'اللغات',
  'doctor.education': 'المؤهلات',
  'doctor.where': 'مكان الكشف',

  // ── Our clinic (H-01…H-04) ────────────────────────────────────────
  'clinic.call': 'اتصل بـ {phone}',
  'clinic.openMap': 'فتح في الخرائط',
  'clinic.openWebsite': 'زيارة الموقع الإلكتروني',
  'clinic.hours': 'ساعات العمل',
  'clinic.hours.empty.title': 'ساعات العمل غير منشورة',
  'clinic.hours.empty.body': 'اتصل بالعيادة لمعرفة أوقات العمل.',
  'clinic.closed': 'مغلقة',
  'clinic.holidays': 'أيام الإغلاق',
  'clinic.holidays.subtitle': 'الأيام التي أعلنت العيادة إغلاقها فيها',
  'clinic.holidays.empty.title': 'لا توجد أيام إغلاق منشورة',
  'clinic.holidays.empty.body':
    'هذا لا يعني عدم وجودها. اتصل بالعيادة قبل التوجّه إلى موعدك.',
  'clinic.departments': 'الأقسام',
  'clinic.departments.empty': 'لا توجد أقسام مدرجة',
  'clinic.department.hint': 'يعرض أطباء هذا القسم',
  'department.doctors': 'أطباء هذا القسم',
  'department.empty.title': 'لا يوجد أطباء مدرجون هنا بعد',
  'department.empty.body': 'جرّب قسمًا آخر، أو ابحث بالاسم من صفحة البحث عن طبيب.',
  'clinic.singleClinicNote':
    'يخدم ميدورا عيادة واحدة. البحث في مستشفيات أخرى وعرض المسافة إليها ليسا جزءًا من هذه النسخة.',
  // The backend sends `Weekday` as a lowercase literal. An unrecognised
  // value falls back to the server's own string rather than to a guess.
  'weekday.sunday': 'الأحد',
  'weekday.monday': 'الاثنين',
  'weekday.tuesday': 'الثلاثاء',
  'weekday.wednesday': 'الأربعاء',
  'weekday.thursday': 'الخميس',
  'weekday.friday': 'الجمعة',
  'weekday.saturday': 'السبت',

  // ── Appointment status (C-08) ─────────────────────────────────────
  //
  // The server's kebab-case literal is never rendered — `awaiting-patient`
  // is a database value and "Needs your response" is what a patient
  // reads — but the literal is what the client sends and compares,
  // verbatim (A-07).
  'appointment.status.scheduled': 'مجدول',
  'appointment.status.confirmed': 'مؤكَّد',
  'appointment.status.pending': 'بانتظار العيادة',
  'appointment.status.completed': 'مكتمل',
  'appointment.status.cancelled': 'ملغى',
  'appointment.status.rescheduled': 'أُعيد جدولته',
  'appointment.status.noShow': 'لم يُحضَر',
  'appointment.status.awaitingPatient': 'يحتاج ردّك',

  // ── Appointments (I-01…I-10) ──────────────────────────────────────
  'appointments.title': 'المواعيد',
  'appointments.scope.upcoming': 'القادمة',
  'appointments.scope.past': 'السابقة',
  'appointments.book': 'حجز موعد',
  'appointments.empty.upcoming.title': 'لا توجد مواعيد محجوزة',
  'appointments.empty.upcoming.body': 'عند حجزك موعدًا سيظهر هنا.',
  'appointments.empty.past.title': 'لا توجد مواعيد سابقة',
  'appointments.empty.past.body': 'ستُدرج هنا المواعيد التي حضرتها.',
  'appointments.loadMore': 'عرض مواعيد أسبق',
  'appointments.loadMore.upcoming': 'عرض مواعيد لاحقة',
  'appointments.loadMore.hint': 'يُعرض {shown} من {total}. يحمّل الصفحة التالية.',
  'appointment.clinicTime': 'معروض بتوقيت العيادة.',
  'appointments.end': 'هذه جميع الـ {total}.',
  'appointments.card.a11y': '{when} مع {doctor}، {specialty}',
  'appointments.card.hint': 'يفتح الموعد',
  'appointment.duration': '{minutes} دقيقة',
  'appointment.details': 'التفاصيل',
  'appointment.visitType': 'نوع الزيارة',
  'appointment.reason': 'السبب',
  'appointment.notes': 'ملاحظات',
  'appointment.cancelledBecause': 'سبب الإلغاء',
  'appointment.history': 'السجل',
  'appointment.event.a11y': 'قام {actor} بتحديث هذا في {when}',
  'appointment.event.a11yStatus': 'غيّر {actor} الحالة إلى {status} في {when}',

  'appointment.proposals.title': 'اقترحت العيادة أوقاتًا جديدة',
  'appointment.proposals.body': 'اختر وقتًا للتأكيد، أو ألغِ إن لم يناسبك أيٌّ منها.',
  'appointment.action.reschedule': 'طلب إعادة الجدولة',
  'appointment.action.cancel': 'إلغاء الموعد',
  'appointment.cancel.sheetTitle': 'إلغاء هذا الموعد؟',
  'appointment.cancel.body': 'تحتاج العيادة إلى سبب. يُسجَّل هذا في موعدك.',
  'appointment.cancel.keep': 'الإبقاء عليه',
  'appointment.cancel.done': 'أُلغي الموعد',
  'appointment.reschedule.body':
    'ستعرض عليك العيادة أوقاتًا جديدة. ويبقى موعدك الحالي محجوزًا حتى تقبل أحدها.',
  'appointment.reschedule.reason': 'لماذا تحتاج إلى تغييره؟',
  'appointment.reschedule.send': 'إرسال الطلب',
  'appointment.reschedule.done': 'وصل طلب إعادة الجدولة إلى العيادة',
  'appointment.confirmed': 'تأكَّد الموعد',
  'appointment.action.failed': 'لم يتم ذلك. حاول مرة أخرى.',

  // ── Booking (I-03…I-05) ───────────────────────────────────────────
  'booking.step': 'الخطوة {position} من {total}',
  'booking.doctor.title': 'اختر طبيبًا',
  'booking.doctor.empty.title': 'لا يوجد أطباء متاحون',
  'booking.doctor.empty.body': 'حاول مرة أخرى بعد قليل.',
  'booking.date.title': 'اختر يومًا',
  'booking.date.next': 'اختر وقتًا',
  'booking.time.title': 'اختر وقتًا',
  'booking.time.note': 'تحدّد العيادة الأوقات وتتغيّر مع حجز الآخرين.',
  'booking.time.empty.title': 'لا توجد أوقات في ذلك اليوم',
  'booking.time.empty.body': 'ارجع وجرّب يومًا آخر.',
  'booking.time.next': 'متابعة',
  'booking.reason.title': 'ما سبب زيارتك؟',
  'booking.reason.label': 'سبب الموعد',
  'booking.reason.hint': '{used} من {max} حرفًا. تقرأ العيادة هذا قبل زيارتك.',
  'booking.reason.next': 'مراجعة',
  'booking.confirm.title': 'راجِع وأرسل',
  'booking.confirm.doctor': 'الطبيب',
  'booking.confirm.when': 'الموعد',
  'booking.confirm.reason': 'السبب',
  'booking.notes.label': 'أي شيء آخر ينبغي أن تعرفه العيادة (اختياري)',
  'booking.notes.hint': 'اترك هذا فارغاً إذا لم يكن هناك ما تضيفه.',
  'booking.confirm.notes': 'ملاحظتك',
  'booking.confirm.note': 'هذا طلب. تؤكده العيادة، وسترى تغيّر الحالة هنا.',
  'booking.submit': 'إرسال الطلب',
  'booking.submitted.toast': 'طلبك لدى العيادة',
  'booking.submitted.a11y': 'تم طلب الموعد. ستؤكده العيادة.',
  'booking.slotTaken.a11y': 'حُجز ذلك الوقت. اختر وقتًا آخر.',
  'booking.discard.title': 'الخروج دون حجز؟',
  'booking.discard.detail': 'لم يُرسل شيء إلى العيادة. وسيُفقد ما أدخلته.',
  'booking.discard.confirm': 'خروج',
  'booking.discard.cancel': 'متابعة الحجز',

  // ── Messages (M-01…M-05) ──────────────────────────────────────────
  'messages.title': 'الرسائل',
  'messages.empty.title': 'لا توجد رسائل',
  'messages.empty.body': 'ستظهر هنا محادثاتك مع العيادة.',
  'messages.conversation.a11yUnread': '{title}، {count} غير مقروء. {preview}',
  'messages.conversation.hint': 'يفتح المحادثة',
  'thread.a11y': 'محادثة مع {name}',
  'thread.empty.title': 'لا توجد رسائل بعد',
  'thread.empty.body': 'ابدأ المحادثة بالأسفل.',
  'thread.sendFailed': 'لم تُرسَل هذه الرسالة. حاول مرة أخرى.',
  'thread.offline': 'أنت غير متصل بالإنترنت. لا يمكن إرسال الرسائل حتى تعود الاتصال.',
  'thread.composer.label': 'رسالة',
  'thread.composer.placeholder': 'اكتب رسالة',
  'thread.send': 'إرسال',
  'thread.attachments': 'المرفقات غير متاحة بعد.',
  'thread.closed.title': 'هذه المحادثة مغلقة',
  'thread.closed.body': 'لا يمكنك الرد هنا. اتصل بالعيادة أو اطرح الأمر في موعدك القادم.',
  'thread.message.a11y': '{author}، {when}. {body}. {status}',
  'thread.message.edited': 'مُعدَّلة',
  'thread.status.sending': 'جارٍ الإرسال',
  'thread.status.sent': 'أُرسلت',
  'thread.status.delivered': 'وصلت',
  'thread.status.read': 'قُرئت',
  'thread.status.failed': 'لم تُرسَل',

  // ── Health records (J-01…J-09) ────────────────────────────────────
  //
  // The section titles, the empty states and the notices are here. The
  // CLINICAL VOCABULARY is not — see the exclusion note at the top.
  'health.title': 'السجلات الصحية',
  'health.notice':
    'تحتفظ عيادتك بهذه السجلات. لا يمكنك تعديلها هنا — وإذا بدا شيء غير صحيح فأبلغ العيادة في موعدك القادم.',
  'health.allergies': 'الحساسيات',
  'health.allergies.empty': 'لا توجد حساسيات مسجّلة',
  'health.conditions': 'الحالات المزمنة',
  'health.conditions.empty': 'لا توجد حالات مزمنة مسجّلة',
  'health.conditions.recorded': 'سُجّلت في {date}',
  'health.medications': 'الأدوية',
  'health.medications.empty': 'لا توجد أدوية مسجّلة',
  'health.medications.started': 'بدأ في {date}',
  'health.more': 'المزيد',
  'health.more.subtitle': 'نتائج التحاليل والوصفات والمستندات',
  'health.history': 'التاريخ الطبي',
  'health.history.empty': 'لا يوجد شيء مسجّل بعد',
  'health.history.subtitle': 'الأحدث أولاً',
  'health.labs.title': 'نتائج التحاليل',
  'health.labs.section': 'تحاليلك',
  'health.labs.empty.title': 'لا توجد تحاليل بعد',
  'health.labs.empty.body': 'ستظهر هنا التحاليل التي تطلبها عيادتك.',
  'health.labs.hint': 'يفتح النتائج',
  'health.labs.hide': 'إخفاء النتائج',
  'health.labs.hide.hint': 'يُخفي {panel}',
  'health.labs.resultCount': '{count} نتائج',
  'health.prescriptions.title': 'الوصفات الطبية',
  'health.prescriptions.empty.title': 'لا توجد وصفات',
  'health.prescriptions.empty.body': 'سيُدرج هنا كل ما يوصف لك.',
  'health.documents.title': 'المستندات',
  'health.documents.empty.title': 'لا توجد مستندات',
  'health.documents.empty.body': 'ستظهر هنا الخطابات والنماذج من عيادتك.',
  'health.documents.open': 'فتح',
  'health.documents.notAvailable': 'فتح المستندات غير متاح بعد.',
  'health.release.pending.title': 'بانتظار مراجعة طبيب',
  'health.release.pending.body': 'وصلت نتائجك ويطّلع عليها طبيب الآن. ستظهر لك هنا بعد انتهائه.',
  'health.release.withheld.title': 'غير مشاركة معك',
  'health.release.withheld.body':
    'لم تشارك العيادة هذا في ميدورا. اسأل في موعدك القادم أو راسل العيادة.',
  'health.release.notReady.title': 'غير جاهزة بعد',
  'health.release.notReady.body': 'ما زالت قيد المعالجة في المختبر.',

  // ── Forced upgrade (W-06) ─────────────────────────────────────────
  'upgrade.title': 'حدّث ميدورا للمتابعة',
  'upgrade.action': 'تحديث ميدورا',

  'health.labs.notice':
    'يعرض ميدورا القيم وعلامات المختبر نفسه. ولا يخبرك بمعناها — اسأل الطبيب الذي طلب التحليل.',
  'health.labs.a11y': '{panel}، {status}',
  'health.labs.ordered': 'طُلب في {date}',
  'health.labs.status.ordered': 'تم الطلب',
  'health.labs.status.collected': 'تم أخذ العينة',
  'health.labs.status.processing': 'في المختبر',
  'health.labs.status.completed': 'مكتمل',
  'health.labs.status.cancelled': 'ملغى',
  'health.labs.range': 'النطاق المخبري {range}',
  'health.labs.result.a11y': '{analyte}، {value}، {flag}',
  'health.labs.result.noValue': 'بلا قيمة',
  'health.labs.result.unflagged': 'بلا إشارة',
  'health.prescriptions.notice':
    'هذا سجل بما وُصف لك. أما الوصفات المتكررة فتُرتَّب مع عيادتك وليس من هنا.',
  'health.prescriptions.issued': 'صدرت في {date}',
  'health.prescriptions.refills': 'بقي {count} صرف',
  'health.documents.added': 'أُضيف في {date}',
  'health.documents.scanning': 'يجري فحصه للتأكد من سلامته. سيتاح بعد قليل.',
  'health.documents.scanFailed': 'تعذّر فحص هذا الملف ولا يمكن فتحه. وقد أُبلغت العيادة.',
  'health.documents.category.referral': 'إحالة',
  'health.documents.category.consent': 'نموذج موافقة',
  'health.documents.category.external-record': 'سجل خارجي',
  'health.documents.category.insurance': 'تأمين',
  'health.documents.category.report': 'تقرير',

  'health.visits.title': 'ملخصات الزيارات',
  'health.visits.notice':
    'ملخص قصير لكل زيارة، مكتوب لك. وهو ليس الملاحظة الكاملة التي يحتفظ بها طبيبك، ولا يفسّر لك نتائجك — اسأل عيادتك عن أي شيء هنا.',
  'health.visits.empty.title': 'لا توجد ملخصات زيارات بعد',
  'health.visits.empty.body': 'يظهر الملخص هنا بعد الزيارة، متى شاركه طبيبك معك.',
  'health.visits.with': 'مع {doctor}',
  'health.visits.on': 'زيارة بتاريخ {date}',
  'health.visits.hint': 'يفتح الملخص',
  'health.visits.a11y': '{title}، {date}',
  'health.visits.noSummary': 'لم يكتب طبيبك ملخصًا لهذه الزيارة.',
  'health.visits.notFound.title': 'هذا الملخص ليس في سجلك',
  'health.visits.notFound.body': 'ارجع إلى ملخصات الزيارات وافتحه من القائمة.',

  'upgrade.body':
    'لم تعد هذه النسخة من ميدورا مدعومة. حدّث إلى أحدث نسخة لتسجيل الدخول والاطلاع على مواعيدك وسجلاتك.',
  'upgrade.noStoreLink': 'افتح App Store أو Google Play على هذا الهاتف وحدّث ميدورا.',
  'deprecation.available': 'تتوفر نسخة أحدث من ميدورا. يرجى التحديث عندما يتسنى لك ذلك.',
  'deprecation.sunset': 'تتوقف هذه النسخة من ميدورا عن العمل في {date}. يرجى التحديث قبل ذلك.',

  'profile.edit.title': 'البيانات الشخصية',
  'profile.edit.editable': 'يمكنك تغيير هذه',
  'profile.edit.save': 'حفظ التغييرات',
  'profile.edit.saved': 'تم حفظ بياناتك',
  'profile.edit.saveFailed': 'لم تُحفظ هذه التغييرات. حاول مرة أخرى.',
  'profile.edit.clinicHeld': 'محفوظة لدى عيادتك',
  'profile.edit.clinicHeldBody':
    'اسأل في الاستقبال أو في موعدك القادم إذا كان أيٌّ من هذا غير صحيح.',
  'profile.edit.keptBy': 'محفوظ لدى {owner}',
  'app.booting': 'جارٍ فتح ميدورا',

  'session.unconfirmed.title': 'تعذّر التأكد من تسجيل دخولك',
  'session.unconfirmed.body':
    'تعذّر الوصول إلى ميدورا. ما زلت مسجّل الدخول على هذا الهاتف، ولم يُحذف أي شيء.',
  'session.unconfirmed.offline': 'هذا الهاتف غير متصل بالإنترنت. سنحاول مرة أخرى عند عودة الاتصال.',
  'session.unconfirmed.online':
    'قد يكون الاتصال بطيئًا أو قد تكون ميدورا مشغولة. حاول مرة أخرى بعد قليل.',
  'session.unconfirmed.still': 'لا يزال الوصول إلى ميدورا متعذّرًا. حاول مرة أخرى بعد قليل.',
  'session.unconfirmed.retry': 'حاول مرة أخرى',
  'session.unconfirmed.signOut': 'تسجيل الخروج من هذا الهاتف',
  'session.unconfirmed.signOut.confirmTitle': 'تسجيل الخروج من هذا الهاتف؟',
  'session.unconfirmed.signOut.confirmDetail':
    'تعذّر الوصول إلى ميدورا، لذلك سيُسجَّل الخروج من هذا الهاتف فقط. سينتهي تسجيل دخولك لدى ميدورا من تلقاء نفسه عند انتهاء صلاحيته. ستحتاج إلى كلمة المرور لتسجيل الدخول مرة أخرى. تبقى المساعدة الطارئة متاحة.',

  'nav.title.signIn': 'تسجيل الدخول',
  'nav.title.sessionCheck': 'التحقق من تسجيل دخولك',
  'nav.title.verify': 'تحقّق',
  'nav.title.createAccount': 'إنشاء حساب',
  'nav.title.confirmEmail': 'تأكيد البريد',
  'nav.title.resetPassword': 'إعادة تعيين كلمة المرور',
  'nav.title.newPassword': 'كلمة مرور جديدة',

  // ── فتح التطبيق بالبصمة (D-15) ────────────────────────────────────
  'biometric.locked.title': 'ميدورا مقفل',
  'biometric.locked.a11y': 'ميدورا مقفل. {message}',
  'biometric.locked.default': 'ميدورا مقفل. افتح القفل للمتابعة.',
  'biometric.locked.cancelled': 'ميدورا مقفل. افتح القفل للمتابعة، أو سجّل الدخول بكلمة المرور.',
  'biometric.locked.failed': 'لم يتم التعرّف على ذلك. حاول مرة أخرى، أو سجّل الدخول بكلمة المرور.',
  'biometric.locked.unavailable':
    'لا يستطيع هذا الهاتف التحقق من بصمتك أو وجهك الآن. سجّل الدخول بكلمة المرور للمتابعة.',
  'biometric.unlock': 'فتح القفل',
  'biometric.usePassword': 'استخدام كلمة المرور بدلًا من ذلك',
  'biometric.setting.fallbackName': 'القياسات الحيوية',
  'biometric.setting.toggle': 'فتح القفل بواسطة {method}',
  'biometric.setting.body':
    'بعد إغلاق ميدورا لبضع دقائق، سيطلب {method} قبل عرض معلوماتك مجددًا. هذا يمنع مَن يمسك هاتفك المفتوح من قراءة سجلاتك. وهو لا يشفّر شيئًا ولا يغني عن تسجيل الخروج.',
  'biometric.setting.password': 'يمكنك دائمًا تسجيل الدخول بكلمة المرور بدلًا من ذلك.',
  // ── المساعد (المرحلة K والمرحلة L) ────────────────────────────────
  //
  // هذه الشاشات مصمَّمة وغير موصولة بأي مساعد — انظر
  // `features/ai/availability.ts`. النصوص هنا مكتوبة لهذه الحالة، لا
  // كنصوص مؤقتة لحالة عاملة.
  'ai.disclaimer.body':
    'يقدّم مساعد ميدورا معلومات عامة فقط. وهو ليس طبيبًا، ولا يستطيع تشخيصك، ولا يجوز استخدامه أبدًا في حالة طارئة.',

  'ai.badge.notConnected': 'غير موصول بعد',

  'ai.home.title': 'مساعد ميدورا',
  'ai.home.subtitle': 'معلومات صحية عامة، ومساعدة في الوصول إلى الرعاية المناسبة.',
  'ai.home.entry': 'اطّلع على ما سيفعله المساعد، وما الذي تستخدمه بدلًا منه حتى يتم وصله.',
  'ai.home.capabilities': 'ما الذي سيساعد فيه',
  'ai.home.capabilitiesSubtitle': 'لا شيء من هذه موصول بمساعد بعد.',
  'ai.home.safety': 'قبل أن تستخدمه',
  'ai.home.scope.title': 'ما الغرض منه',
  'ai.home.scope.body':
    'إيجاد التخصص المناسب، ووصف العَرَض حتى تستطيع إخبار الطبيب، والمساعدة في الحجز، ومعلومات عامة عن دواء.',
  'ai.home.scope.excluded':
    'لن يقرأ سجلاتك ولا نتائج فحوصك ولا وصفاتك، ولن يخبرك بما تعاني منه.',

  'ai.capability.hint': 'يفتح شاشة هذا الجزء من المساعد.',
  'ai.capability.chat.title': 'اطرح سؤالًا',
  'ai.capability.chat.body': 'معلومات صحية عامة، بكلماتك أنت.',
  'ai.capability.symptoms.title': 'صِف عَرَضًا',
  'ai.capability.symptoms.body':
    'مجموعة أسئلة قصيرة، لتقول بوضوح ما الذي تشعر به حين تتحدث إلى شخص.',
  'ai.capability.image.title': 'اعرض صورة',
  'ai.capability.image.body': 'لطفح جلدي أو جرح، حين يصعب الوصف بالكلمات.',

  'ai.unavailable.title': 'لا يوجد مساعد موصول',
  'ai.unavailable.body':
    'لم يتم وصل هذه النسخة من ميدورا بمساعد، لذلك لا شيء في هذه الشاشة يستطيع الإجابة. هذا ليس عطلًا، وإعادة المحاولة لن تغيّر شيئًا.',
  'ai.unavailable.instead':
    'لأي أمر يخص صحتك، راسل فريق الرعاية أو احجز موعدًا. وفي حالة الطوارئ، استخدم الزر أدناه.',
  'ai.unavailable.blockedBy': 'في انتظار: {rows}',

  'ai.safety.emergency.title': 'هذا ليس للطوارئ',
  'ai.safety.emergency.body':
    'إذا كان شخص مصابًا بشدة، أو لا يستطيع التنفس، أو فاقدًا للوعي، أو تعتقد أن الأمر قد يهدد الحياة، فلا تستخدم هذه الشاشة.',
  'ai.safety.emergency.action': 'مساعدة طارئة',
  'ai.safety.emergency.hint': 'يفتح إرشادات الطوارئ. ولا يُجري مكالمة.',
  'ai.safety.notADoctor.title': 'هذا برنامج، وليس طبيبًا',
  'ai.safety.notADoctor.body':
    'لا يستطيع فحصك، ولا تشخيصك، ولن يطلب منك أبدًا بدء دواء أو إيقافه أو تغييره.',
  'ai.safety.limits.title': 'قد يكون مخطئًا',
  'ai.safety.limits.body':
    'كل ما يكتبه معلومات عامة لم يقرأها أي طبيب قبلك. اعتبره بداية لحديث، لا إجابة.',
  'ai.safety.escalate.title': 'القرار لشخص، لا لبرنامج',
  'ai.safety.escalate.body':
    'كل ما يخص جسدك أو نتائجك أو علاجك يعود إلى طبيب يستطيع الاطلاع على سجلك.',
  'ai.safety.findCare': 'ابحث عن طبيب',

  'ai.chat.title': 'اطرح سؤالًا',
  'ai.chat.author.you': 'أنت',
  'ai.chat.author.assistant': 'مساعد ميدورا',
  'ai.chat.typing': 'يكتب ردًا',
  'ai.chat.empty.title': 'لا يوجد شيء هنا بعد',
  'ai.chat.empty.body': 'عند وصل مساعد، سيظهر هنا ما تسأله وما يجيب به.',
  'ai.chat.bubble.a11y': 'قال {author}: {body}. {time}',
  'ai.chat.bubble.failedA11y': 'قال {author}: {body}. لم يُرسل.',
  'ai.chat.bubble.failed': 'لم يُرسل',

  'ai.composer.label': 'رسالتك',
  'ai.composer.placeholder': 'اكتب سؤالك',
  'ai.composer.send': 'إرسال',
  'ai.composer.attach': 'إضافة صورة',
  'ai.composer.attachHint': 'يفتح شاشة الصور.',
  'ai.composer.disabled': 'غير متاح بعد',
  'ai.composer.disabledHint': 'لا يوجد مساعد موصول، لذلك لا يمكن إرسال شيء.',
  'ai.composer.disabledReason':
    'لا يمكنك إرسال أي شيء بعد — لا يوجد مساعد موصول بهذه النسخة من ميدورا.',

  'ai.intake.title': 'صِف عَرَضًا',
  'ai.intake.step': 'الخطوة {step} من {total}',
  'ai.intake.next': 'متابعة',
  'ai.intake.what.title': 'ما الذي تلاحظه؟',
  'ai.intake.what.subtitle': 'اختر كل ما ينطبق. لا يُرسل أي شيء هنا إلى أي جهة.',
  'ai.intake.when.title': 'منذ متى وهذا يحدث؟',
  'ai.intake.when.subtitle': 'الإجابة التقريبية كافية.',
  'ai.intake.review.title': 'ما الذي أخبرتنا به',
  'ai.intake.alwaysEmergency':
    'مهما اخترت في هذه الشاشة، إن بدا الأمر طارئًا فتعامل معه على أنه كذلك. هذه الشاشة لا تقرر ذلك عنك.',

  'ai.result.title': 'لم يطّلع أحد على هذا',
  'ai.result.body':
    'لا يوجد مساعد موصول بهذه النسخة من ميدورا، لذلك لم يقرأ أحد ما أدخلته ولا توجد نتيجة لعرضها.',
  'ai.result.notSent': 'لم يُرسل أي شيء إلى أي جهة، ولم يُحفظ أي شيء على هذا الهاتف.',
  'ai.result.summaryTitle': 'ما الذي اخترته',
  'ai.result.summaryA11y': 'ما الذي اخترته: {items}',
  'ai.result.findCare': 'ابحث عن طبيب',

  'ai.image.title': 'اعرض صورة',
  'ai.image.subtitle': 'لطفح جلدي أو جرح، حين يصعب الوصف بالكلمات.',
  'ai.image.section': 'صورتك',
  'ai.image.empty.title': 'لم تُختَر أي صورة',
  'ai.image.empty.body': 'اختيار صورة غير متاح في هذه النسخة.',
  'ai.image.choose': 'اختر صورة',
  'ai.image.disabledHint': 'اختيار صورة غير متاح في هذه النسخة.',
  'ai.image.remove': 'إزالة الصورة',
  'ai.image.previewA11y': 'الصورة التي اخترتها: {name}. لم يطّلع عليها شيء.',
  'ai.image.unnamed': 'بلا اسم',
  'ai.image.localOnly': 'هذه الصورة على هاتفك فقط. لم تُرسل إلى أي جهة.',
  'ai.image.processing': 'جارٍ الاطلاع على صورتك',
  'ai.image.done': 'انتهى.',
  'ai.image.privacy.title': 'ما الذي سيحدث لصورتك',
  'ai.image.privacy.body':
    'عند بناء هذه الميزة، ستُزال بيانات الموقع وتفاصيل الكاميرا من الصورة قبل أن تغادر هاتفك، وستُفحص قبل أن يفتحها أحد. لا شيء من ذلك موجود بعد، ولهذا لا يمكنك اختيار صورة.',

  'ai.symptomGroup.general': 'عام في الجسم',
  'ai.symptomGroup.head': 'الرأس والحلق',
  'ai.symptomGroup.chest': 'الصدر والتنفس',
  'ai.symptomGroup.abdomen': 'المعدة',
  'ai.symptomGroup.skin': 'الجلد',
  'ai.symptomGroup.mood': 'المزاج والنوم',
  'ai.symptom.fever': 'حُمّى',
  'ai.symptom.fatigue': 'تعب شديد',
  'ai.symptom.chills': 'قشعريرة',
  'ai.symptom.appetite': 'فقدان الشهية',
  'ai.symptom.headache': 'صداع',
  'ai.symptom.dizziness': 'دوخة',
  'ai.symptom.vision': 'صعوبة في الرؤية',
  'ai.symptom.soreThroat': 'التهاب الحلق',
  'ai.symptom.chestPain': 'ألم في الصدر',
  'ai.symptom.breathless': 'ضيق في التنفس',
  'ai.symptom.cough': 'سعال',
  'ai.symptom.palpitations': 'خفقان في القلب',
  'ai.symptom.nausea': 'غثيان',
  'ai.symptom.abdominalPain': 'ألم في المعدة',
  'ai.symptom.bowel': 'تغيّر في الإخراج',
  'ai.symptom.rash': 'طفح جلدي',
  'ai.symptom.swelling': 'تورّم',
  'ai.symptom.wound': 'جرح لا يلتئم',
  'ai.symptom.lowMood': 'مزاج منخفض',
  'ai.symptom.anxiety': 'قلق',
  'ai.symptom.sleep': 'صعوبة في النوم',
  'ai.duration.today': 'اليوم',
  'ai.duration.days': 'بضعة أيام',
  'ai.duration.weeks': 'بضعة أسابيع',
  'ai.duration.longer': 'أطول من ذلك',

  'nav.title.assistant': 'المساعد',
  'nav.title.assistantChat': 'اطرح سؤالًا',
  'nav.title.assistantSymptoms': 'صِف عَرَضًا',
  'nav.title.assistantImage': 'اعرض صورة',
  'security.section.unlock': 'قفل هذا التطبيق',
};
