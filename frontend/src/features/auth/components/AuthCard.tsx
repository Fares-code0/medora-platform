import type { ReactNode } from 'react';

import { Logo } from '@/shared/components/branding';
import { cn } from '@/utils/cn';

/**
 * AuthCard — the centered content column shared by every auth page.
 * Renders the brand mark (mobile-visible, since the brand panel is hidden
 * below lg), a title/subtitle header, and the page body. Presentational only.
 *
 * `surface="card"` sets the content on the EMR white card (ADR-0005): a
 * `surface` panel with its 1px `border` and `shadow-card` on the gray page,
 * the footer divided off inside it — the same card the signed-in app uses.
 * `plain` (the default) is the open column every other auth page keeps.
 */
export interface AuthCardProps {
  title: string;
  subtitle?: string | undefined;
  /** Hide the inline logo when the surrounding layout already shows one. */
  showLogo?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  surface?: 'plain' | 'card';
}

export function AuthCard({
  title,
  subtitle,
  showLogo = true,
  children,
  footer,
  surface = 'plain',
}: AuthCardProps) {
  const card = surface === 'card';
  return (
    <div className="w-full max-w-md">
      {showLogo ? (
        <div className="mb-8 flex justify-center lg:hidden">
          <Logo size="lg" label="Medora" />
        </div>
      ) : null}
      <div
        className={cn(
          card && 'rounded-surface border border-border bg-surface p-6 shadow-card',
        )}
      >
        <div className="mb-6 text-center sm:text-start">
          <h1 className="text-h3 font-semibold text-text-primary">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-body-sm text-text-secondary">{subtitle}</p> : null}
        </div>
        {children}
        {footer ? (
          <div className={cn('mt-6', card && 'border-t border-border pt-5')}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
