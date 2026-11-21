import { cn } from '@/utils/cn';

/**
 * Circular indeterminate indicator — DS §8.24.
 * 0.8s linear rotation (DS §9.4); spinners keep rotating under reduced
 * motion because progress indication is functional (DS §9.5).
 */

const SIZES = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-12 w-12' } as const;

interface SpinnerProps {
  size?: keyof typeof SIZES;
  className?: string;
  label?: string;
}

export function Spinner({ size = 'md', className, label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cn('inline-block', className)}>
      <span
        className={cn(
          'block animate-spin rounded-pill border-[3px] border-border border-t-primary',
          SIZES[size],
        )}
        style={{ animationDuration: '0.8s' }}
      />
    </span>
  );
}
