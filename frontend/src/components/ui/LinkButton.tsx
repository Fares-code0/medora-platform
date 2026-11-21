import { forwardRef } from 'react';
import type { AnchorHTMLAttributes } from 'react';

import { type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

import {
  BUTTON_ICON_SIZE,
  buttonClasses,
  type ButtonSize,
  type ButtonVariant,
} from './internal/styles';

/**
 * LinkButton — an anchor with full Button styling (DS §8.1).
 * Use for navigation that must read as an action (e.g. "Book appointment"
 * leading to a page). For router links, pass the router-generated href;
 * this component stays router-agnostic per FRONTEND_ARCHITECTURE §8.2.
 */
export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  disabled?: boolean;
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  {
    href,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    disabled = false,
    leadingIcon: LeadingIcon,
    trailingIcon: TrailingIcon,
    className,
    children,
    ...rest
  },
  ref,
) {
  const iconSize = BUTTON_ICON_SIZE[size];
  return (
    <a
      ref={ref}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className={cn(
        buttonClasses(variant, size, fullWidth, className),
        disabled && 'pointer-events-none border-border bg-surface-sunken text-text-disabled',
      )}
      {...(disabled ? {} : { href })}
      {...rest}
    >
      {LeadingIcon ? (
        <LeadingIcon aria-hidden="true" className={iconSize} strokeWidth={1.75} />
      ) : null}
      {children}
      {TrailingIcon ? (
        <TrailingIcon aria-hidden="true" className={iconSize} strokeWidth={1.75} />
      ) : null}
    </a>
  );
});
