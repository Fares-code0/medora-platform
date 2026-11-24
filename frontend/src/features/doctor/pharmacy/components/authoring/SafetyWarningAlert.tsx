import { Alert } from '@/components/feedback';
import { StatusBadge } from '@/components/patterns';
import { Checkbox } from '@/components/ui';
import { useT } from '@/i18n';

import type { AuthoringSafetyWarning } from '../../model/safety-check';
import { SAFETY_EVIDENCE_META } from '../../model/safety-check';
import { SAFETY_WARNING_KIND_META, SAFETY_WARNING_SEVERITY_META } from '../../model/types';

/**
 * One safety warning, in the visual language `detail/SafetyWarningsSection`
 * already established — same `Alert` variant per severity, same
 * kind-label-then-detail body — so a warning looks the same wherever it
 * appears. What authoring adds is the three things a doctor about to sign
 * needs and a reader of a filed prescription does not: what it was found
 * *against*, whether it can be overridden, and an acknowledgment tick.
 *
 * **Severity is never carried by hue alone** (ADR-0001 §9). Three channels
 * agree on every warning: the `Alert` border and its per-variant glyph, a
 * `StatusBadge` whose text spells the severity out, and the kind label in
 * the body. A monochrome reader loses nothing.
 */

export interface SafetyWarningAlertProps {
  warning: AuthoringSafetyWarning;
  /** Rendered when the warning needs an explicit tick before signing. */
  acknowledgement?: {
    readonly checked: boolean;
    readonly onToggle: () => void;
  };
}

export function SafetyWarningAlert({ warning, acknowledgement }: SafetyWarningAlertProps) {
  const t = useT();
  const severity = SAFETY_WARNING_SEVERITY_META[warning.severity];
  const kind = SAFETY_WARNING_KIND_META[warning.kind];
  const evidence = SAFETY_EVIDENCE_META[warning.source];

  return (
    <Alert
      variant={severity.alert}
      critical={warning.severity === 'critical'}
      title={warning.title}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={severity.kind}
            label={t('rx.severityBadge', { severity: t(severity.labelKey) })}
          />
          <StatusBadge status="info" label={t(kind.labelKey)} />
          {warning.blocking ? (
            <StatusBadge status="critical" label={t('rx.cannotOverride')} />
          ) : null}
        </div>

        <p>{warning.detail}</p>

        {warning.against.length > 0 ? (
          <p className="text-caption text-text-secondary">
            <span className="font-medium text-text-primary">{t('rx.foundAgainst')}</span>{' '}
            {warning.against.join(' · ')}
          </p>
        ) : null}

        {/* Provenance rendered FROM the warning, not hand-placed beside it
            (DX-10): it cannot be deleted while the finding stays fake, and it
            disappears by itself when a real service answers. */}
        {evidence.isDemo ? (
          <p className="text-caption text-text-tertiary">
            <span className="font-medium">{t(evidence.labelKey)}.</span> {t(evidence.detailKey)}
          </p>
        ) : null}

        {acknowledgement ? (
          <Checkbox
            checked={acknowledgement.checked}
            onChange={acknowledgement.onToggle}
            label={t('rx.acknowledge', {
              severity: t(severity.labelKey).toLowerCase(),
              kind: t(kind.labelKey).toLowerCase(),
            })}
            containerClassName="mt-1"
          />
        ) : null}
      </div>
    </Alert>
  );
}
