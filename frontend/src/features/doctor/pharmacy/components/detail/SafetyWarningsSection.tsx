import { Alert } from '@/components/feedback';

import {
  SAFETY_WARNING_KIND_META,
  SAFETY_WARNING_SEVERITY_META,
  type Prescription,
  type SafetyWarning,
} from '../../model/types';

import { EmptySectionNote, PharmacySectionCard } from './PharmacySectionCard';

/**
 * Safety features UI — frontend placeholders for drug-interaction,
 * allergy-conflict, duplicate-therapy, and dosage warnings. Each warning
 * renders as an inline `Alert`; critical warnings use the error variant
 * and are non-dismissible per the Design System healthcare-alert rules
 * (DS §8.22 — critical clinical alerts can never be dismissed). No AI
 * logic is implemented; the checks are canned placeholders.
 */

function WarningAlert({ warning }: { warning: SafetyWarning }) {
  const severity = SAFETY_WARNING_SEVERITY_META[warning.severity];
  const kind = SAFETY_WARNING_KIND_META[warning.kind];
  return (
    <Alert variant={severity.alert} critical={warning.severity === 'critical'} title={warning.title}>
      <p>
        <span className="font-medium text-text-primary">{kind.label}.</span> {warning.detail}
      </p>
    </Alert>
  );
}

export function SafetyWarningsSection({ prescription }: { prescription: Prescription }) {
  const { warnings } = prescription;

  return (
    <PharmacySectionCard
      title="Safety checks"
      caption="Automated interaction, allergy, duplicate-therapy, and dosage screening."
    >
      {warnings.length === 0 ? (
        <EmptySectionNote>
          No safety warnings were raised for this prescription.
        </EmptySectionNote>
      ) : (
        <div className="flex flex-col gap-3">
          {warnings.map((warning) => (
            <WarningAlert key={warning.id} warning={warning} />
          ))}
        </div>
      )}
    </PharmacySectionCard>
  );
}
