import type { ReactNode } from 'react';

import { ContentHeader } from '@/components/layout';
import { formatDateWith, useT, type MessageKey } from '@/i18n';

function greetingForHour(hour: number): MessageKey {
  if (hour < 12) return 'dashboard.greeting.morning';
  if (hour < 18) return 'dashboard.greeting.afternoon';
  return 'dashboard.greeting.evening';
}

export interface DashboardGreetingProps {
  /** Who is signed in, as the role's profile names them. */
  name: string;
  /** The role's workload line, appended after the date once it is known. */
  summary?: string | undefined;
  actions?: ReactNode;
}

/**
 * The welcome band a customizable dashboard opens with — "Good morning, Name",
 * today's date and the role's one-line workload summary. It is the page's
 * header and owns its single h1.
 *
 * It was the Doctor Overview's own markup, which is why the Admin Overview
 * opened on a generic "Overview" title instead: the band could not be reused
 * without a cross-feature import (§3.4). It lives here, beside the rest of the
 * shared dashboard pattern, so both roles draw the same band from one source —
 * the role supplies the name and the summary, nothing else.
 */
export function DashboardGreeting({ name, summary, actions }: DashboardGreetingProps) {
  const t = useT();
  const now = new Date();
  const today = formatDateWith(now, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    // One solid tone from the theme, no gradient: the brand tint the
    // gradient used to start from, laid flat.
    <div className="rounded-surface border border-border bg-primary-subtle px-4 py-4 md:px-5">
      <ContentHeader
        title={t(greetingForHour(now.getHours()), { name })}
        caption={summary === undefined ? today : `${today} · ${summary}`}
        actions={actions}
      />
    </div>
  );
}
