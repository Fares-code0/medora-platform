import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

import { type LucideIcon } from 'lucide-react';

import { InlineSpinner } from './internal/InlineSpinner';
import {
  BUTTON_ICON_SIZE,
  buttonClasses,
  type ButtonSize,
  type ButtonVariant,
} from './internal/styles';

/**
 * Button — DS §8.1.
 * One `primary` per view; `destructive` is never adjacent to another
 * destructive action; `ai` is reserved for AI-triggering actions only.
 * Loading: the spinner replaces the leading icon, the label persists, the
 * button keeps its width and is aria-disabled (clicks are suppressed).
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    leadingIcon: LeadingIcon,
    trailingIcon: TrailingIcon,
    className,
    children,
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
      data-loading={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={buttonClasses(variant, size, fullWidth, className)}
      {...rest}
    >
      {loading ? (
        <InlineSpinner className={iconSize} />
      ) : LeadingIcon ? (
        <LeadingIcon aria-hidden="true" className={iconSize} strokeWidth={1.75} />
      ) : null}
      {children}
      {TrailingIcon ? (
        <TrailingIcon aria-hidden="true" className={iconSize} strokeWidth={1.75} />
      ) : null}
    </button>
  );
});
