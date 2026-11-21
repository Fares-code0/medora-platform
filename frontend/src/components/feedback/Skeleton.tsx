import { cn } from '@/utils/cn';

/**
 * Skeleton placeholder — DS §8.25.
 * Mirrors the final layout to prevent layout shift; radius should match
 * the element it stands in for (pass via className). Static under
 * reduced motion (handled by the global reduced-motion CSS).
 */
interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-control bg-surface-sunken dark:bg-border', className)}
    />
  );
}
