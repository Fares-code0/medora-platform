import { TriangleAlert } from 'lucide-react';

import { StatusBadge } from '@/components/patterns';
import { Avatar, Badge, Tooltip } from '@/components/ui';
import { useT } from '@/i18n';

import {
  PRESCRIPTION_STATUS_META,
  REFILL_STATUS_META,
  highestWarningSeverity,
  type PrescriptionSummary,
} from '../model/types';

/**
 * Small presentational cells shared by the table, the mobile cards, and
 * the detail page — one implementation per visual (no duplicated UI).
 */

export function PrescriptionPatientCell({ prescription }: { prescription: PrescriptionSummary }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={prescription.patient.name} size="sm" decorative />
      <div className="min-w-0">
        <p className="truncate text-body-sm font-medium text-text-primary">
          {prescription.patient.name}
        </p>
        <p className="text-caption text-text-tertiary">
          <span dir="ltr">
            {prescription.patient.age} · {prescription.patient.gender === 'female' ? 'F' : 'M'}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Warning marker — highest-severity safety flag on the prescription. */
export function PrescriptionWarningMarker({ prescription }: { prescription: PrescriptionSummary }) {
  const severity = highestWarningSeverity(prescription);
  if (severity === null || severity === 'info') return null;
  const count = prescription.warnings.length;
  const label = `${String(count)} safety warning${count === 1 ? '' : 's'}`;
  return (
    <Tooltip content={label}>
      <span
        className={severity === 'critical' ? 'text-error' : 'text-warning'}
        role="img"
        aria-label={label}
      >
        <TriangleAlert className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

export function MedicationCell({ prescription }: { prescription: PrescriptionSummary }) {
  const { medication } = prescription;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="truncate text-body-sm font-medium text-text-primary">{medication.name}</p>
        <PrescriptionWarningMarker prescription={prescription} />
      </div>
      <p className="text-caption text-text-tertiary">
        {medication.genericName} · {medication.form}
      </p>
    </div>
  );
}

export function MedicationFlags({ prescription }: { prescription: PrescriptionSummary }) {
  const { medication } = prescription;
  if (!medication.isHighRisk && !medication.isControlled) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {medication.isHighRisk ? (
        <Badge variant="warning" emphasis="outline" icon={TriangleAlert}>
          High-risk
        </Badge>
      ) : null}
      {medication.isControlled ? <Badge variant="neutral">Controlled</Badge> : null}
    </div>
  );
}

export function PrescriptionStatusBadge({ prescription }: { prescription: PrescriptionSummary }) {
  const t = useT();
  const meta = PRESCRIPTION_STATUS_META[prescription.status];
  return <StatusBadge status={meta.kind} label={t(meta.labelKey)} />;
}

export function RefillStatusBadge({ prescription }: { prescription: PrescriptionSummary }) {
  const t = useT();
  const meta = REFILL_STATUS_META[prescription.refillStatus];
  return <StatusBadge status={meta.kind} label={t(meta.labelKey)} />;
}
