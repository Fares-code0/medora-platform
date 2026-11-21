import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BookingFlow } from '@/features/appointments/booking/BookingFlow';
import { useSession } from '@/features/auth/SessionProvider';
import { EmergencyScreen } from '@/features/emergency/screens/EmergencyScreen';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { AppTabs } from './AppTabs';
import { AuthStack } from './AuthStack';
import type { RootStackParamList } from './routes';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * `onBook` is passed HERE and deliberately not in `AuthStack`.
 *
 * The screen's "when to call, and when to book instead" section
 * has always ended with an offer to book, and the button that
 * would do it was never rendered: nothing passed the prop, so a
 * patient read the advice with no way to act on it. A signed-in
 * patient can book, so the modal over the tabs supplies the
 * route; a signed-out one cannot, so the signed-out copy of this
 * screen still offers nothing and says nothing it cannot do.
 *
 * That asymmetry is the reason the prop is optional rather than
 * the screen reaching for `useNavigation()` itself: Emergency
 * renders on both sides of the authentication gate, and a screen
 * that navigated to Booking from the signed-out stack would be
 * navigating to a route that is not there.
 */
function EmergencyModal({ navigation }: NativeStackScreenProps<RootStackParamList, 'Emergency'>) {
  return <EmergencyScreen onBook={() => navigation.navigate('Booking', {})} />;
}

/**
 * The gate.
 *
 * Three branches, and the first one matters more than it looks:
 *
 * - **booting** — a splash while the refresh token is exchanged. Without
 *   it, every cold start flashes the login screen for the ~300ms the
 *   keychain read and the refresh take, and a patient who is signed in
 *   sees a sign-in form (checklist D-05).
 * - **unauthenticated** — `AuthStack`, which contains Emergency.
 * - **authenticated** — `AppTabs`, plus Emergency and Booking as modals.
 *
 * `Emergency` is registered in BOTH stacks on purpose. It is not a
 * duplicate to be refactored away: the whole point is that it is
 * reachable on either side of the authentication gate (audit §13).
 */
export function RootNavigator() {
  const theme = useTheme();
  const t = useT();
  const { state } = useSession();

  if (state.status === 'booting') {
    return (
      <View
        testID="root-booting"
        accessibilityLabel={t('app.booting')}
        style={[styles.splash, { backgroundColor: theme.colors.background }]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (state.status === 'unauthenticated') {
    return <AuthStack />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="Tabs" component={AppTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="Emergency"
        component={EmergencyModal}
        options={{
          presentation: 'modal',
          title: 'Emergency',
          headerTintColor: theme.colors.error,
        }}
      />
      <Stack.Screen
        name="Booking"
        component={BookingFlow}
        options={{
          // Full-screen, so no tab bar competes for the thumb during a
          // five-step task (audit §13).
          presentation: 'fullScreenModal',
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  splash: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
