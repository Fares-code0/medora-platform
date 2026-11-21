import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, Icon, Text } from '@/components';
import type { IconName } from '@/components/Icon';
import { useT, type MessageKey } from '@/i18n';
import { useTheme } from '@/theme';

/**
 * The safety framing, in full — the part K-03's banner cannot carry.
 *
 * The banner above the scroll says the one sentence that must never be
 * out of sight. This says the four things a patient needs to have read
 * once, and gives the escalation route that is the only *action* on an
 * assistant screen that does anything today.
 *
 * ── The four points, and why each is separate ───────────────────────
 *
 * 1. **Not a doctor.** The assistant does not diagnose, does not
 *    prescribe, and does not change a dose.
 * 2. **Emergencies do not come here.** Stated before the limitations
 *    rather than after them, and backed by a real control: `onEmergency`
 *    opens the Emergency screen. K-04 requires that an emergency
 *    description surface Emergency *before* any generated text — the
 *    classifier that does that is server-side and unbuilt, so what this
 *    screen can honestly offer is the route, always present, never
 *    conditional on anything being understood.
 * 3. **What it says can be wrong.** Generated information is not
 *    reviewed by a clinician before a patient reads it.
 * 4. **Where to go instead.** A limitation with no next step is a dead
 *    end; `onFindCare` reaches the real Phase G/I screens.
 *
 * ── Why the emergency route is an `error`-tone button ───────────────
 *
 * It is the one control on any assistant screen that is not inert, and
 * it must be findable by someone who is not reading carefully. It never
 * dials: like every emergency affordance in this app it navigates, and
 * every dial stays behind `EmergencyCallButton`'s confirmation (N-03,
 * audit R-6).
 */
export interface AiSafetyCardProps {
  readonly onEmergency: () => void;
  readonly onFindCare?: () => void;
  readonly testID?: string;
}

const POINTS: readonly { id: string; icon: IconName; titleKey: MessageKey; bodyKey: MessageKey }[] =
  [
    {
      id: 'not-a-doctor',
      icon: 'cpu',
      titleKey: 'ai.safety.notADoctor.title',
      bodyKey: 'ai.safety.notADoctor.body',
    },
    {
      id: 'limits',
      icon: 'alertCircle',
      titleKey: 'ai.safety.limits.title',
      bodyKey: 'ai.safety.limits.body',
    },
    {
      id: 'escalate',
      icon: 'users',
      titleKey: 'ai.safety.escalate.title',
      bodyKey: 'ai.safety.escalate.body',
    },
  ];

export function AiSafetyCard({ onEmergency, onFindCare, testID }: AiSafetyCardProps) {
  const theme = useTheme();
  const t = useT();

  return (
    <Card tone="sunken" testID={testID ?? 'ai-safety-card'}>
      {/* The emergency point leads, in error tone, with the route
          attached. Everything below it is context for a decision the
          patient has already been given the means to make. */}
      <View style={[styles.row, { columnGap: theme.space[2] }]}>
        <Icon name="alert" size={18} color="error" />
        <Text variant="bodyStrong" color="error" style={styles.grow}>
          {t('ai.safety.emergency.title')}
        </Text>
      </View>
      <Text variant="bodySm" color="textSecondary">
        {t('ai.safety.emergency.body')}
      </Text>
      <Button
        testID="ai-safety-emergency"
        label={t('ai.safety.emergency.action')}
        tone="emergency"
        icon="alert"
        fullWidth
        onPress={onEmergency}
        hint={t('ai.safety.emergency.hint')}
      />

      <Divider />

      <View style={{ rowGap: theme.space[3] }}>
        {POINTS.map((point) => (
          <View
            key={point.id}
            accessible
            accessibilityLabel={`${t(point.titleKey)}. ${t(point.bodyKey)}`}
            style={{ rowGap: theme.space[1] }}
          >
            <View style={[styles.row, { columnGap: theme.space[2] }]}>
              <Icon name={point.icon} size={16} color="textTertiary" />
              <Text variant="bodyStrong" style={styles.grow}>
                {t(point.titleKey)}
              </Text>
            </View>
            <Text variant="bodySm" color="textTertiary">
              {t(point.bodyKey)}
            </Text>
          </View>
        ))}
      </View>

      {onFindCare === undefined ? null : (
        <Button
          testID="ai-safety-find-care"
          label={t('ai.safety.findCare')}
          tone="secondary"
          icon="search"
          fullWidth
          onPress={onFindCare}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
