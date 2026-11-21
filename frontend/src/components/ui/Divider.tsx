import { cn } from '@/utils/cn';

/**
 * Divider — 1px hairline in the border token (DS §2.3).
 * Horizontal by default; optional centered label for grouped content.
 */
export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  label?: string | undefined;
  className?: string;
}

export function Divider({ orientation = 'horizontal', label, className }: DividerProps) {
  if (orientation === 'vertical') {
    return (
      <span
        role="separator"
        aria-orientation="vertical"
        className={cn('inline-block w-px self-stretch bg-border', className)}
      />
    );
  }

  if (label) {
    return (
      <div
        role="separator"
        aria-orientation="horizontal"
        className={cn('flex items-center gap-3', className)}
      >
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="text-caption text-text-tertiary">{label}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return <hr className={cn('h-px w-full border-0 bg-border', className)} />;
}
