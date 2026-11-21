import { useState } from 'react';

import { cn } from '@/utils/cn';

/**
 * Avatar — DS §8.10.
 * Circle in five sizes (24/32/40/64/96). Fallback renders initials (max 2)
 * on a neutral token surface — the deterministic 8-hue palette from the DS
 * requires a component-token addition and lands via DS governance (§13).
 * Role ring: teal = doctor, blue = staff (2px). Status dot bottom-right.
 * Pass `decorative` when the name is rendered adjacent (alt="").
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-caption',
  sm: 'h-8 w-8 text-caption',
  md: 'h-10 w-10 text-body-sm',
  lg: 'h-16 w-16 text-h5',
  xl: 'h-24 w-24 text-h3',
};

const STATUS_DOT_SIZES: Record<AvatarSize, string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-4 w-4',
  xl: 'h-6 w-6',
};

const ROLE_RINGS = {
  doctor: 'ring-2 ring-secondary',
  staff: 'ring-2 ring-primary',
  admin: 'ring-2 ring-primary',
} as const;

export interface AvatarProps {
  name: string;
  src?: string | undefined;
  size?: AvatarSize;
  roleRing?: 'doctor' | 'staff' | 'admin' | undefined;
  status?: 'online' | undefined;
  /** True when the person's name is rendered next to the avatar. */
  decorative?: boolean;
  className?: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 'md',
  roleRing,
  status,
  decorative = false,
  className,
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(src) && !imageFailed;

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden rounded-pill bg-surface-sunken font-semibold text-text-secondary',
          SIZES[size],
          roleRing && ROLE_RINGS[roleRing],
        )}
      >
        {showImage ? (
          <img
            src={src}
            alt={decorative ? '' : name}
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            aria-hidden={decorative ? true : undefined}
            role={decorative ? undefined : 'img'}
            aria-label={decorative ? undefined : name}
          >
            {initialsOf(name)}
          </span>
        )}
      </span>
      {status === 'online' ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-0 end-0 rounded-pill border-2 border-surface bg-success',
            STATUS_DOT_SIZES[size],
          )}
        />
      ) : null}
    </span>
  );
}
