/**
 * **Promoted to `src/i18n/LocaleSwitcher` (F-19).** The control is no longer
 * auth's — Settings → Appearance and the login screen mount the same one.
 * Re-exported under the old name so auth's imports are unchanged.
 */
export { LocaleSwitcher as LanguageSelector, type LocaleSwitcherProps as LanguageSelectorProps } from '@/i18n';
