import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

import { type LucideIcon } from 'lucide-react';

import { InlineSpinner } from './internal/InlineSpinner';
import {
  BUTTON_ICON_SIZE,
  iconButtonClasses,
  type ButtonSize,
  type IconButtonVariant,
} from './internal/styles';

/**
 * IconButton — DS §7.1 / §8.1.
 * Icon-only control; allowed solely for universally understood actions and
 * always labelled (`aria-label` is required by the type). Pair with a
 * Tooltip for pointer users. With a mouse the target is the button itself
 * (28 / 32 / 36px); on a coarse pointer it reserves a gutter that makes it
 * 44 x 44px without overlapping a neighbour (`.touch-target`, DEC-008).
 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    variant = 'neutral',
    size = 'md',
    loading = false,
    className,
    disabled,
    onClick,
    type,
    ...rest
  },
  ref,
) {
  const iconSize = BUTTON_ICON_SIZE[size];
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || disabled || undefined}
      onClick={loading ? undefined : onClick}
      className={iconButtonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <InlineSpinner className={iconSize} />
      ) : (
        <Icon aria-hidden="true" className={iconSize} strokeWidth={1.75} />
      )}
    </button>
  );
});
