import type { PartialMessages } from './en';

/**
 * Turkish (Türkçe) — left-to-right.
 *
 * Turkish is agglutinative, and the suffix on a word depends on its final
 * vowel. That makes concatenation a translator's trap: "{count} hasta" works
 * because the noun is unsuffixed, but a sentence built by gluing a
 * translated fragment onto a number generally does not. The interpolated
 * strings below are therefore written as whole sentences with the
 * placeholder in place, never as prefix + value.
 *
 * The dotted/dotless i distinction is real vocabulary, not a typo: "ilaç"
 * (medicine) and "ışık" (light) begin with different letters.
 */
export const tr: PartialMessages = {
  // Brand panel
  'brand.welcome': 'Medora’ya hoş geldiniz',
  'brand.tagline': 'Modern sağlık ekipleri için yapay zekâ destekli platform.',
  'brand.benefit.records': 'Hasta kayıtları, tahliller ve reçeteler tek yerde',
  'brand.benefit.scheduling': 'Gününüze uyum sağlayan akıllı randevu planlaması',
  'brand.benefit.ai': 'Notlar, özetler ve güvenlik kontrolleri için yapay zekâ desteği',
  'brand.security': 'HIPAA uyumlu · Uçtan uca şifreli',

  // Shared
  'common.email': 'E-posta adresi',
  'common.password': 'Parola',
  'common.confirmPassword': 'Parolayı doğrulayın',
  'common.emailPlaceholder': 'siz@hastane.org',
  'common.back': 'Girişe dön',
  'common.showPassword': 'Parolayı göster',
  'common.hidePassword': 'Parolayı gizle',
  'common.language': 'Dil',
  'common.theme': 'Tema',
  'common.rateLimited': 'Çok fazla deneme yapıldı. Birkaç dakika bekleyip yeniden deneyin.',

  // Login
  'login.title': 'Medora’ya giriş yapın',
  'login.subtitle': 'Çalışma alanınıza erişmek için bilgilerinizi girin.',
  'login.remember': 'Beni hatırla',
  'login.forgot': 'Parolanızı mı unuttunuz?',
  'login.submit': 'Giriş yap',
  'login.noAccount': 'Hesabınız yok mu?',
  'login.signupLink': 'Hesap oluşturun',
  'login.demoTitle': 'Demo bilgileri',
  'login.demoBody': 'Sistemi denemek için bu örnek hesapları kullanın.',
  'login.error.invalid': 'E-posta veya parola hatalı. Lütfen yeniden deneyin.',
  'login.error.generic': 'Giriş sırasında bir sorun oluştu. Lütfen yeniden deneyin.',
  'login.sessionEnded': 'Oturumunuz sona erdi. Devam etmek için yeniden oturum açın.',
  'login.error.inactive': 'Bu hesap etkin değil. Yöneticinize başvurun.',
  'login.error.twoFactorRequired':
    'Bu hesap için iki adımlı doğrulama gerekiyor. Yöneticinize başvurun.',
  'login.error.rateLimited':
    'Çok fazla giriş denemesi yapıldı. Birkaç dakika bekleyip yeniden deneyin.',
  'login.error.unsupportedRole':
    'Bu hesabın rolü için Medora web uygulamasında henüz bir çalışma alanı yok. Yöneticinizden desteklenen bir rol atamasını isteyin.',
  'login.error.patientRole':
    'Hastalar Medora hasta mobil uygulamasını kullanır. Lütfen oradan giriş yapın; web uygulaması klinik personeline yöneliktir.',

  // Signup
  'signup.title': 'Hesabınızı oluşturun',
  'signup.subtitle': 'Medora’da bakım ekibinize katılın.',
  'signup.firstName': 'Ad',
  'signup.lastName': 'Soyad',
  'signup.phone': 'Telefon numarası',
  'signup.professionalSection': 'Mesleki bilgiler',
  'signup.professionalNumber': 'Mesleki tescil numarası',
  'signup.professionalNumberHelp': 'Meslek icra kaydınızda yer alan numara',
  'signup.professionalCategory': 'Meslek kategorisi',
  'signup.specialty': 'Uzmanlık alanı',
  'signup.registrationExpiry': 'Tescil bitiş tarihi',
  'signup.registrationExpiryHelp': 'İsteğe bağlı',
  'signup.verificationNotice':
    'Hesabınız klinik kullanıma açılmadan önce mesleki tesciliniz incelenecektir.',
  'signup.terms': 'Şartlar ve Koşulları kabul ediyorum',
  'signup.privacy': 'Gizlilik Politikası’nı okudum',
  'signup.submit': 'Hesap oluştur',
  'signup.haveAccount': 'Zaten hesabınız var mı?',
  'signup.loginLink': 'Giriş yap',
  'signup.error.taken': 'Bu e-posta ile kayıtlı bir hesap zaten var.',
  'signup.error.professionalNumberTaken': 'Bu mesleki tescil numarası zaten kayıtlı.',
  'signup.error.generic': 'Hesabınız oluşturulamadı. Lütfen yeniden deneyin.',

  // Password strength
  'strength.label': 'Parola gücü',
  'strength.0': 'Çok zayıf',
  'strength.1': 'Zayıf',
  'strength.2': 'Orta',
  'strength.3': 'Güçlü',
  'strength.4': 'Çok güçlü',

  // Forgot password
  'forgot.title': 'Parolanızı sıfırlayın',
  'forgot.subtitle': 'E-postanızı girin, size bir sıfırlama bağlantısı gönderelim.',
  'forgot.submit': 'Sıfırlama bağlantısı gönder',
  'forgot.successTitle': 'Gelen kutunuzu kontrol edin',
  'forgot.successBody':
    'Bu e-postaya ait bir hesap varsa sıfırlama bağlantısı yola çıktı. Bağlantı 30 dakika içinde geçersiz olur.',
  'forgot.error.generic': 'Sıfırlama bağlantısı gönderilemedi. Lütfen yeniden deneyin.',

  // Reset password
  'reset.title': 'Yeni bir parola seçin',
  'reset.subtitle': 'Yeni parolanız öncekilerden farklı olmalıdır.',
  'reset.newPassword': 'Yeni parola',
  'reset.submit': 'Parolayı sıfırla',
  'reset.successTitle': 'Parola güncellendi',
  'reset.successBody': 'Parolanız değiştirildi. Artık giriş yapabilirsiniz.',
  'reset.successCta': 'Girişe devam et',
  'reset.error.token': 'Bu sıfırlama bağlantısı geçersiz veya süresi dolmuş.',
  'reset.error.generic': 'Parolanız sıfırlanamadı. Lütfen yeniden deneyin.',

  // Verify email
  'verifyEmail.title': 'E-postanızı doğrulayın',
  'verifyEmail.subtitle': 'Gelen kutunuza bir doğrulama bağlantısı gönderdik.',
  'verifyEmail.pending':
    'Ulaşmadı mı? Gereksiz klasörünü kontrol edin veya aşağıdan yeniden gönderin.',
  'verifyEmail.resend': 'E-postayı yeniden gönder',
  'verifyEmail.resendIn': 'Yeniden gönderme şu süre sonra:',
  'verifyEmail.verifying': 'E-postanız doğrulanıyor…',
  'verifyEmail.successTitle': 'E-posta doğrulandı',
  'verifyEmail.successBody': 'E-postanız onaylandı. Artık giriş yapabilirsiniz.',
  'verifyEmail.successCta': 'Girişe devam et',
  'verifyEmail.error.token': 'Bu doğrulama bağlantısı geçersiz veya süresi dolmuş.',
  'verifyEmail.error.resend': 'Yeni doğrulama e-postası gönderilemedi. Lütfen yeniden deneyin.',

  // Verify OTP
  'otp.title': 'İki adımlı doğrulama',
  'otp.subtitle': 'Kimlik doğrulama uygulamanızdaki 6 haneli kodu girin.',
  'otp.hint': 'Demo kodu: 123456',
  'otp.submit': 'Doğrula',
  'otp.resend': 'Daha fazla süre mi gerekiyor?',
  'otp.resendIn': 'Ek süre şu kadar sonra:',
  'otp.error.invalid': 'Bu kod hatalı. Lütfen yeniden deneyin.',
  'otp.error.generic': 'Kod doğrulanamadı. Lütfen yeniden deneyin.',
  'otp.error.expired': 'Bu oturum açma işleminin süresi doldu. Geri dönüp yeniden oturum açın.',
  'otp.useRecoveryCode': 'Bunun yerine kurtarma kodu kullan',
  'otp.useAuthenticator': 'Bunun yerine kimlik doğrulama uygulamanızı kullanın',
  'otp.recovery.subtitle':
    'İki adımlı doğrulamayı açarken kaydettiğiniz kurtarma kodlarından birini girin. Her kod yalnızca bir kez çalışır.',
  'otp.recovery.label': 'Kurtarma kodu',
  'otp.recovery.submit': 'Kurtarma kodunu doğrula',
  'otp.recovery.error.invalid': 'Bu kurtarma kodu geçerli değil. Kontrol edip yeniden deneyin.',
  'otp.recovery.error.generic': 'Kurtarma kodu doğrulanamadı. Lütfen yeniden deneyin.',

  // Lock screen
  'lock.title': 'Oturum kilitlendi',
  'lock.subtitle': 'Kaldığınız yerden devam etmek için parolanızı girin.',
  'lock.unlock': 'Kilidi aç',
  'lock.logout': 'Siz değil misiniz? Çıkış yapın',
  'lock.error.invalid': 'Parola hatalı. Lütfen yeniden deneyin.',
  'lock.error.twoFactor':
    'Bu hesap iki adımlı oturum açma kullanıyor; kilit ekranı bunu tamamlayamaz. Oturumu kapatıp yeniden açın.',
  'lock.error.generic': 'Oturumunuzun kilidi açılamadı. Lütfen yeniden deneyin.',
  'lock.error.lockedOut':
    'Çok fazla hatalı deneme. Güvenliğiniz için bu oturum kapatıldı. Birkaç dakika bekleyin, ardından yeniden oturum açın.',
  'lock.signInAgain': 'Yeniden oturum aç',

  // Language switcher
  'locale.label': 'Dil',
  'locale.en': 'İngilizce',
  'locale.ar': 'Arapça',
  'locale.fr': 'Fransızca',
  'locale.fa': 'Farsça',
  'locale.tr': 'Türkçe',

  // Shell chrome
  'shell.skipToContent': 'Ana içeriğe geç',
  'shell.navigation': 'Gezinme',
  'shell.toggleNavigation': 'Gezinmeyi aç/kapat',
  'shell.primary': 'Birincil',
  'shell.breadcrumb': 'Sayfa yolu',
  'shell.breadcrumbExpand': 'Tüm yol düzeylerini göster',
  'shell.globalSearch': 'Genel arama',
  'shell.searchResults': 'Arama sonuçları',
  'shell.searchPlaceholder': 'Ara…',
  'shell.searchPatientsPlaceholder': 'Hasta ara…',
  'shell.notifications': 'Bildirimler',
  'shell.dismissNotification': 'Bildirimi kapat',
  'shell.unread': 'Okunmamış',
  'shell.more': 'Daha fazla',
  'shell.account': 'Hesap',
  'shell.profile': 'Profilim',
  'shell.settings': 'Ayarlar',
  'shell.help': 'Yardım',
  'shell.signOut': 'Çıkış yap',
  'shell.theme': 'Tema',
  'shell.themeLight': 'Açık tema',
  'shell.themeDark': 'Koyu tema',
  'shell.themeSystem': 'Sistem teması',
  'shell.openAssistant': 'Medora AI’ı aç',

  // Navigation — doctor
  'nav.overview': 'Genel bakış',
  'nav.patients': 'Hastalar',
  'nav.patientsNew': 'Hasta ekle',
  'nav.appointments': 'Randevular',
  'nav.appointmentsNew': 'Randevu ekle',
  'nav.medicalRecords': 'Tıbbi kayıtlar',
  'nav.medicalRecordsNew': 'Yeni tıbbi kayıt',
  'nav.assistant': 'Medora AI',
  'nav.section.clinical': 'Klinik',
  'nav.myClinic': 'Kliniğim',
  'nav.labs': 'Laboratuvar',
  'nav.labsNew': 'Yeni istem',
  'nav.pharmacy': 'Eczane',
  'nav.pharmacyAll': 'Reçeteler',
  'nav.pharmacyNew': 'Yeni reçete',
  'nav.testCatalogue': 'Test kataloğu',
  'nav.section.inbox': 'Gelen kutusu',
  'nav.messages': 'Mesajlar',
  'nav.notifications': 'Bildirimler',
  'nav.reports': 'Raporlar',

  // Navigation — administrator
  'nav.clinicOverview': 'Klinik genel bakışı',
  'nav.section.liveOperations': 'Canlı işleyiş',
  'nav.doctors': 'Doktorlar',
  'nav.queue': 'Sıra',
  'nav.waitingRoom': 'Bekleme odası',
  'nav.section.peopleAndTime': 'Personel ve zaman',
  'nav.staff': 'Personel',
  'nav.departments': 'Bölümler',
  'nav.shifts': 'Vardiyalar',
  'nav.workingSchedule': 'Çalışma saatleri',
  'nav.holidays': 'Tatiller',
  'nav.section.facility': 'Tesis',
  'nav.rooms': 'Odalar',
  'nav.resources': 'Kaynaklar',
  'nav.section.governance': 'Yönetişim',
  'nav.communications': 'İletişim izleme',
  'nav.logs': 'Sistem günlükleri',
  'nav.announcements': 'Duyurular',
  'nav.policies': 'Klinik politikaları',
  'nav.templates': 'Belge şablonları',
  'nav.section.account': 'Hesap',

  // Shared states
  'state.loading': 'Yükleniyor…',
  'state.error': 'Bir şeyler ters gitti',
  'state.errorBody': 'Bu içerik yüklenemedi. Lütfen yeniden deneyin.',
  'state.retry': 'Yeniden dene',
  'state.empty': 'Gösterilecek bir şey yok',
  'state.emptyBody': 'Burada henüz bir şey yok.',
  'state.noResults': 'Sonuç yok',
  'state.noResultsBody': 'Geçerli filtrelerle eşleşen bir kayıt yok.',
  'state.offline': 'Çevrimdışı görünüyorsunuz.',

  // Shared controls
  'ui.search': 'Ara',
  'ui.clearSearch': 'Aramayı temizle',
  'ui.filters': 'Filtreler',
  'ui.activeFilters': 'Etkin filtreler',
  'ui.clearFilters': 'Filtreleri temizle',
  'ui.export': 'Dışa aktar',
  'ui.close': 'Kapat',
  'ui.closeDialog': 'İletişim kutusunu kapat',
  'ui.closePanel': 'Paneli kapat',
  'ui.dismiss': 'Mesajı kapat',
  'ui.cancel': 'İptal',
  'ui.confirm': 'Onayla',
  'ui.save': 'Kaydet',
  'ui.saving': 'Kaydediliyor…',
  'ui.edit': 'Düzenle',
  'ui.delete': 'Sil',
  'ui.add': 'Ekle',
  'ui.required': 'Zorunlu',
  'ui.optional': 'İsteğe bağlı',
  'ui.select': 'Seçin…',
  'ui.selectAllRows': 'Tüm satırları seç',
  'ui.sortBy': 'Şuna göre sırala',
  'ui.pagination': 'Sayfalama',
  'ui.previousPage': 'Önceki sayfa',
  'ui.nextPage': 'Sonraki sayfa',
  'ui.rowsPerPage': 'Sayfa başına satır',
  'ui.pageOf': 'Sayfa {page} / {total}',
  'ui.zoomIn': 'Yakınlaştır',
  'ui.zoomOut': 'Uzaklaştır',

  // Multi-step flows
  'flow.stepOf': 'Adım {step} / {total}',
  'flow.complete': 'tamamlandı',
  'flow.current': 'geçerli',
  'flow.locked': 'kilitli',

  // Form validation
  'validation.required': 'Bu alan zorunludur',
  'validation.email': 'Geçerli bir e-posta adresi girin',
  'validation.minLength': 'En az {count} karakter olmalıdır',
  'validation.passwordMismatch': 'Parolalar eşleşmiyor',
  'validation.selectOne': 'Bir seçenek belirleyin',

  // Administrator invitation (ADR-035 §5)
  'invitation.title': 'Davetinizi kabul edin',
  'invitation.subtitle': 'Medora yönetici hesabınız için bir parola seçin.',
  'invitation.mfaNotice':
    'Yönetici hesapları iki adımlı doğrulama gerektirir; bunu bir sonraki adımda kuracaksınız.',
  'invitation.submitPassword': 'Devam',
  'invitation.mfaTitle': 'İki adımlı doğrulamayı kurun',
  'invitation.mfaSubtitle':
    'Bu anahtarı doğrulayıcı uygulamanıza ekleyin, ardından gösterdiği kodu girin.',
  'invitation.secretLabel': 'Kurulum anahtarı',
  'invitation.secretHelp': 'Bu anahtarı doğrulayıcı uygulamanıza elle girin.',
  'invitation.recoveryLabel': 'Kurtarma kodları',
  'invitation.recoveryHelp': 'Şimdi kaydedin. Yalnızca bir kez gösterilir ve sonradan alınamaz.',
  'invitation.codeLabel': '6 haneli kodu girin',
  'invitation.submitCode': 'Hesabı etkinleştir',
  'invitation.successTitle': 'Hesabınız etkin',
  'invitation.successBody': 'E-postanız, yeni parolanız ve doğrulayıcı kodunuzla oturum açın.',
  'invitation.successCta': 'Oturum açmaya git',
  'invitation.error.token':
    'Bu davet bağlantısı artık geçerli değil. Bir yöneticiden yenisini isteyin.',
  'invitation.error.code':
    'Bu kod geçerli değil. Doğrulayıcı uygulamanızı kontrol edip yeniden deneyin.',
  'invitation.error.taken': 'Bu e-posta ile kayıtlı bir hesap zaten var.',
  'invitation.error.weakPassword': 'Daha güçlü bir parola seçin.',
  'invitation.error.generic': 'Davetinizi tamamlayamadık. Lütfen yeniden deneyin.',

  /* ── Unread counts (plural; were concatenated before the Arabic foundation) ── */
  'shell.unreadCount': { one: '{count} okunmamış', other: '{count} okunmamış' },
  'shell.notificationsUnread': {
    one: 'Bildirimler ({count} okunmamış)',
    other: 'Bildirimler ({count} okunmamış)',
  },
  'shell.unreadNotificationsBadge': {
    one: '{count} okunmamış — Bildirimler',
    other: '{count} okunmamış — Bildirimler',
  },
};
