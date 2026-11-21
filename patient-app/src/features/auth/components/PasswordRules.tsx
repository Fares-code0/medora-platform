import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components';
import { useT, type MessageKey } from '@/i18n';
import { useTheme } from '@/theme';

import { passwordChecks, PASSWORD_MIN_LENGTH } from '../schemas';

/**
 * The live password-policy meter.
 *
 * It renders every unmet rule at once rather than the first failure. Zod
 * stops at the first, which is right for a submit and wrong for a live
 * meter: a patient fixing one rule at a time, five times, gives up.
 *
 * The whole group is one accessible element with a summary label, because
 * five separate "checked/unchecked" nodes is five stops in a screen
 * reader's swipe order for one piece of information.
 *
 * Extracted from `ResetPasswordScreen`, which was its only user until the
 * change-password form needed the identical thing. Two copies of a policy
 * display drift the way two copies of a policy do.
 */
const RULES: readonly { id: string; labelKey: MessageKey; test: (value: string) => boolean }[] = [
  { id: 'length', labelKey: 'auth.password.rule.length', test: passwordChecks.length },
  { id: 'lower', labelKey: 'auth.password.rule.lower', test: passwordChecks.lower },
  { id: 'upper', labelKey: 'auth.password.rule.upper', test: passwordChecks.upper },
  { id: 'digit', labelKey: 'auth.password.rule.digit', test: passwordChecks.digit },
  { id: 'symbol', labelKey: 'auth.password.rule.symbol', test: passwordChecks.symbol },
];

export function PasswordRules({ password, testID }: { password: string; testID?: string }) {
  const theme = useTheme();
  const t = useT();

  // `{count}` comes from the schema, so the sentence and the rule it
  // describes cannot disagree: raising `PASSWORD_MIN_LENGTH` changes both.
  const label = (rule: (typeof RULES)[number]) => t(rule.labelKey, { count: PASSWORD_MIN_LENGTH });

  const unmet = RULES.filter((rule) => !rule.test(password)).map(label);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={
        // A single summary, not five nodes: five "checked/unchecked"
        // stops for one piece of information is five swipes a
        // screen-reader user spends learning nothing new. When every
        // rule is met the summary says so rather than listing nothing.
        unmet.length === 0
          ? t('auth.password.rules.a11yMet')
          : t('auth.password.rules.a11y', { missing: unmet.join(', ') })
      }
      style={{ rowGap: theme.space[1] }}
    >
      {RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <View key={rule.id} style={[styles.row, { columnGap: theme.space[2] }]}>
            <Icon
              name={met ? 'checkCircle' : 'x'}
              size={14}
              color={met ? 'success' : 'textDisabled'}
            />
            <Text variant="caption" color={met ? 'success' : 'textTertiary'}>
              {label(rule)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
});
