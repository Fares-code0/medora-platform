import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { announce } from '@/accessibility/a11y';
import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';

/**
 * Transient confirmation.
 *
 * A toast is for an outcome the patient does not need to act on — "Saved",
 * "Copied". Anything that needs a decision is a `ConfirmSheet`, and
 * anything that failed in a way the patient must fix is an inline error
 * on the field, not a message that disappears after four seconds.
 *
 * Every toast is also announced to assistive technology (checklist S-07).
 * A confirmation only a sighted user receives is not a confirmation.
 *
 * PHI never goes in one: a toast renders over whatever is on screen and
 * can be caught by a screenshot or an app-switcher preview.
 */

export type ToastTone = 'success' | 'error' | 'info';

interface ToastMessage {
  readonly id: number;
  readonly text: string;
  readonly tone: ToastTone;
}

interface ToastContextValue {
  show: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE: Record<ToastTone, { icon: IconName; color: ColorToken; background: ColorToken }> = {
  success: { icon: 'checkCircle', color: 'success', background: 'successSubtle' },
  error: { icon: 'alertCircle', color: 'error', background: 'errorSubtle' },
  info: { icon: 'info', color: 'info', background: 'infoSubtle' },
};

const VISIBLE_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<ToastMessage | null>(null);

  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    setMessage({ id: Date.now(), text, tone });
    announce(text);
  }, []);

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message === null ? null : (
        <View
          pointerEvents="none"
          testID="toast"
          style={[
            styles.host,
            theme.elevation.popover,
            {
              bottom: insets.bottom + theme.space[6],
              marginHorizontal: theme.screenGutter,
              backgroundColor: theme.colors[TONE[message.tone].background],
              borderColor: theme.colors[TONE[message.tone].color],
              borderRadius: theme.radius.surface,
              padding: theme.space[3],
              columnGap: theme.space[2],
            },
          ]}
        >
          <Icon name={TONE[message.tone].icon} size={18} color={TONE[message.tone].color} />
          <Text variant="bodySm" color={TONE[message.tone].color} style={styles.grow}>
            {message.text}
          </Text>
        </View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>.');
  return value;
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  host: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
