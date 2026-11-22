import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headingA11y, pressableA11y } from '@/accessibility/a11y';
import { useReducedMotion } from '@/accessibility/useReducedMotion';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { Icon } from '../Icon';
import { Text } from '../Text';

import { useKeyboardVisible } from './screen-content';

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
 *
 * The sheet sits inside a `KeyboardAvoidingView` because some sheets hold
 * a text field (the cancel and reschedule reasons). A `Modal` is its own
 * window, so the screen's keyboard handling does not reach it: on iOS the
 * keyboard rose over the field and the Confirm button beneath it. Padding
 * lifts the bottom-anchored sheet clear.
 *
 * Android gets `padding` too. Under edge-to-edge (enforced from Android 15,
 * and on for this app's Expo 58 / RN 0.88 build) the window is no longer
 * resized for the keyboard, so "Android resizes the modal itself" was only
 * ever true of the legacy mode; `KeyboardAvoidingView` reads the keyboard
 * frame from RN's events on both platforms. `padding` over `height`
 * because the sheet is bottom-anchored and `height` needs a remembered
 * initial frame it cannot get inside a transparent Modal.
 *
 * The sheet is capped at the window height minus the top inset, with the
 * header outside a `ScrollView` that holds the body: at 320x568 or a 1.6x
 * font the content scrolls, and the title and Close stay reachable. The
 * bottom safe-area padding is dropped while the keyboard is up, because the
 * keyboard then owns that edge. The slide animation is dropped under
 * reduce-motion.
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
  const { height: windowHeight } = useWindowDimensions();
  const keyboardVisible = useKeyboardVisible();
  const reducedMotion = useReducedMotion();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
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
                maxHeight: Math.max(windowHeight - insets.top, 0),
                backgroundColor: theme.colors.surfaceOverlay,
                borderColor: theme.colors.border,
                borderTopLeftRadius: theme.radius.surface * 2,
                borderTopRightRadius: theme.radius.surface * 2,
                paddingHorizontal: theme.screenGutter,
                paddingTop: theme.space[4],
                paddingBottom: (keyboardVisible ? 0 : insets.bottom) + theme.space[4],
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
            <ScrollView
              testID={testID === undefined ? undefined : `${testID}-body`}
              style={styles.body}
              contentContainerStyle={{ rowGap: theme.space[4] }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 0, flexShrink: 1 },
  fill: { flex: 1 },
  grow: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheet: { borderTopWidth: 1, flexShrink: 1 },
});
