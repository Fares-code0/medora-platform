import { cn } from '@/utils/cn';

import { Avatar, type AvatarSize } from './Avatar';

/**
 * AvatarGroup — DS §8.10.
 * Overlapping avatars (-8px), max 4 visible + "+N" overflow circle.
 * Names are exposed on the group; individual avatars are decorative.
 */
export interface AvatarGroupItem {
  readonly name: string;
  readonly src?: string;
}

export interface AvatarGroupProps {
  avatars: readonly AvatarGroupItem[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}

export function AvatarGroup({ avatars, max = 4, size = 'md', className }: AvatarGroupProps) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - visible.length;
  const names = avatars.map((a) => a.name).join(', ');

  const overflowSize = {
    xs: 'h-6 w-6 text-caption',
    sm: 'h-8 w-8 text-caption',
    md: 'h-10 w-10 text-body-sm',
    lg: 'h-16 w-16 text-h5',
    xl: 'h-24 w-24 text-h3',
  }[size];

  return (
    <span
      role="group"
      aria-label={names}
      className={cn('inline-flex items-center -space-x-2', className)}
    >
      {visible.map((avatar) => (
        <Avatar
          key={avatar.name}
          name={avatar.name}
          src={avatar.src}
          size={size}
          decorative
          className="rounded-pill ring-2 ring-surface"
        />
      ))}
      {overflow > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex items-center justify-center rounded-pill bg-surface-sunken font-semibold text-text-secondary ring-2 ring-surface',
            overflowSize,
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
