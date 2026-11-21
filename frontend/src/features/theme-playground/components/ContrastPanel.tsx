import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { Badge, Button } from '@/components/ui';

import type { ContrastFinding } from '../model/contrast-rules';
import type { WebToken } from '../model/tokens';
import type { Mode } from '../model/usePlayground';

export interface ContrastPanelProps {
  readonly mode: Mode;
  readonly findings: readonly ContrastFinding[];
  readonly onApply: (token: WebToken, value: string) => void;
}

/**
 * Accessibility findings for the palette being edited. A failure shows the
 * measured ratio, the tokens involved and — when one exists — a nearby value
 * that passes. The suggestion is applied ONLY by pressing its button: the
 * playground never rewrites a colour you chose.
 */
export function ContrastPanel({ mode, findings, onApply }: ContrastPanelProps) {
  const fails = findings.filter((f) => f.severity === 'fail');
  const warns = findings.filter((f) => f.severity === 'warn');

  return (
    <section aria-label={`Accessibility checks, ${mode} mode`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-h5 font-semibold text-text-primary">Accessibility ({mode})</h3>
        {fails.length === 0 ? (
          <Badge variant="success" icon={CheckCircle2}>
            WCAG AA: all checks pass
          </Badge>
        ) : (
          <Badge variant="error" icon={XCircle}>
            {`${String(fails.length)} contrast failure${fails.length === 1 ? '' : 's'}`}
          </Badge>
        )}
        {warns.length > 0 ? (
          <Badge variant="warning" icon={AlertTriangle} emphasis="outline">
            {`${String(warns.length)} warning${warns.length === 1 ? '' : 's'}`}
          </Badge>
        ) : null}
      </div>
      <p className="text-caption text-text-tertiary">
        Text 4.5:1 · UI boundaries, focus and chart edges 3:1 — the thresholds the contrast test suites enforce.
      </p>

      {findings.length > 0 ? (
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto">
          {[...fails, ...warns].map((finding) => {
            const target = finding.tokens[0];
            return (
              <li
                key={finding.id}
                className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface-sunken px-2.5 py-2"
              >
                {finding.severity === 'fail' ? (
                  <XCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-error" />
                ) : (
                  <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
                )}
                <span className="min-w-0 flex-1 text-caption text-text-primary">{finding.message}</span>
                {finding.suggestion && target ? (
                  <Button size="sm" variant="secondary" onClick={() => onApply(target, finding.suggestion ?? '')}>
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 rounded-pill border border-border-strong"
                      style={{ background: finding.suggestion }}
                    />
                    {`Use ${finding.suggestion}`}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
