import {
  Activity,
  KeyRound,
  LogIn,
  Plug,
  Settings2,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui';

import { SettingsCard } from '../components/SettingsCard';
import { formatDateTime } from '../model/selectors';
import { ACTIVITY_KIND_LABELS, type ActivityKind, type SettingsDocument } from '../model/types';

/**
 * Activity log section — a read-only, reverse-chronological feed of recent
 * account actions (profile edits, password changes, sign-ins, settings and
 * integration changes). It's a live reflection of the settings document:
 * every mutation in this Center appends an entry through the mock service.
 */

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  profile: UserRound,
  password: KeyRound,
  login: LogIn,
  settings: Settings2,
  security: ShieldCheck,
  integration: Plug,
  privacy: ShieldCheck,
};

const KIND_VARIANT: Record<ActivityKind, 'neutral' | 'info' | 'success' | 'warning'> = {
  profile: 'info',
  password: 'warning',
  login: 'neutral',
  settings: 'neutral',
  security: 'success',
  integration: 'info',
  privacy: 'success',
};

export function ActivitySection({ document }: { document: SettingsDocument }) {
  return (
    <SettingsCard
      title="Recent activity"
      description="Account actions from the last few weeks, newest first."
      icon={Activity}
      flush
    >
      <ol className="px-5">
        {document.activity.map((entry, index) => {
          const Icon = KIND_ICON[entry.kind];
          const last = index === document.activity.length - 1;
          return (
            <li key={entry.id} className="flex gap-3">
              {/* Timeline rail */}
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className="mt-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-text-secondary"
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                {!last ? <span aria-hidden="true" className="w-px flex-1 bg-border" /> : null}
              </div>
              <div className={`min-w-0 flex-1 py-4 ${last ? '' : 'border-b border-border'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body-sm font-medium text-text-primary">{entry.summary}</p>
                  <Badge variant={KIND_VARIANT[entry.kind]}>
                    {ACTIVITY_KIND_LABELS[entry.kind]}
                  </Badge>
                </div>
                {entry.detail ? (
                  <p className="mt-0.5 text-caption text-text-secondary">{entry.detail}</p>
                ) : null}
                <time className="mt-0.5 block text-caption text-text-tertiary">
                  {formatDateTime(entry.at)}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    </SettingsCard>
  );
}
