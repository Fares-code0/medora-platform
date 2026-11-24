import { ErrorState } from '@/components/feedback';
import { useT } from '@/i18n';

/**
 * The copy `FeatureErrorBoundary` shows when a routed feature crashes.
 *
 * Its own component, in its own file, because a class boundary cannot call
 * `useT()` and the fallback has to speak the active language like the shell
 * around it — and a second component beside the class would cost the file
 * its Fast Refresh boundary (`react-refresh/only-export-components`).
 */
export function FeatureErrorFallback({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <ErrorState
      headingLevel="h1"
      title={t('shell.pageLoadError')}
      description={t('shell.pageLoadErrorBody')}
      onRetry={onRetry}
    />
  );
}
