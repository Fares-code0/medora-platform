import type { Messages } from './en';

/**
 * French (Français) — left-to-right.
 *
 * French UI text is reliably 15–25% longer than English, which is the
 * practical reason the RTL audit and the French pass were done together:
 * both break layouts that assume the English string's width. Where a label
 * had no shorter faithful rendering it was left long on purpose — truncating
 * the *translation* to fit a box sized for English is how a French UI ends up
 * unreadable.
 *
 * Typography follows French convention: a narrow no-break space before `?`
 * and `:` is what a French typesetter uses, but it does not survive every
 * font and input path in a web app, so a normal space is used consistently
 * rather than inconsistently.
 */
export const fr: Messages = {
  // Brand panel
  'brand.welcome': 'Bienvenue sur Medora',
  'brand.tagline': 'La plateforme dopée à l’IA pour les équipes de santé modernes.',
  'brand.benefit.records': 'Dossiers patients, analyses et ordonnances réunis',
  'brand.benefit.scheduling': 'Une planification intelligente qui s’adapte à votre journée',
  'brand.benefit.ai': 'Assistance IA pour les notes, les synthèses et les contrôles de sécurité',
  'brand.security': 'Conforme HIPAA · Chiffrement de bout en bout',

  // Shared
  'common.email': 'Adresse e-mail',
  'common.password': 'Mot de passe',
  'common.confirmPassword': 'Confirmer le mot de passe',
  'common.emailPlaceholder': 'vous@hopital.org',
  'common.back': 'Retour à la connexion',
  'common.showPassword': 'Afficher le mot de passe',
  'common.hidePassword': 'Masquer le mot de passe',
  'common.language': 'Langue',
  'common.theme': 'Thème',
  'common.rateLimited': 'Trop de tentatives. Patientez quelques minutes, puis réessayez.',

  // Login
  'login.title': 'Connexion à Medora',
  'login.subtitle': 'Saisissez vos identifiants pour accéder à votre espace de travail.',
  'login.remember': 'Se souvenir de moi',
  'login.forgot': 'Mot de passe oublié ?',
  'login.submit': 'Se connecter',
  'login.noAccount': 'Vous n’avez pas de compte ?',
  'login.signupLink': 'Créer un compte',
  'login.demoTitle': 'Identifiants de démonstration',
  'login.demoBody': 'Utilisez ces comptes de démonstration pour explorer l’application.',
  'login.error.invalid': 'E-mail ou mot de passe incorrect. Veuillez réessayer.',
  'login.error.generic': 'Un problème est survenu lors de la connexion. Veuillez réessayer.',
  'login.sessionEnded': 'Votre session a pris fin. Reconnectez-vous pour continuer.',
  'login.error.inactive': 'Ce compte n’est pas actif. Contactez votre administrateur.',
  'login.error.twoFactorRequired':
    'Ce compte exige une authentification à deux facteurs. Contactez votre administrateur.',
  'login.error.rateLimited':
    'Trop de tentatives de connexion. Patientez quelques minutes, puis réessayez.',
  'login.error.unsupportedRole':
    'Le rôle de ce compte n’a pas encore d’espace de travail dans l’application web Medora. Demandez à votre administrateur de lui attribuer un rôle pris en charge.',
  'login.error.patientRole':
    'Les patients utilisent l’application mobile Medora pour les patients. Connectez-vous depuis cette application : l’application web est réservée au personnel de la clinique.',

  // Signup
  'signup.title': 'Créer votre compte',
  'signup.subtitle': 'Rejoignez votre équipe soignante sur Medora.',
  'signup.firstName': 'Prénom',
  'signup.lastName': 'Nom',
  'signup.phone': 'Numéro de téléphone',
  'signup.professionalSection': 'Informations professionnelles',
  'signup.professionalNumber': 'Numéro d’inscription professionnelle',
  'signup.professionalNumberHelp': 'Le numéro figurant sur votre inscription à l’ordre',
  'signup.professionalCategory': 'Catégorie professionnelle',
  'signup.specialty': 'Spécialité',
  'signup.registrationExpiry': 'Fin de validité de l’inscription',
  'signup.registrationExpiryHelp': 'Facultatif',
  'signup.verificationNotice':
    'Votre inscription sera vérifiée avant l’activation de votre compte pour un usage clinique.',
  'signup.terms': 'J’accepte les conditions générales',
  'signup.privacy': 'J’ai lu la politique de confidentialité',
  'signup.submit': 'Créer le compte',
  'signup.haveAccount': 'Vous avez déjà un compte ?',
  'signup.loginLink': 'Se connecter',
  'signup.error.taken': 'Un compte existe déjà avec cette adresse e-mail.',
  'signup.error.professionalNumberTaken':
    'Ce numéro d’inscription professionnelle est déjà enregistré.',
  'signup.error.generic': 'Nous n’avons pas pu créer votre compte. Veuillez réessayer.',

  // Password strength
  'strength.label': 'Robustesse du mot de passe',
  'strength.0': 'Très faible',
  'strength.1': 'Faible',
  'strength.2': 'Moyenne',
  'strength.3': 'Robuste',
  'strength.4': 'Très robuste',

  // Forgot password
  'forgot.title': 'Réinitialiser votre mot de passe',
  'forgot.subtitle': 'Saisissez votre e-mail et nous vous enverrons un lien de réinitialisation.',
  'forgot.submit': 'Envoyer le lien',
  'forgot.successTitle': 'Consultez votre boîte de réception',
  'forgot.successBody':
    'Si un compte existe pour cette adresse, un lien de réinitialisation est en route. Le lien expire dans 30 minutes.',
  'forgot.error.generic': 'Nous n’avons pas pu envoyer le lien. Veuillez réessayer.',

  // Reset password
  'reset.title': 'Choisir un nouveau mot de passe',
  'reset.subtitle': 'Votre nouveau mot de passe doit être différent des précédents.',
  'reset.newPassword': 'Nouveau mot de passe',
  'reset.submit': 'Réinitialiser le mot de passe',
  'reset.successTitle': 'Mot de passe mis à jour',
  'reset.successBody': 'Votre mot de passe a été modifié. Vous pouvez maintenant vous connecter.',
  'reset.successCta': 'Continuer vers la connexion',
  'reset.error.token': 'Ce lien de réinitialisation est invalide ou a expiré.',
  'reset.error.generic':
    'Nous n’avons pas pu réinitialiser votre mot de passe. Veuillez réessayer.',

  // Verify email
  'verifyEmail.title': 'Vérifier votre e-mail',
  'verifyEmail.subtitle':
    'Nous avons envoyé un lien de vérification dans votre boîte de réception.',
  'verifyEmail.pending':
    'Rien reçu ? Vérifiez vos courriers indésirables ou renvoyez le message ci-dessous.',
  'verifyEmail.resend': 'Renvoyer l’e-mail',
  'verifyEmail.resendIn': 'Nouvel envoi possible dans',
  'verifyEmail.verifying': 'Vérification de votre e-mail…',
  'verifyEmail.successTitle': 'E-mail vérifié',
  'verifyEmail.successBody': 'Votre e-mail est confirmé. Vous pouvez maintenant vous connecter.',
  'verifyEmail.successCta': 'Continuer vers la connexion',
  'verifyEmail.error.token': 'Ce lien de vérification est invalide ou a expiré.',
  'verifyEmail.error.resend':
    'Impossible d’envoyer un nouvel e-mail de vérification. Veuillez réessayer.',

  // Verify OTP
  'otp.title': 'Vérification en deux étapes',
  'otp.subtitle': 'Saisissez le code à 6 chiffres de votre application d’authentification.',
  'otp.hint': 'Code de démonstration : 123456',
  'otp.submit': 'Vérifier',
  'otp.resend': 'Besoin de plus de temps ?',
  'otp.resendIn': 'Plus de temps disponible dans',
  'otp.error.invalid': 'Ce code est incorrect. Veuillez réessayer.',
  'otp.error.generic': 'Nous n’avons pas pu vérifier le code. Veuillez réessayer.',
  'otp.error.expired': 'Cette connexion a expiré. Revenez en arrière et reconnectez-vous.',
  'otp.useRecoveryCode': 'Utiliser plutôt un code de récupération',
  'otp.useAuthenticator': 'Utiliser plutôt votre application d’authentification',
  'otp.recovery.subtitle':
    'Saisissez l’un des codes de récupération enregistrés lors de l’activation de l’authentification à deux facteurs. Chaque code ne fonctionne qu’une seule fois.',
  'otp.recovery.label': 'Code de récupération',
  'otp.recovery.submit': 'Vérifier le code de récupération',
  'otp.recovery.error.invalid':
    'Ce code de récupération n’est pas valide. Vérifiez-le et réessayez.',
  'otp.recovery.error.generic':
    'Impossible de vérifier le code de récupération. Veuillez réessayer.',

  // Lock screen
  'lock.title': 'Session verrouillée',
  'lock.subtitle': 'Saisissez votre mot de passe pour reprendre où vous en étiez.',
  'lock.unlock': 'Déverrouiller',
  'lock.logout': 'Ce n’est pas vous ? Se déconnecter',
  'lock.error.invalid': 'Mot de passe incorrect. Veuillez réessayer.',
  'lock.error.twoFactor':
    'Ce compte utilise la connexion à deux facteurs, que l’écran de verrouillage ne peut pas terminer. Déconnectez-vous, puis reconnectez-vous.',
  'lock.error.generic': 'Impossible de déverrouiller votre session. Veuillez réessayer.',
  'lock.error.lockedOut':
    'Trop de tentatives incorrectes. Par sécurité, cette session a été fermée. Patientez quelques minutes, puis reconnectez-vous.',
  'lock.signInAgain': 'Se reconnecter',

  // Language switcher
  'locale.label': 'Langue',
  'locale.en': 'Anglais',
  'locale.ar': 'Arabe',
  'locale.fr': 'Français',
  'locale.fa': 'Persan',
  'locale.tr': 'Turc',

  // Shell chrome
  'shell.skipToContent': 'Aller au contenu principal',
  'shell.navigation': 'Navigation',
  'shell.toggleNavigation': 'Afficher ou masquer la navigation',
  'shell.primary': 'Principal',
  'shell.breadcrumb': 'Fil d’Ariane',
  'shell.breadcrumbExpand': 'Afficher tous les niveaux du fil d’Ariane',
  'shell.globalSearch': 'Recherche globale',
  'shell.searchResults': 'Résultats de recherche',
  'shell.searchPlaceholder': 'Rechercher…',
  'shell.searchPatientsPlaceholder': 'Rechercher un patient…',
  'shell.notifications': 'Notifications',
  'shell.dismissNotification': 'Ignorer la notification',
  'shell.unread': 'Non lu',
  'shell.more': 'Plus',
  'shell.account': 'Compte',
  'shell.profile': 'Mon profil',
  'shell.settings': 'Paramètres',
  'shell.help': 'Aide',
  'shell.signOut': 'Se déconnecter',
  'shell.theme': 'Thème',
  'shell.themeLight': 'Thème clair',
  'shell.themeDark': 'Thème sombre',
  'shell.themeSystem': 'Thème du système',
  'shell.openAssistant': 'Ouvrir Medora AI',

  // Navigation — doctor
  'nav.overview': 'Vue d’ensemble',
  'nav.patients': 'Patients',
  'nav.patientsNew': 'Ajouter un patient',
  'nav.appointments': 'Rendez-vous',
  'nav.appointmentsNew': 'Ajouter un rendez-vous',
  'nav.medicalRecords': 'Dossiers médicaux',
  'nav.medicalRecordsNew': 'Nouveau dossier médical',
  'nav.assistant': 'Medora AI',
  'nav.section.clinical': 'Clinique',
  'nav.myClinic': 'Mon cabinet',
  'nav.labs': 'Laboratoire',
  'nav.labsNew': 'Nouvelle demande',
  'nav.pharmacy': 'Pharmacie',
  'nav.pharmacyAll': 'Ordonnances',
  'nav.pharmacyNew': 'Nouvelle ordonnance',
  'nav.testCatalogue': 'Catalogue des analyses',
  'nav.section.inbox': 'Boîte de réception',
  'nav.messages': 'Messages',
  'nav.notifications': 'Notifications',
  'nav.reports': 'Rapports',

  // Navigation — administrator
  'nav.clinicOverview': 'Vue d’ensemble du cabinet',
  'nav.section.liveOperations': 'Activité en cours',
  'nav.doctors': 'Médecins',
  'nav.queue': 'File d’attente',
  'nav.waitingRoom': 'Salle d’attente',
  'nav.section.peopleAndTime': 'Personnel et horaires',
  'nav.staff': 'Personnel',
  'nav.departments': 'Services',
  'nav.shifts': 'Gardes',
  'nav.workingSchedule': 'Horaires d’ouverture',
  'nav.holidays': 'Jours fériés',
  'nav.section.facility': 'Établissement',
  'nav.rooms': 'Salles',
  'nav.resources': 'Ressources',
  'nav.section.governance': 'Gouvernance',
  'nav.communications': 'Surveillance des échanges',
  'nav.logs': 'Journaux système',
  'nav.announcements': 'Annonces',
  'nav.policies': 'Règlement du cabinet',
  'nav.templates': 'Modèles de documents',
  'nav.section.account': 'Compte',

  // Shared states
  'state.loading': 'Chargement…',
  'state.error': 'Une erreur est survenue',
  'state.errorBody': 'Nous n’avons pas pu charger ces données. Veuillez réessayer.',
  'state.retry': 'Réessayer',
  'state.empty': 'Rien à afficher',
  'state.emptyBody': 'Il n’y a encore rien ici.',
  'state.noResults': 'Aucun résultat',
  'state.noResultsBody': 'Aucun élément ne correspond aux filtres actuels.',
  'state.offline': 'Vous semblez être hors ligne.',

  // Shared controls
  'ui.search': 'Rechercher',
  'ui.clearSearch': 'Effacer la recherche',
  'ui.filters': 'Filtres',
  'ui.activeFilters': 'Filtres actifs',
  'ui.clearFilters': 'Effacer les filtres',
  'ui.export': 'Exporter',
  'ui.close': 'Fermer',
  'ui.closeDialog': 'Fermer la boîte de dialogue',
  'ui.closePanel': 'Fermer le panneau',
  'ui.dismiss': 'Ignorer le message',
  'ui.cancel': 'Annuler',
  'ui.confirm': 'Confirmer',
  'ui.save': 'Enregistrer',
  'ui.saving': 'Enregistrement…',
  'ui.edit': 'Modifier',
  'ui.delete': 'Supprimer',
  'ui.add': 'Ajouter',
  'ui.required': 'Obligatoire',
  'ui.optional': 'Facultatif',
  'ui.select': 'Sélectionner…',
  'ui.selectAllRows': 'Sélectionner toutes les lignes',
  'ui.sortBy': 'Trier par',
  'ui.pagination': 'Pagination',
  'ui.previousPage': 'Page précédente',
  'ui.nextPage': 'Page suivante',
  'ui.rowsPerPage': 'Lignes par page',
  'ui.pageOf': 'Page {page} sur {total}',
  'ui.zoomIn': 'Zoom avant',
  'ui.zoomOut': 'Zoom arrière',

  // Multi-step flows
  'flow.stepOf': 'Étape {step} sur {total}',
  'flow.complete': 'terminée',
  'flow.current': 'en cours',
  'flow.locked': 'verrouillée',

  // Form validation
  'validation.required': 'Ce champ est obligatoire',
  'validation.email': 'Saisissez une adresse e-mail valide',
  'validation.minLength': 'Doit contenir au moins {count} caractères',
  'validation.passwordMismatch': 'Les mots de passe ne correspondent pas',
  'validation.selectOne': 'Choisissez une option',

  // Administrator invitation (ADR-035 §5)
  'invitation.title': 'Accepter votre invitation',
  'invitation.subtitle': 'Choisissez un mot de passe pour votre compte administrateur Medora.',
  'invitation.mfaNotice':
    'Les comptes administrateurs exigent une authentification à deux facteurs ; vous la configurerez à l’étape suivante.',
  'invitation.submitPassword': 'Continuer',
  'invitation.mfaTitle': 'Configurer l’authentification à deux facteurs',
  'invitation.mfaSubtitle':
    'Ajoutez cette clé à votre application d’authentification, puis saisissez le code affiché.',
  'invitation.secretLabel': 'Clé de configuration',
  'invitation.secretHelp':
    'Saisissez cette clé manuellement dans votre application d’authentification.',
  'invitation.recoveryLabel': 'Codes de récupération',
  'invitation.recoveryHelp':
    'Enregistrez-les maintenant : ils ne s’affichent qu’une fois et ne peuvent pas être récupérés.',
  'invitation.codeLabel': 'Saisissez le code à 6 chiffres',
  'invitation.submitCode': 'Activer le compte',
  'invitation.successTitle': 'Votre compte est actif',
  'invitation.successBody':
    'Connectez-vous avec votre e-mail, votre nouveau mot de passe et le code de votre application.',
  'invitation.successCta': 'Aller à la connexion',
  'invitation.error.token':
    'Ce lien d’invitation n’est plus valide. Demandez-en un nouveau à un administrateur.',
  'invitation.error.code': 'Ce code n’est pas valide. Vérifiez votre application et réessayez.',
  'invitation.error.taken': 'Un compte existe déjà avec cette adresse e-mail.',
  'invitation.error.weakPassword': 'Choisissez un mot de passe plus robuste.',
  'invitation.error.generic': 'Nous n’avons pas pu finaliser votre invitation. Veuillez réessayer.',
};
