import { CheckCircle2, Circle, Sparkles } from 'lucide-react';

import { Progress } from '@/components/feedback';

import type { ProfileCompletion } from '../model/selectors';

/**
 * Profile completion widget — a percentage ring-style progress bar over the
 * list of missing fields with a one-line recommendation each. Purely
 * derived from the profile (via `selectProfileCompletion`), so it updates
 * the instant a field is filled and saved.
 */
export interface ProfileCompletionWidgetProps {
  completion: ProfileCompletion;
}

export function ProfileCompletionWidget({ completion }: ProfileCompletionWidgetProps) {
  const { percent, missing } = completion;
  const complete = missing.length === 0;

  return (
    <div className="rounded-surface border border-border bg-gradient-to-b from-primary-subtle to-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-surface bg-primary-subtle text-primary"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <h3 className="text-h5 font-semibold text-text-primary">Profile completion</h3>
        </div>
        <span className="text-h4 font-semibold text-primary tabular-nums">{percent}%</span>
      </div>

      <div className="mt-3">
        <Progress value={percent} aria-label="Profile completion" />
      </div>

      {complete ? (
        <p className="mt-4 flex items-center gap-2 text-body-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Your profile is complete — nicely done.
        </p>
      ) : (
        <div className="mt-4">
          <p className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
            Recommended next
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {missing.slice(0, 4).map((field) => (
              <li key={field.label} className="flex items-start gap-2">
                <Circle
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-disabled"
                  strokeWidth={2}
                />
                <span className="text-caption text-text-secondary">
                  <span className="font-medium text-text-primary">{field.label}.</span>
                  {''}
                  {field.recommendation}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
