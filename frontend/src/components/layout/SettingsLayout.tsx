import type { ReactNode } from 'react';

import { ArrowLeft, type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

import { ContentHeader, type ContentHeaderTone } from './ContentHeader';

/**
 * SettingsLayout — the full-page frame of an application settings section.
 *
 * Settings is a place you go, not a widget on the dashboard, so it does not
 * sit in a centred `PageContainer` like the pages around it. It takes the
 * whole content area of the shell: a header band carrying the way back and
 * the page title, then the category navigation as its own full-height
 * column beside the selected category's content.
 *
 *   ┌───────────────────────────────────────────┐
 *   │ ← Back to Overview                        │
 *   │ Settings                                  │
 *   ├────────────┬──────────────────────────────┤
 *   │ categories │ selected category            │
 *   │ (sticky)   │                              │
 *   └────────────┴──────────────────────────────┘
 *
 * Below lg the column folds away: `navigation` is expected to render its own
 * compact form there (both settings centers render a Select), which sits in
 * a band above the content instead of beside it.
 *
 * The app shell — sidebar, navbar — stays. That is the "reuse the shell"
 * half of the brief: settings is a full page *of* the app, not a second app.
 *
 * Gutters match `PageContainer` (16 / 24 / 32px) so nothing shifts when
 * moving between settings and any other page. The back link is a plain
 * `<a href>`; the shell's internal-link navigation routes it, the same way
 * it routes the settings navigation's own links.
 */
export interface SettingsLayoutProps {
  title: string;
  caption?: string | undefined;
  icon?: LucideIcon | undefined;
  tone?: ContentHeaderTone;
  actions?: ReactNode;
  /** Where "back" goes — the dashboard's own home page. */
  backHref: string;
  backLabel: string;
  /** The category navigation: a rail at lg+, its own compact form below. */
  navigation: ReactNode;
  children: ReactNode;
}

/**
 * The navbar is 48px below md and 52px from md up (TopNavbar). The column
 * only exists at lg+, so the 52px figure is the one it needs.
 */
const BELOW_NAVBAR = 'lg:min-h-[calc(100dvh-52px)]';
const STICKY_VIEWPORT = 'lg:max-h-[calc(100dvh-52px)]';

export function SettingsLayout({
  title,
  caption,
  icon,
  tone = 'neutral',
  actions,
  backHref,
  backLabel,
  navigation,
  children,
}: SettingsLayoutProps) {
  return (
    <div className={cn('flex flex-col', BELOW_NAVBAR)}>
      <div className="border-b border-border bg-surface px-4 pb-4 pt-3 md:px-6 md:pb-5 md:pt-4 xl:px-8">
        <a
          href={backHref}
          className="touch-target -ms-1.5 inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 [--touch-y:9px] text-body-sm font-medium text-text-secondary transition-colors duration-fast hover:bg-surface-sunken hover:text-text-primary"
        >
          {/* An arrow is a direction, so it mirrors with the reading order. */}
          <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.75} />
          {backLabel}
        </a>
        <ContentHeader
          className="mt-2"
          title={title}
          caption={caption}
          icon={icon}
          tone={tone}
          actions={actions}
        />
      </div>

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="border-b border-border px-4 py-3 md:px-6 lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-e lg:bg-surface lg:p-0">
          <div
            className={cn('lg:sticky lg:top-0 lg:overflow-y-auto lg:px-3 lg:py-5', STICKY_VIEWPORT)}
          >
            {navigation}
          </div>
        </aside>

        <div className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6 xl:px-8">
          <div className="max-w-container-xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
