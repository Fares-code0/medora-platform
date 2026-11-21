import type { ReactNode } from 'react';

import { LocaleProvider } from '@/i18n';

import { AuthProvider } from './AuthProvider';
import { DoctorProfileProvider } from './DoctorProfileProvider';
import { InterfaceSettingsProvider } from './InterfaceSettingsProvider';
import { MotionProvider } from './MotionProvider';
import { QueryProvider } from './QueryProvider';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from './ToastProvider';

/**
 * Provider composition root — FRONTEND_ARCHITECTURE.md §2 (app/providers).
 * Order matters: Locale + Theme + InterfaceSettings (no deps, needed before
 * auth for the login surface and before Motion reads reduce-motion) → Query →
 * Auth (uses Query on logout) → Motion → Toast (innermost so any provider can
 * toast in future phases).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <InterfaceSettingsProvider>
          <QueryProvider>
            <AuthProvider>
              <DoctorProfileProvider>
                <MotionProvider>
                  <ToastProvider>{children}</ToastProvider>
                </MotionProvider>
              </DoctorProfileProvider>
            </AuthProvider>
          </QueryProvider>
        </InterfaceSettingsProvider>
      </ThemeProvider>
    </LocaleProvider>
  );
}

export { useAuth, useCan } from './AuthProvider';
export {
  DEFAULT_DOCTOR_PROFILE,
  useDoctorProfile,
  type DoctorProfile,
} from './DoctorProfileProvider';
export { useInterfaceSettings } from './InterfaceSettingsProvider';
export { useLocale } from '@/i18n';
export { useTheme } from './ThemeProvider';
export { useToast } from './ToastProvider';
