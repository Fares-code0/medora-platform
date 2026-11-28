import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AccessDeniedScreen } from '@/features/auth/screens/AccessDeniedScreen';
import { EmergencyHeaderButton } from '@/features/emergency/components/EmergencyHeaderButton';
import { EmergencyScreen } from '@/features/emergency/screens/EmergencyScreen';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { AccessDeniedStackParamList } from './routes';

const Stack = createNativeStackNavigator<AccessDeniedStackParamList>();

/**
 * The `ineligible` end of a session (C-11): a non-patient account. Its own
 * stack, like `SessionCheckStack`, so that no patient screen is mounted
 * and `Emergency` is still a route — reachable from the header and from
 * the screen itself, as from every other state of the app.
 */
export function AccessDeniedStack() {
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
        name="AccessDenied"
        component={AccessDeniedScreen}
        options={{ title: t('eligibility.navTitle') }}
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
