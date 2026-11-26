import Feather from '@expo/vector-icons/Feather';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { OfflineBanner } from '@/components';
import { AiChatScreen } from '@/features/ai/screens/AiChatScreen';
import { AiHomeScreen } from '@/features/ai/screens/AiHomeScreen';
import { AiImageScreen } from '@/features/ai/screens/AiImageScreen';
import { AiSymptomsScreen } from '@/features/ai/screens/AiSymptomsScreen';
import { DeprecationBanner } from '@/features/app-version/DeprecationBanner';
import { AppointmentDetailScreen } from '@/features/appointments/screens/AppointmentDetailScreen';
import { AppointmentsScreen } from '@/features/appointments/screens/AppointmentsScreen';
import { RescheduleRequestScreen } from '@/features/appointments/screens/RescheduleRequestScreen';
import { ConsentScreen } from '@/features/auth/screens/ConsentScreen';
import { ClinicScreen } from '@/features/clinic/screens/ClinicScreen';
import { DepartmentScreen } from '@/features/clinic/screens/DepartmentScreen';
import { DiscoverScreen } from '@/features/doctors/screens/DiscoverScreen';
import { DoctorProfileScreen } from '@/features/doctors/screens/DoctorProfileScreen';
import { EmergencyHeaderButton } from '@/features/emergency/components/EmergencyHeaderButton';
import { DocumentsScreen } from '@/features/health/screens/DocumentsScreen';
import { HealthRecordsScreen } from '@/features/health/screens/HealthRecordsScreen';
import { LabResultsScreen } from '@/features/health/screens/LabResultsScreen';
import { PrescriptionsScreen } from '@/features/health/screens/PrescriptionsScreen';
import { VisitDetailScreen } from '@/features/health/screens/VisitDetailScreen';
import { VisitsScreen } from '@/features/health/screens/VisitsScreen';
import { HomeScreen } from '@/features/home/screens/HomeScreen';
import { HospitalDetailScreen } from '@/features/hospitals/screens/HospitalDetailScreen';
import { HospitalsScreen } from '@/features/hospitals/screens/HospitalsScreen';
import { MessagesScreen } from '@/features/messages/screens/MessagesScreen';
import { ThreadScreen } from '@/features/messages/screens/ThreadScreen';
import { NotificationPrefsScreen } from '@/features/notifications/screens/NotificationPrefsScreen';
import { NotificationsScreen } from '@/features/notifications/screens/NotificationsScreen';
import { formatUnreadBadge, unreadTabAnnouncement } from '@/features/notifications/unread';
import { useUnreadCount } from '@/features/notifications/useUnreadCount';
import { LinkRecordScreen } from '@/features/patient-link/screens/LinkRecordScreen';
import { EditProfileScreen } from '@/features/profile/screens/EditProfileScreen';
import { PreferencesScreen } from '@/features/profile/screens/PreferencesScreen';
import { PrivacyScreen } from '@/features/profile/screens/PrivacyScreen';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';
import { SecurityScreen } from '@/features/profile/screens/SecurityScreen';
import { SupportScreen } from '@/features/support/screens/SupportScreen';
import { useT, type TranslateFn } from '@/i18n';
import { useTheme, type Theme } from '@/theme';

import type {
  AppointmentsStackParamList,
  AppTabsParamList,
  DiscoverStackParamList,
  HomeStackParamList,
  MessagesStackParamList,
  ProfileStackParamList,
} from './routes';

/**
 * The signed-in shell: five tabs, each a stack.
 *
 * ── The persistent Emergency affordance ─────────────────────────────
 * `EmergencyHeaderButton` is in the header of every authenticated stack
 * (audit §13, checklist N-01), and since N-12 in every signed-out one
 * too — it moved to `features/emergency/components/` so `AuthStack` can
 * mount the same control rather than a second copy of it. That file
 * carries why it is labelled, why it is error-toned, and why its words
 * are not in the message catalogue.
 *
 * ── Records are not a tab ────────────────────────────────────────────
 * They live in the Profile stack. Five tabs is the platform maximum
 * before labels truncate at 375pt, and records are a reference surface
 * rather than a daily destination (audit §13).
 */

function stackOptions(theme: Theme) {
  return {
    headerStyle: { backgroundColor: theme.colors.background },
    headerTintColor: theme.colors.textPrimary,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: theme.colors.background },
    headerRight: () => <EmergencyHeaderButton />,
  };
}

const HomeStack = createNativeStackNavigator<HomeStackParamList>();
function HomeNavigator() {
  const theme = useTheme();
  const t = useT();
  return (
    <HomeStack.Navigator screenOptions={stackOptions(theme)}>
      {/* "Medora" is a name; a name is not translated. */}
      <HomeStack.Screen name="HomeRoot" component={HomeScreen} options={{ title: 'Medora' }} />
      {/*
        The assistant lives here rather than in a sixth tab — five is the
        platform maximum before labels truncate at 375pt, and a surface
        that is not connected to anything must not displace one that is.
        `features/ai/availability.ts` is why every one of these renders an
        unavailable state.
      */}
      <HomeStack.Screen
        name="AiHome"
        component={AiHomeScreen}
        options={{ title: t('nav.title.assistant') }}
      />
      <HomeStack.Screen
        name="AiChat"
        component={AiChatScreen}
        options={{ title: t('nav.title.assistantChat') }}
      />
      <HomeStack.Screen
        name="AiSymptoms"
        component={AiSymptomsScreen}
        options={{ title: t('nav.title.assistantSymptoms') }}
      />
      <HomeStack.Screen
        name="AiImage"
        component={AiImageScreen}
        options={{ title: t('nav.title.assistantImage') }}
      />
    </HomeStack.Navigator>
  );
}

const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
function DiscoverNavigator() {
  const theme = useTheme();
  const t = useT();
  return (
    <DiscoverStack.Navigator screenOptions={stackOptions(theme)}>
      <DiscoverStack.Screen
        name="DiscoverRoot"
        component={DiscoverScreen}
        options={{ title: t('nav.title.discover') }}
      />
      <DiscoverStack.Screen
        name="DoctorProfile"
        component={DoctorProfileScreen}
        options={{ title: t('nav.title.doctor') }}
      />
      <DiscoverStack.Screen
        name="Hospitals"
        component={HospitalsScreen}
        options={{ title: t('nav.title.hospitals') }}
      />
      <DiscoverStack.Screen
        name="Hospital"
        component={HospitalDetailScreen}
        options={({ route }) => ({ title: route.params.hospitalName ?? t('nav.title.hospital') })}
      />
      <DiscoverStack.Screen
        name="Clinic"
        component={ClinicScreen}
        options={{ title: t('nav.title.clinic') }}
      />
      {/*
        The header title is the department's own name, which arrived in
        the route params — a fixed "Department" above a screen whose H1
        already says "Cardiology" wastes the one line a back-stack gives
        a patient to know where they are.
      */}
      <DiscoverStack.Screen
        name="Department"
        component={DepartmentScreen}
        options={({ route }) => ({ title: route.params.departmentName })}
      />
    </DiscoverStack.Navigator>
  );
}

const AppointmentsStack = createNativeStackNavigator<AppointmentsStackParamList>();
function AppointmentsNavigator() {
  const theme = useTheme();
  const t = useT();
  return (
    <AppointmentsStack.Navigator screenOptions={stackOptions(theme)}>
      <AppointmentsStack.Screen
        name="AppointmentsRoot"
        component={AppointmentsScreen}
        options={{ title: t('nav.title.appointments') }}
      />
      <AppointmentsStack.Screen
        name="AppointmentDetail"
        component={AppointmentDetailScreen}
        options={{ title: t('nav.title.appointment') }}
      />
      <AppointmentsStack.Screen
        name="RescheduleRequest"
        component={RescheduleRequestScreen}
        options={{ title: t('nav.title.rescheduleRequest') }}
      />
    </AppointmentsStack.Navigator>
  );
}

const MessagesStack = createNativeStackNavigator<MessagesStackParamList>();
function MessagesNavigator() {
  const theme = useTheme();
  const t = useT();
  return (
    <MessagesStack.Navigator screenOptions={stackOptions(theme)}>
      <MessagesStack.Screen
        name="MessagesRoot"
        component={MessagesScreen}
        options={{ title: t('nav.title.messages') }}
      />
      <MessagesStack.Screen
        name="Thread"
        component={ThreadScreen}
        options={{ title: t('nav.title.conversation') }}
      />
    </MessagesStack.Navigator>
  );
}

const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
function ProfileNavigator() {
  const theme = useTheme();
  const t = useT();
  return (
    <ProfileStack.Navigator screenOptions={stackOptions(theme)}>
      <ProfileStack.Screen
        name="ProfileRoot"
        component={ProfileScreen}
        options={{ title: t('nav.title.profile') }}
      />
      <ProfileStack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{ title: t('nav.title.yourDetails') }}
      />
      <ProfileStack.Screen
        name="HealthRecords"
        component={HealthRecordsScreen}
        options={{ title: t('nav.title.healthRecords') }}
      />
      <ProfileStack.Screen
        name="LabResults"
        component={LabResultsScreen}
        options={{ title: t('nav.title.labResults') }}
      />
      <ProfileStack.Screen
        name="Prescriptions"
        component={PrescriptionsScreen}
        options={{ title: t('nav.title.prescriptions') }}
      />
      <ProfileStack.Screen
        name="Documents"
        component={DocumentsScreen}
        options={{ title: t('nav.title.documents') }}
      />
      <ProfileStack.Screen
        name="Visits"
        component={VisitsScreen}
        options={{ title: t('nav.title.visits') }}
      />
      <ProfileStack.Screen
        name="VisitDetail"
        component={VisitDetailScreen}
        options={{ title: t('nav.title.visit') }}
      />
      <ProfileStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: t('nav.title.notifications') }}
      />
      <ProfileStack.Screen
        name="NotificationPrefs"
        component={NotificationPrefsScreen}
        options={{ title: t('nav.title.notificationPrefs') }}
      />
      <ProfileStack.Screen
        name="Preferences"
        component={PreferencesScreen}
        options={{ title: t('nav.title.appearance') }}
      />
      <ProfileStack.Screen
        name="Privacy"
        component={PrivacyScreen}
        options={{ title: t('nav.title.privacy') }}
      />
      <ProfileStack.Screen
        name="Security"
        component={SecurityScreen}
        options={{ title: t('nav.title.security') }}
      />
      <ProfileStack.Screen
        name="Consent"
        component={ConsentScreen}
        options={{ title: t('nav.title.consent') }}
      />
      <ProfileStack.Screen
        name="Support"
        component={SupportScreen}
        options={{ title: t('nav.title.help') }}
      />
      <ProfileStack.Screen
        name="LinkRecord"
        component={LinkRecordScreen}
        options={{ title: t('link.title') }}
      />
    </ProfileStack.Navigator>
  );
}

const Tabs = createBottomTabNavigator<AppTabsParamList>();

export function AppTabs() {
  const theme = useTheme();
  const t = useT();

  // The badge sits on Profile because the notification centre does
  // (`ProfileStack`, below). Records are not a tab and neither are
  // notifications; putting the badge on a tab the patient cannot reach
  // the feed from would be an indicator with no destination.
  //
  // Messages has no badge. M-04 is the row that would give it one and it
  // is blocked on BE-13 — an unread count this client cannot obtain is
  // not a badge to invent (F-07 says the same about push).
  const { count: unread } = useUnreadCount();
  const unreadBadge = formatUnreadBadge(unread);

  return (
    <View style={styles.fill}>
      <OfflineBanner />
      {/* Advisory, so it sits with the offline banner rather than
          gating anything — W-06's `UpgradeGate` is the gate (W-07). */}
      <DeprecationBanner />
      <Tabs.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textTertiary,
          tabBarStyle: {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.border,
          },
          // Labels always visible: an icon-only tab bar is a memory test,
          // and it is the first thing to fail for a screen-reader user.
          tabBarShowLabel: true,
        }}
      >
        <Tabs.Screen
          name="HomeTab"
          component={HomeNavigator}
          options={{
            title: t('nav.tab.home'),
            tabBarIcon: ({ color, size }) => <TabIcon name="home" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="DiscoverTab"
          component={DiscoverNavigator}
          options={{
            title: t('nav.tab.discover'),
            tabBarIcon: ({ color, size }) => <TabIcon name="search" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="AppointmentsTab"
          component={AppointmentsNavigator}
          options={{
            title: t('nav.tab.appointments'),
            tabBarIcon: ({ color, size }) => <TabIcon name="calendar" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="MessagesTab"
          component={MessagesNavigator}
          options={{
            title: t('nav.tab.messages'),
            tabBarIcon: ({ color, size }) => <TabIcon name="message" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="ProfileTab"
          component={ProfileNavigator}
          options={{
            title: t('nav.tab.profile'),
            tabBarIcon: ({ color, size }) => <TabIcon name="user" color={color} size={size} />,
            // `?? undefined` rather than the `null` `formatUnreadBadge`
            // returns: React Navigation hides the badge for `undefined`
            // and renders an empty dot for `null`.
            tabBarBadge: unreadBadge ?? undefined,
            // `Badge`'s subtle-background pairing is for a badge inside
            // a themed surface; a tab-bar badge is a solid dot on the
            // tab bar's own colour, so it takes the full-strength tone
            // and `textInverse`, which inverts with the palette (white
            // on #c0271f in light, near-black on #f0908a in dark).
            tabBarBadgeStyle: {
              backgroundColor: theme.colors.error,
              color: theme.colors.textInverse,
            },
            // `tabBarBadge` is not announced by either screen reader, so
            // the count has to reach the label or it does not exist for
            // a VoiceOver user (S-02).
            tabBarAccessibilityLabel: unreadTabLabel(t, unread),
          }}
        />
      </Tabs.Navigator>
    </View>
  );
}

/**
 * The tab bar supplies a raw colour string (active/inactive tint), so
 * this is the one icon in the app that does not take a theme token. The
 * colour still comes FROM the theme — `screenOptions` sets both tints
 * from `theme.colors` — it just arrives through React Navigation.
 */
const TAB_GLYPHS = {
  home: 'home',
  search: 'search',
  calendar: 'calendar',
  message: 'message-circle',
  user: 'user',
} as const;

function TabIcon({
  name,
  color,
  size,
}: {
  name: keyof typeof TAB_GLYPHS;
  color: string;
  size: number;
}) {
  return <Feather name={TAB_GLYPHS[name]} size={size} color={color} />;
}

/**
 * "Profile", or "Profile, 3 unread notifications".
 *
 * `unreadTabAnnouncement` owns the rule — what counts, and the one/many
 * split — and the catalogue owns the sentence, so the label is correct in
 * both languages without either half knowing about the other.
 */
function unreadTabLabel(t: TranslateFn, count: number | undefined): string {
  const tab = t('nav.tab.profile');
  const announcement = unreadTabAnnouncement(count);
  if (announcement === null) return tab;
  return announcement.count === 1
    ? t('nav.tab.unreadOne', { tab })
    : t('nav.tab.unreadMany', { tab, count: announcement.count });
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerButton: { alignItems: 'center', flexDirection: 'row' },
});
