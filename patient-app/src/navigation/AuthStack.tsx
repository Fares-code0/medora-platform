import { useState } from 'react';

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ConsentScreen } from '@/features/auth/screens/ConsentScreen';
import { ForgotPasswordScreen } from '@/features/auth/screens/ForgotPasswordScreen';
import { LoginScreen } from '@/features/auth/screens/LoginScreen';
import { OtpScreen } from '@/features/auth/screens/OtpScreen';
import { RegisterScreen } from '@/features/auth/screens/RegisterScreen';
import { ResetPasswordScreen } from '@/features/auth/screens/ResetPasswordScreen';
import { VerifyEmailScreen } from '@/features/auth/screens/VerifyEmailScreen';
import { WelcomeScreen } from '@/features/auth/screens/WelcomeScreen';
import { EmergencyHeaderButton } from '@/features/emergency/components/EmergencyHeaderButton';
import { EmergencyScreen } from '@/features/emergency/screens/EmergencyScreen';
import { OnboardingScreen } from '@/features/onboarding/screens/OnboardingScreen';
import { hasSeenOnboarding } from '@/features/onboarding/seen';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { AuthStackParamList } from './routes';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * The signed-out stack.
 *
 * **Emergency is a route here**, and that is the single most important
 * line in this file (audit §13, checklist N-01, U-03). A person in crisis
 * whose token expired, or who never made an account, still reaches
 * emergency guidance. Any refactor that moves Emergency behind the
 * authentication gate breaks the guarantee the whole feature exists for —
 * `navigation.test.tsx` fails if it does.
 *
 * **Onboarding is the initial route on a first launch only** (E-02), and
 * it is a route in THIS stack rather than a gate above it. Both halves
 * matter: a gate would have put a carousel between a person in crisis and
 * the emergency guidance, whereas a sibling route leaves `Emergency`
 * reachable — and the carousel carries a button to it on every slide.
 *
 * The flag is read once, when the navigator mounts, rather than
 * subscribed to. Re-reading it would re-run this decision mid-session and
 * could send a patient back to the carousel they just finished.
 *
 * ── The header affordance, and the gap it closed (N-12) ─────────────
 *
 * `headerRight` mounts the same `EmergencyHeaderButton` the signed-in
 * shell puts on every stack screen. Until 2026-09-14 this navigator set
 * none, so "Emergency is one tap from anywhere" was true on one side of
 * the authentication gate and not the other: Welcome, Login and the
 * onboarding carousel carried their own buttons, and `Register`, `Otp`,
 * `VerifyEmail`, `ForgotPassword`, `ResetPassword` and `Consent`
 * carried nothing. Those are the screens a patient waits on — for a code
 * that may not arrive, for an email that may take minutes — so they are
 * exactly the wrong ones to make somebody navigate back out of.
 *
 * Two screens override it. `Emergency` itself, where the control would
 * point at the screen already open, and the two headerless ones, which
 * have no header to put it in and their own buttons instead.
 */
export function AuthStack() {
  const theme = useTheme();
  const t = useT();
  const [initialRoute] = useState<keyof AuthStackParamList>(() =>
    hasSeenOnboarding() ? 'Welcome' : 'Onboarding',
  );

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { color: theme.colors.textPrimary },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        headerRight: () => <EmergencyHeaderButton />,
      }}
    >
      <Stack.Screen
        name="Onboarding"
        component={OnboardingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ title: t('nav.title.signIn') }}
      />
      <Stack.Screen name="Otp" component={OtpScreen} options={{ title: t('nav.title.verify') }} />
      <Stack.Screen
        name="Register"
        component={RegisterScreen}
        options={{ title: t('nav.title.createAccount') }}
      />
      <Stack.Screen
        name="VerifyEmail"
        component={VerifyEmailScreen}
        options={{ title: t('nav.title.confirmEmail') }}
      />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ title: t('nav.title.resetPassword') }}
      />
      <Stack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen}
        options={{ title: t('nav.title.newPassword') }}
      />
      <Stack.Screen
        name="Consent"
        component={ConsentScreen}
        options={{ title: t('nav.title.consent') }}
      />
      <Stack.Screen
        name="Emergency"
        component={EmergencyScreen}
        options={{
          title: t('emergency.short'),
          headerTintColor: theme.colors.error,
          // No affordance pointing at the screen it is already on.
          headerRight: () => null,
        }}
      />
    </Stack.Navigator>
  );
}
