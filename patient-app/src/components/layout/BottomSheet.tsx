import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headingA11y, pressableA11y } from '@/accessibility/a11y';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { Icon } from '../Icon';
import { Text } from '../Text';

/**
 * A bottom sheet, built on RN's `Modal`.
 *
 * A `Modal` and not an absolutely-positioned view, because only a real
 * modal takes accessibility focus away from the screen behind it. A
 * "sheet" a screen reader can walk out of the back of is not a
 * confirmation step, and confirmation is what this component exists for —
 * every destructive action, and every emergency dial, goes through one
 * (checklist R-06, N-03).
 *
 * `onRequestClose` is wired so Android's hardware back button dismisses.
 * A confirmation the back button cannot escape is a trap.
 */
export interface BottomSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly testID?: string;
}

export function BottomSheet({ visible, onClose, title, children, testID }: BottomSheetProps) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.fill, { backgroundColor: theme.colors.scrim }]}>
        {/* The scrim is a dismiss target for a pointer, and hidden from
            assistive tech — a screen reader user dismisses with the
            explicit Close control, not by finding an unlabelled backdrop. */}
        <Pressable
          style={styles.fill}
          onPress={onClose}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />

        <View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            theme.elevation.modal,
            {
              backgroundColor: theme.colors.surfaceOverlay,
              borderColor: theme.colors.border,
              borderTopLeftRadius: theme.radius.surface * 2,
              borderTopRightRadius: theme.radius.surface * 2,
              paddingHorizontal: theme.screenGutter,
              paddingTop: theme.space[4],
              paddingBottom: insets.bottom + theme.space[4],
              rowGap: theme.space[4],
            },
          ]}
        >
          <View style={styles.header}>
            <Text variant="h2" style={styles.grow} {...headingA11y(title)}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              {...pressableA11y({ label: t('action.close') })}
            >
              <Icon name="x" size={22} color="textSecondary" />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheet: { borderTopWidth: 1 },
});
