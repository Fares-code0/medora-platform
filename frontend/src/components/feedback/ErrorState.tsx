import { AlertCircle } from 'lucide-react';

import { isNotConnected } from '@/api/http';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Section/widget error state — DS §8.33.
 * One failed widget never takes down the page; every error offers Retry.
 *
 * ## The title is a paragraph, not a heading — unless it is the page
 *
 * A widget that failed inside a working page should not add a heading to
 * that page's outline: it is one broken card among several, and a reader
 * skimming by heading would be sent to it. `role="alert"` is what announces
 * it, and that is enough.
 *
 * A detail route that could not load is the other case — the error is all
 * there is, and rendering it without a heading left four pages with no `h1`.
 * Those pass `headingLevel="h1"`.
 */
interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: (() => void) | undefined;
  /**
   * The failure itself, when the caller has it. Only one case reads it
   * today: a feature with no backend in a live build (`notConnected`), which
   * is not a failure to retry and must not read as one — it gets its own
   * wording and no Retry button, since retrying cannot connect a server
   * that does not exist yet.
   */
  error?: unknown;
  /**
   * Promotes the title from a paragraph to a heading. Omit it for a widget
   * inside a page that has its own; pass `h1` when this component is the
   * whole page.
   */
  headingLevel?: 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  error,
  headingLevel: Heading = 'p',
  className,
}: ErrorStateProps) {
  const t = useT();
  const unconnected = isNotConnected(error);
  const shownTitle = unconnected ? t('ui.notConnected') : (title ?? t('ui.sectionLoadError'));
  const shownDescription = unconnected ? t('ui.notConnectedBody') : description;
  const retry = unconnected ? undefined : onRetry;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-surface border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mb-1.5 flex h-10 w-10 items-center justify-center rounded-pill bg-error-subtle text-error"
      >
        <AlertCircle className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <Heading className="text-body-sm font-semibold text-text-primary">{shownTitle}</Heading>
      {shownDescription ? (
        <p className="text-body-sm text-text-secondary">{shownDescription}</p>
      ) : null}
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="mt-2 inline-flex h-8 items-center rounded-surface border border-border-strong bg-surface px-3 text-body-sm font-medium text-primary transition-colors duration-fast hover:bg-surface-sunken active:scale-[0.98]"
        >
          {t('ui.retry')}
        </button>
      ) : null}
    </div>
  );
}
