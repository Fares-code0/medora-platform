import { StyleSheet, View } from 'react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import { useT, type MessageKey, type MessageParams } from '@/i18n';
import { ResponseContractError } from '@/schemas/envelope';
import { useTheme } from '@/theme';
import { isApiError, type ApiError } from '@/types/api';

import { Button } from '../Button';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';

/**
 * The error state.
 *
 * One component for all ten error kinds, and the mapping below is where
 * the difference between them becomes visible to the patient — which is
 * the whole reason `ApiError` is a discriminated union rather than a
 * string (checklist R-03).
 *
 * Two rules the copy follows:
 *
 * 1. **Never surface the server's free text.** A `detail` or a `message`
 *    can contain PHI or internal names. The only server value rendered
 *    here is `ref` (a correlation id) on a 5xx, so a patient can quote it
 *    to support, and `retryAfterSeconds` as a countdown.
 * 2. **Retry only where retrying can work.** A 403 has no Retry button;
 *    offering one teaches the patient to hammer a wall.
 *
 * ── Why `present()` returns keys and not sentences (C-09) ────────────
 * A patient reading an error is the patient least able to work around a
 * language they do not speak, so this surface was the first to move onto
 * the typed catalogue. `present()` stays a pure function of the error —
 * it does not call a hook, so it remains testable on its own and the
 * test that asserts every kind gets *distinct* copy now compares keys,
 * which is the same claim expressed more strictly.
 *
 * The interpolated values travel as `bodyParams` rather than being
 * formatted here: a translator needs the whole sentence, and `{seconds}`
 * does not sit in the same place in every language.
 */
interface Presentation {
  readonly icon: IconName;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly bodyParams?: MessageParams;
  /**
   * Params whose VALUE is itself a catalogue key, resolved by the
   * component rather than here.
   *
   * `present` is a pure function of the error — that is what lets its
   * test assert every kind maps to distinct copy without a render — so it
   * cannot call `t`. An unbuilt endpoint's `capability` is a key (see
   * `api/seam.ts`), and interpolating a key into a sentence would print
   * `capability.recentActivity` on the screen. This keeps the purity and
   * names the nesting instead of hiding it.
   */
  readonly bodyParamKeys?: Readonly<Record<string, MessageKey>>;
  readonly retryable: boolean;
}

function present(error: unknown): Presentation {
  if (error instanceof EndpointNotImplementedError) {
    return {
      icon: 'clock',
      titleKey: 'state.error.unavailable.title',
      // Honest, and specific about whose work it is. A patient sees a
      // plain sentence; the dependency code is for the developer reading
      // a bug report screenshot.
      bodyKey: 'state.error.unavailable.body',
      bodyParamKeys: { capability: error.capability },
      retryable: false,
    };
  }
  if (error instanceof ResponseContractError) {
    return {
      icon: 'alert',
      titleKey: 'state.error.contract.title',
      bodyKey: 'state.error.contract.body',
      retryable: true,
    };
  }
  if (!isApiError(error)) {
    return {
      icon: 'alertCircle',
      titleKey: 'state.error.title',
      bodyKey: 'state.error.body',
      retryable: true,
    };
  }
  return presentApiError(error);
}

function presentApiError(error: ApiError): Presentation {
  // Switched on `error.kind` directly rather than a widened local, so the
  // union narrows and `retryAfterSeconds`/`ref` are reachable — and so a
  // new kind is a compile error here rather than a silent fall-through.
  switch (error.kind) {
    case 'network':
      return {
        icon: 'wifiOff',
        titleKey: 'state.error.network.title',
        bodyKey: 'state.error.network.body',
        retryable: true,
      };
    case 'timeout':
      return {
        icon: 'clock',
        titleKey: 'state.error.timeout.title',
        bodyKey: 'state.error.timeout.body',
        retryable: true,
      };
    case 'auth':
      return {
        icon: 'lock',
        titleKey: 'state.error.auth.title',
        bodyKey: 'state.error.auth.body',
        retryable: false,
      };
    case 'forbidden':
      return {
        icon: 'shield',
        titleKey: 'state.error.forbidden.title',
        bodyKey: 'state.error.forbidden.body',
        retryable: false,
      };
    case 'not_found':
      return {
        icon: 'search',
        titleKey: 'state.error.notFound.title',
        bodyKey: 'state.error.notFound.body',
        retryable: false,
      };
    case 'conflict':
      return {
        icon: 'refresh',
        titleKey: 'state.error.conflict.title',
        bodyKey: 'state.error.conflict.body',
        retryable: true,
      };
    case 'rate_limited':
      return {
        icon: 'clock',
        titleKey: 'state.error.rateLimited.title',
        bodyKey: 'state.error.rateLimited.body',
        bodyParams: { seconds: error.retryAfterSeconds },
        retryable: false,
      };
    case 'validation':
      return {
        icon: 'alertCircle',
        titleKey: 'state.error.validation.title',
        bodyKey: 'state.error.validation.body',
        retryable: false,
      };
    case 'cancelled':
      return {
        icon: 'x',
        titleKey: 'state.error.cancelled.title',
        bodyKey: 'state.error.cancelled.body',
        retryable: true,
      };
    case 'server':
      return {
        icon: 'alert',
        titleKey: 'state.error.server.title',
        bodyKey: 'state.error.server.body',
        bodyParams: { ref: error.ref },
        retryable: true,
      };
  }
}

export interface ErrorStateProps {
  readonly error: unknown;
  readonly onRetry?: () => void;
  readonly testID?: string;
}

export function ErrorState({ error, onRetry, testID }: ErrorStateProps) {
  const theme = useTheme();
  const t = useT();
  const presentation = present(error);
  const title = t(presentation.titleKey);
  const body = t(presentation.bodyKey, {
    ...presentation.bodyParams,
    ...Object.fromEntries(
      Object.entries(presentation.bodyParamKeys ?? {}).map(([name, key]) => [name, t(key)]),
    ),
  });

  return (
    <View
      testID={testID}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${title}. ${body}`}
      style={[styles.container, { paddingVertical: theme.space[8], rowGap: theme.space[3] }]}
    >
      <Icon name={presentation.icon} size={36} color="error" />
      <Text variant="h3" align="center">
        {title}
      </Text>
      <Text variant="bodySm" color="textTertiary" align="center">
        {body}
      </Text>
      {presentation.retryable && onRetry !== undefined ? (
        <Button
          label={t('action.retry')}
          tone="secondary"
          icon="refresh"
          onPress={onRetry}
          testID={testID === undefined ? undefined : `${testID}-retry`}
        />
      ) : null}
    </View>
  );
}

/** Exported for the test that asserts every kind maps to distinct copy. */
export const __presentForTest = present;

/**
 * The title that names a failure, for a caller that reports it somewhere
 * other than this full-screen state (a toast). Same mapping, so the copy
 * cannot drift.
 *
 * It does not say whether the failure is safe to keep stale content
 * over: Retry eligibility is a different question (a 429 has no Retry
 * button but leaves cached records valid). That rule is
 * `isStaleDataSafeError` in `api/errors.ts`.
 */
export function summarizeError(error: unknown): { readonly titleKey: MessageKey } {
  return { titleKey: present(error).titleKey };
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
});
