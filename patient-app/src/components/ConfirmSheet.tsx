import { View } from 'react-native';

import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { Button, type ButtonTone } from './Button';
import { BottomSheet } from './layout/BottomSheet';
import { Text } from './Text';

/**
 * The confirmation step for anything irreversible or outward-facing.
 *
 * One component, used by every such action — cancelling an appointment,
 * logging out, and above all dialling from the Emergency screen. Building
 * a bespoke confirmation per screen is how one of them ends up as a
 * single tap (checklist R-06).
 *
 * Two properties are deliberate and must survive edits:
 *
 * - **The confirm button is not pre-focused and is not the first element.**
 *   Cancel comes second in the layout but the sheet opens with nothing
 *   focused, so a double-tap on the trigger cannot fall through onto
 *   Confirm.
 * - **`detail` names exactly what will happen** — for a dial, the number
 *   itself. "Are you sure?" is not a confirmation; "Call 112?" is.
 *
 * ── The cancel label reads the catalogue (C-09) ──────────────────────
 *
 * It was `cancelLabel = 'Cancel'` — a **default parameter**, which is
 * neither a JSX attribute nor an object property, so
 * `no-inline-copy.test.ts` could not see it and neither could anything
 * else: a sheet is invisible until something opens it. A patient reading
 * Medora in Arabic got an Arabic title, an Arabic confirm button and an
 * English **Cancel** beneath them, on the two sheets that do not pass
 * their own label — closing an account and signing out. The scan now
 * reads default parameters too.
 *
 * Passing `cancelLabel` is still allowed and still means something: the
 * emergency sheet says "Not now", which is deliberately not the word
 * `action.cancel` carries.
 */
export interface ConfirmSheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly detail: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly tone?: Extract<ButtonTone, 'primary' | 'destructive' | 'emergency'>;
  readonly cancelLabel?: string;
  readonly testID?: string;
}

export function ConfirmSheet({
  visible,
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  tone = 'primary',
  cancelLabel,
  testID,
}: ConfirmSheetProps) {
  const theme = useTheme();
  const t = useT();

  return (
    <BottomSheet visible={visible} onClose={onCancel} title={title} testID={testID}>
      <Text variant="body" color="textSecondary">
        {detail}
      </Text>

      <View style={{ rowGap: theme.space[2] }}>
        <Button
          label={confirmLabel}
          tone={tone}
          size="lg"
          fullWidth
          onPress={onConfirm}
          testID={testID === undefined ? undefined : `${testID}-confirm`}
        />
        <Button
          label={cancelLabel ?? t('action.cancel')}
          tone="secondary"
          size="lg"
          fullWidth
          onPress={onCancel}
          testID={testID === undefined ? undefined : `${testID}-cancel`}
        />
      </View>
    </BottomSheet>
  );
}
