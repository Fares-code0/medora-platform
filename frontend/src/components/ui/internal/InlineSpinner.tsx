import { cn } from '@/utils/cn';

/**
 * Current-color spinner used inside buttons — DS §8.1 loading state.
 * Inherits the button's text color so it works on every variant and theme.
 * Keeps rotating under reduced motion (progress indication is functional).
 */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0 animate-spin rounded-pill border-2 border-current border-t-transparent',
        className,
      )}
      style={{ animationDuration: '0.8s' }}
    />
  );
}
