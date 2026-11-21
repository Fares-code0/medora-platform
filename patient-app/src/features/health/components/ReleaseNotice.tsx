import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import type { IconName } from '@/components/Icon';
import { useT, type MessageKey } from '@/i18n';
import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';
import type { ReleaseState } from '@/types/vocabularies';

/**
 * What a patient sees when a record is not released to them.
 *
 * ── Why this component exists at all ─────────────────────────────────
 * The tempting implementations are both wrong. Filtering withheld records
 * out of the list leaves a patient certain their lipid results were never
 * taken. Showing an error makes a deliberate clinical decision look like
 * a bug the patient should retry past. Both are the failure checklist
 * J-06 names: "a withheld result shows 'pending clinician review' with a
 * contact route — never a blank".
 *
 * So a held record is VISIBLE, its state is NAMED, and there is a way to
 * ask about it. What the app does not do is explain the clinical reason,
 * because it does not know one and AD-5 has not been decided.
 */
interface Presentation {
  readonly icon: IconName;
  readonly tone: ColorToken;
  readonly background: ColorToken;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
}

const PRESENTATION: Record<Exclude<ReleaseState, 'released'>, Presentation> = {
  'pending-review': {
    icon: 'clock',
    tone: 'warning',
    background: 'warningSubtle',
    titleKey: 'health.release.pending.title',
    bodyKey: 'health.release.pending.body',
  },
  'not-released': {
    icon: 'lock',
    tone: 'info',
    background: 'infoSubtle',
    titleKey: 'health.release.withheld.title',
    bodyKey: 'health.release.withheld.body',
  },
  unavailable: {
    icon: 'alertCircle',
    tone: 'textTertiary',
    background: 'surfaceSunken',
    titleKey: 'health.release.notReady.title',
    bodyKey: 'health.release.notReady.body',
  },
};

export function ReleaseNotice({ state, testID }: { state: ReleaseState; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  if (state === 'released') return null;
  const presentation = PRESENTATION[state];
  const title = t(presentation.titleKey);
  const body = t(presentation.bodyKey);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${title}. ${body}`}
      style={[
        styles.notice,
        {
          backgroundColor: theme.colors[presentation.background],
          borderColor: theme.colors[presentation.tone],
          borderRadius: theme.radius.control,
          padding: theme.space[3],
          columnGap: theme.space[2],
        },
      ]}
    >
      <Icon name={presentation.icon} size={16} color={presentation.tone} />
      <View style={styles.grow}>
        <Text variant="label" color={presentation.tone}>
          {title}
        </Text>
        <Text variant="caption" color="textSecondary">
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  notice: { alignItems: 'flex-start', borderWidth: 1, flexDirection: 'row' },
});
