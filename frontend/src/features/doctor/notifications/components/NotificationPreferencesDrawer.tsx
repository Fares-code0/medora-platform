import { ErrorState, Skeleton } from '@/components/feedback';
import { Section, Stack } from '@/components/layout';
import { Button, Drawer, Input, Switch } from '@/components/ui';

import { useNotificationPreferences } from '../hooks/useNotificationPreferences';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_META,
  type NotificationPreferences,
} from '../model/types';

/**
 * Notification preferences — delivery channels, quiet hours, and
 * per-category opt-ins, read and written through the notifications port
 * (`useNotificationPreferences`): per user in the demo, on the server live.
 * Fetched only while the drawer is open. Security notifications cannot be
 * disabled — the server refuses it too.
 */

export interface NotificationPreferencesDrawerProps {
  open: boolean;
  onClose: () => void;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function NotificationPreferencesDrawer({
  open,
  onClose,
}: NotificationPreferencesDrawerProps) {
  const {
    preferences,
    status,
    error,
    retry,
    update: onUpdate,
    reset: onReset,
  } = useNotificationPreferences({ enabled: open });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Notification preferences"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onReset} disabled={preferences === undefined}>
            Reset to defaults
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {status === 'loading' ? (
        <Stack gap={4} aria-busy="true">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </Stack>
      ) : status === 'error' || preferences === undefined ? (
        <ErrorState
          title="Couldn't load your notification preferences"
          error={error}
          onRetry={retry}
        />
      ) : (
        <PreferencesForm preferences={preferences} onUpdate={onUpdate} />
      )}
    </Drawer>
  );
}

type PreferencesApi = ReturnType<typeof useNotificationPreferences>;

function PreferencesForm({
  preferences,
  onUpdate,
}: {
  preferences: NotificationPreferences;
  onUpdate: PreferencesApi['update'];
}) {
  const bindQuietTime = (key: 'from' | 'to') => ({
    value: preferences.quietHours[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      if (!TIME_PATTERN.test(raw)) return;
      onUpdate((previous) => ({
        ...previous,
        quietHours: { ...previous.quietHours, [key]: raw },
      }));
    },
  });

  return (
    <Stack gap={8}>
      <Section title="Delivery channels" headingAs="h3">
        <Stack gap={4}>
          {NOTIFICATION_CHANNELS.map((channel) => (
            <Switch
              key={channel}
              label={NOTIFICATION_CHANNEL_META[channel].label}
              description={NOTIFICATION_CHANNEL_META[channel].description}
              checked={preferences.channels[channel]}
              onCheckedChange={(checked) =>
                onUpdate((previous) => ({
                  ...previous,
                  channels: { ...previous.channels, [channel]: checked },
                }))
              }
            />
          ))}
        </Stack>
      </Section>

      <Section
        title="Quiet hours"
        caption="Non-critical notifications are held during this window."
        headingAs="h3"
      >
        <Stack gap={4}>
          <Switch
            label="Enable quiet hours"
            checked={preferences.quietHours.enabled}
            onCheckedChange={(checked) =>
              onUpdate((previous) => ({
                ...previous,
                quietHours: { ...previous.quietHours, enabled: checked },
              }))
            }
          />
          <div className="grid grid-cols-2 gap-3">
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
        </Stack>
      </Section>

      <Section title="Categories" caption="Security alerts are always delivered." headingAs="h3">
        <Stack gap={4}>
          {NOTIFICATION_CATEGORIES.map((category) => (
            <Switch
              key={category}
              label={NOTIFICATION_CATEGORY_META[category].label}
              checked={preferences.categories[category]}
              disabled={category === 'security'}
              onCheckedChange={(checked) =>
                onUpdate((previous) => ({
                  ...previous,
                  categories: { ...previous.categories, [category]: checked },
                }))
              }
            />
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}
