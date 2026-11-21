import type { ReactNode } from 'react';

import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { cn } from '@/utils/cn';

import { SECTION_META } from '../administration.meta';
import type { AdminSectionSlug } from '../administration.types';

/**
 * SectionShell — the admin area's page frame (Phase 17).
 *
 * Derives its title/description/icon from SECTION_META so every section is
 * labelled consistently, and owns the page's single h1.
 *
 * ── It is the same page frame the doctor area uses ───────────────────
 * It was not, and that was the largest reason the two areas read as two
 * products. Two differences, both structural:
 *
 * 1. No container. Every admin section rendered straight into the shell's
 *    <main>, so its content sat flush against all four viewport edges — no
 *    gutter, no vertical rhythm, and no max width, which on a wide monitor
 *    stretched a toolbar the full 2560px while every doctor page capped at
 *    1440. That is the "content touches the corners / is pushed to the right"
 *    report, and it was true of all 22 sections at once.
 * 2. A second page header. It drew its own icon tile (44px, against
 *    ContentHeader's 32px), its own h1 and its own actions row — a
 *    visually equivalent component with a different implementation, so the
 *    title moved and resized when you crossed between the two areas.
 *
 * Both are now delegated: `PageContainer` for the frame (identical width and
 * rhythm to the doctor pages) and `ContentHeader` for the header. What stays
 * SectionShell's own is the part that genuinely differs — the toolbar row
 * that hosts search and filters directly beneath the title.
 */
export interface SectionShellProps {
  slug: AdminSectionSlug;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function SectionShell({ slug, actions, toolbar, children }: SectionShellProps) {
  const meta = SECTION_META[slug];
  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title={meta.label}
          caption={meta.description}
          icon={meta.icon}
          actions={actions}
        />
        {toolbar ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {toolbar}
          </div>
        ) : null}
        <div>{children}</div>
      </PageSections>
    </PageContainer>
  );
}

/** Toolbar cell that grows to fill available width (typically the search). */
export function ToolbarGrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('sm:flex-1 sm:min-w-[220px]', className)}>{children}</div>;
}
