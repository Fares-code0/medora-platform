import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SessionUnconfirmedScreen } from '@/features/auth/screens/SessionUnconfirmedScreen';
import { EmergencyHeaderButton } from '@/features/emergency/components/EmergencyHeaderButton';
import { EmergencyScreen } from '@/features/emergency/screens/EmergencyScreen';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { SessionCheckStackParamList } from './routes';

const Stack = createNativeStackNavigator<SessionCheckStackParamList>();

/**
 * The stack for the `unconfirmed` session state.
 *
 * A stack rather than a bare screen for one reason: Emergency has to be a
 * route here, reached from the same `EmergencyHeaderButton` the other two
 * stacks mount. The patient in this state is one with no signal — exactly
 * the patient for whom bundled emergency guidance is the point
 * (ARCHITECTURE §5, "must render with no network and no session").
 *
 * The options mirror `AuthStack`'s so the two read as one app.
 */
export function SessionCheckStack() {
  const theme = useTheme();
  const t = useT();

  return (
    <Stack.Navigator
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
        name="SessionCheck"
        component={SessionUnconfirmedScreen}
        options={{ title: t('nav.title.sessionCheck') }}
      />
      <Stack.Screen
        name="Emergency"
        component={EmergencyScreen}
        options={{
          title: 'Emergency',
          headerTintColor: theme.colors.error,
          // No affordance pointing at the screen it is already on.
          headerRight: () => null,
        }}
      />
    </Stack.Navigator>
  );
}
