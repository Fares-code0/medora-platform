import { Bell, Clock, Layers } from 'lucide-react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Input, Switch } from '@/components/ui';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_META,
  useNotificationPreferences,
  type NotificationPreferences,
} from '@/features/doctor/notifications';

import { SettingsCard } from '../components/SettingsCard';
import { SettingsRow, SettingsRowList } from '../components/SettingsRow';

/**
 * Notifications section — reuses the notifications feature's per-user
 * preferences (delivery channels, quiet hours, per-category opt-ins) rather
 * than duplicating the model. Toggles apply immediately (DS §8.7 switch
 * guidance): each writes the whole document through the notifications port —
 * this browser in the demo, `/me/notification-preferences` live — and a
 * refused write puts the switch back and says so. Security alerts can't be
 * turned off, and the server refuses it too.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function NotificationsSection() {
  const { preferences, status, error, retry, update } = useNotificationPreferences();

  if (status === 'loading') {
    return (
      <div
        className="flex flex-col gap-4 rounded-surface border border-border bg-surface p-5"
        aria-busy="true"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    );
  }
  if (status === 'error' || preferences === undefined) {
    return (
      <ErrorState
        title="Couldn't load your notification preferences"
        error={error}
        onRetry={retry}
      />
    );
  }
  return <NotificationPreferencesForm preferences={preferences} update={update} />;
}

function NotificationPreferencesForm({
  preferences,
  update,
}: {
  preferences: NotificationPreferences;
  update: ReturnType<typeof useNotificationPreferences>['update'];
}) {
  const bindQuietTime = (key: 'from' | 'to') => ({
    value: preferences.quietHours[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      if (!TIME_PATTERN.test(raw)) return;
      update((previous) => ({
        ...previous,
        quietHours: { ...previous.quietHours, [key]: raw },
      }));
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="Delivery channels"
        description="Where Medora reaches you. Changes apply immediately."
        icon={Bell}
      >
        <SettingsRowList>
          {NOTIFICATION_CHANNELS.map((channel) => (
            <SettingsRow
              key={channel}
              title={NOTIFICATION_CHANNEL_META[channel].label}
              description={NOTIFICATION_CHANNEL_META[channel].description}
              control={
                <Switch
                  aria-label={NOTIFICATION_CHANNEL_META[channel].label}
                  checked={preferences.channels[channel]}
                  onCheckedChange={(checked) =>
                    update((previous) => ({
                      ...previous,
                      channels: { ...previous.channels, [channel]: checked },
                    }))
                  }
                />
              }
            />
          ))}
        </SettingsRowList>
      </SettingsCard>

      <SettingsCard
        title="Quiet hours"
        description="Hold non-critical notifications during this window."
        icon={Clock}
      >
        <div className="flex flex-col gap-4">
          <SettingsRow
            title="Enable quiet hours"
            description="Critical patient and security alerts always come through."
            control={
              <Switch
                aria-label="Enable quiet hours"
                checked={preferences.quietHours.enabled}
                onCheckedChange={(checked) =>
                  update((previous) => ({
                    ...previous,
                    quietHours: { ...previous.quietHours, enabled: checked },
                  }))
                }
              />
            }
          />
          <div className="grid max-w-xs grid-cols-2 gap-3">
            <Input
              type="time"
              label="From"
              disabled={!preferences.quietHours.enabled}
              {...bindQuietTime('from')}
            />
            <Input
              type="time"
              label="To"
              disabled={!preferences.quietHours.enabled}
              {...bindQuietTime('to')}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Alert categories"
        description="Choose which kinds of alerts you receive."
        icon={Layers}
      >
        <SettingsRowList>
          {NOTIFICATION_CATEGORIES.map((category) => (
            <SettingsRow
              key={category}
              title={NOTIFICATION_CATEGORY_META[category].label}
              description={category === 'security' ? 'Always on for account safety.' : undefined}
              control={
                <Switch
                  aria-label={NOTIFICATION_CATEGORY_META[category].label}
                  checked={preferences.categories[category]}
                  disabled={category === 'security'}
                  onCheckedChange={(checked) =>
                    update((previous) => ({
                      ...previous,
                      categories: { ...previous.categories, [category]: checked },
                    }))
                  }
                />
              }
            />
          ))}
        </SettingsRowList>
      </SettingsCard>
    </div>
  );
}
