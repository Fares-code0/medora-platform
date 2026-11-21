import { Image, StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Text } from '@/components';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import type { ImageDraft } from '../model/types';

/**
 * Choose, preview, remove — Phase L's interface, in four states.
 *
 * ── Every state is drawn; none of them analyses anything ────────────
 *
 * - `empty` — the choose control, disabled, with the reason stated.
 * - `selected` — a preview with a remove control beside it.
 * - `processing` — the visual wait, for the day there is something to
 *   wait for.
 * - `done` — hands over to `AiResultPlaceholder`, which the screen
 *   renders; this component draws no finding.
 *
 * The component is pure and prop-driven, so `ai-states.test.tsx` renders
 * each state directly. That is the only way these states can honestly
 * exist right now: the screen mounts it in `empty`, because there is no
 * flow that would move it out of `empty`.
 *
 * ── The dependency stack behind the disabled control ────────────────
 *
 * Choosing an image needs `expo-image-picker`, a native module — a
 * development build, which is the same reason MMKV is absent from this
 * tree (`docs/ARCHITECTURE.md` §1). Sending one needs BE-15: object
 * storage, a malware scanner, and the files service (M25), none of which
 * exists — `File.storage_key` is a column with nothing behind it.
 * Reading one needs a vision model and AD-4's clinical sign-off (L-04).
 * None of the three is a thing this directory can supply, so the control
 * is disabled and the screen says which of them is missing.
 *
 * ── What this component must never grow ─────────────────────────────
 *
 * An `onAnalyse`. If a future contributor is tempted, read L-03 and
 * L-04: a rendering of a medical image finding needs explicit
 * uncertainty, a route to a clinician, and limitations copy signed off
 * by a named clinical owner **before any build reaches a store**.
 */
export type AiImagePickerState = 'empty' | 'selected' | 'processing' | 'done';

export interface AiImagePickerProps {
  readonly state: AiImagePickerState;
  readonly draft?: ImageDraft;
  /** Absent (or state `empty` with `canPick` false) renders it disabled. */
  readonly onPick?: () => void;
  readonly onRemove?: () => void;
  readonly canPick?: boolean;
  readonly testID?: string;
}

export function AiImagePicker({
  state,
  draft,
  onPick,
  onRemove,
  canPick = false,
  testID,
}: AiImagePickerProps) {
  const theme = useTheme();
  const t = useT();

  return (
    <Card testID={testID ?? 'ai-image-picker'}>
      {state === 'empty' ? (
        <View
          testID="ai-image-empty"
          style={[
            styles.dropzone,
            {
              borderColor: theme.colors.borderStrong,
              borderRadius: theme.radius.surface,
              padding: theme.space[6],
              rowGap: theme.space[2],
            },
          ]}
        >
          <Icon name="camera" size={32} color="textDisabled" />
          <Text variant="bodyStrong" align="center">
            {t('ai.image.empty.title')}
          </Text>
          <Text variant="bodySm" color="textTertiary" align="center">
            {t('ai.image.empty.body')}
          </Text>
          <Button
            testID="ai-image-pick"
            label={t('ai.image.choose')}
            tone="secondary"
            icon="image"
            disabled={!canPick || onPick === undefined}
            onPress={onPick ?? (() => undefined)}
            {...(canPick ? {} : { hint: t('ai.image.disabledHint') })}
          />
        </View>
      ) : null}

      {state === 'selected' && draft !== undefined ? (
        <View testID="ai-image-selected" style={{ rowGap: theme.space[3] }}>
          <Image
            testID="ai-image-preview"
            source={{ uri: draft.uri }}
            resizeMode="cover"
            // The image IS the content here, so it is not decorative:
            // a screen-reader user is told what is on screen and that
            // the app has not looked at it.
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('ai.image.previewA11y', {
              name: draft.fileName ?? t('ai.image.unnamed'),
            })}
            style={[styles.preview, { borderRadius: theme.radius.surface }]}
          />
          <Text variant="caption" color="textTertiary">
            {t('ai.image.localOnly')}
          </Text>
          <Button
            testID="ai-image-remove"
            label={t('ai.image.remove')}
            tone="secondary"
            icon="trash"
            fullWidth
            onPress={onRemove ?? (() => undefined)}
            disabled={onRemove === undefined}
          />
        </View>
      ) : null}

      {state === 'processing' ? (
        <View
          testID="ai-image-processing"
          accessibilityLiveRegion="polite"
          accessible
          accessibilityLabel={t('ai.image.processing')}
          style={{ rowGap: theme.space[3] }}
        >
          <Skeleton height={160} radius={theme.radius.surface} />
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Icon name="cpu" size={16} color="textTertiary" />
            <Text variant="bodySm" color="textTertiary">
              {t('ai.image.processing')}
            </Text>
          </View>
        </View>
      ) : null}

      {state === 'done' ? (
        <Text variant="bodySm" color="textTertiary" testID="ai-image-done">
          {t('ai.image.done')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  dropzone: { alignItems: 'center', borderStyle: 'dashed', borderWidth: 1 },
  preview: { aspectRatio: 4 / 3, width: '100%' },
  row: { alignItems: 'center', flexDirection: 'row' },
});
