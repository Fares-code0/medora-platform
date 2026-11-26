import { useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Avatar,
  Badge,
  Card,
  ConfirmSheet,
  Divider,
  ListItem,
  Screen,
  Section,
  Text,
} from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useSession } from '@/features/auth/SessionProvider';
import { LinkRecordBanner } from '@/features/patient-link/components/LinkRecordBanner';
import { usePatientLink } from '@/features/patient-link/hooks';
import { useT } from '@/i18n';
import type { ProfileStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { profileKeys } from '../keys';
import { profileService } from '../service';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileRoot'>;

/**
 * The profile tab.
 *
 * It is also the entry point to health records — records live under
 * Profile rather than as a sixth tab (audit §13), so this screen carries
 * their most prominent link.
 *
 * Logout confirms first (checklist P-08, R-06). It is not destructive in
 * the "loses your data" sense, but it is in the "you are now locked out
 * of your appointment details on a bus" sense, and a mis-tap on a list
 * row should not do it.
 */
export function ProfileScreen({ navigation }: Props) {
  const theme = useTheme();
  const t = useT();
  const { logout } = useSession();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const profile = useQuery({ queryKey: profileKeys.all, queryFn: () => profileService.get() });
  // ADR-048: the linked record's name, from the link state rather than the
  // profile, and only once the server says the account is linked.
  const link = usePatientLink();
  const linkedName =
    link.data?.linked === true && link.data.patient !== null ? link.data.patient.fullName : null;

  return (
    <Screen testID="profile-screen">
      <AsyncBoundary query={profile} testID="profile-header" loading={<SkeletonCard />}>
        {(data) => (
          <View style={[styles.header, { rowGap: theme.space[2] }]}>
            <Avatar name={data.displayName} photoUrl={data.photoUrl} size={80} />
            <Text variant="h1" align="center" {...headingA11y(data.displayName)}>
              {data.displayName}
            </Text>
            {data.linkedToClinicalRecord ? (
              <Badge label={t('profile.linked')} tone="success" icon="checkCircle" />
            ) : (
              <Badge label={t('profile.notLinked')} tone="warning" icon="alert" />
            )}
            {linkedName === null ? null : (
              <Text
                variant="bodySm"
                color="textSecondary"
                align="center"
                testID="profile-linked-record"
              >
                {t('link.profile.linkedAs', { name: linkedName })}
              </Text>
            )}
          </View>
        )}
      </AsyncBoundary>

      <LinkRecordBanner onLink={() => navigation.navigate('LinkRecord')} />

      <Section title={t('profile.section.health')}>
        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.space[4] }}>
            <ListItem
              title={t('profile.healthRecords')}
              subtitle={t('profile.healthRecords.subtitle')}
              icon="heart"
              testID="profile-to-records"
              onPress={() => navigation.navigate('HealthRecords')}
            />
            <Divider />
            <ListItem
              title={t('profile.labResults')}
              icon="lab"
              testID="profile-to-labs"
              onPress={() => navigation.navigate('LabResults')}
            />
            <Divider />
            <ListItem
              title={t('profile.prescriptions')}
              icon="pill"
              onPress={() => navigation.navigate('Prescriptions')}
            />
            <Divider />
            <ListItem
              title={t('profile.documents')}
              icon="folder"
              onPress={() => navigation.navigate('Documents')}
            />
          </View>
        </Card>
      </Section>

      <Section title={t('profile.section.account')}>
        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.space[4] }}>
            <ListItem
              title={t('profile.personalDetails')}
              icon="user"
              testID="profile-to-edit"
              onPress={() => navigation.navigate('EditProfile')}
            />
            <Divider />
            <ListItem
              title={t('profile.notifications')}
              icon="bell"
              testID="profile-to-notifications"
              onPress={() => navigation.navigate('Notifications')}
            />
            <Divider />
            <ListItem
              title={t('notificationPrefs.entry')}
              subtitle={t('notificationPrefs.entry.subtitle')}
              icon="settings"
              testID="profile-to-notification-prefs"
              onPress={() => navigation.navigate('NotificationPrefs')}
            />
            <Divider />
            <ListItem
              title={t('profile.appearance')}
              icon="moon"
              testID="profile-to-preferences"
              onPress={() => navigation.navigate('Preferences')}
            />
            <Divider />
            <ListItem
              title={t('profile.privacy')}
              subtitle={t('profile.privacy.subtitle')}
              icon="shield"
              testID="profile-to-privacy"
              onPress={() => navigation.navigate('Privacy')}
            />
            <Divider />
            <ListItem
              title={t('profile.security')}
              icon="lock"
              testID="profile-to-security"
              onPress={() => navigation.navigate('Security')}
            />
            <ListItem
              title={t('profile.help')}
              icon="info"
              testID="profile-to-support"
              onPress={() => navigation.navigate('Support')}
            />
            <Divider />
            {/*
              Reachable AFTER agreeing, not only before it (E-05). People
              tick a box in a hurry and want to check later, and a
              consent you can only read at the moment you give it is one
              nobody reads.
            */}
            <ListItem
              title={t('profile.consent')}
              icon="fileText"
              testID="profile-to-consent"
              onPress={() => navigation.navigate('Consent')}
            />
          </View>
        </Card>
      </Section>

      <Card padded={false}>
        <View style={{ paddingHorizontal: theme.space[4] }}>
          <ListItem
            title={t('profile.signOut')}
            icon="logOut"
            destructive
            testID="profile-logout"
            onPress={() => setConfirmLogout(true)}
          />
        </View>
      </Card>

      <ConfirmSheet
        visible={confirmLogout}
        testID="profile-logout-confirm"
        title={t('profile.signOut.confirmTitle')}
        detail={t('profile.signOut.confirmDetail')}
        confirmLabel={t('profile.signOut')}
        tone="destructive"
        onConfirm={() => {
          setConfirmLogout(false);
          void logout();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center' },
});
