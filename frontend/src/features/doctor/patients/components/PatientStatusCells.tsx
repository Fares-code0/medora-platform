import { StatusBadge } from '@/components/patterns';
import {
  PATIENT_STATUS_META,
  RISK_LEVEL_META,
  type PatientStatus,
  type RiskLevel,
} from '@/features/shared-domain/patient-identity';
import { useT } from '@/i18n';

/**
 * Status and risk cells for the patients table. Components rather than inline
 * column renderers so they can read the translator: the status vocabulary is
 * the shared one (`PATIENT_STATUS_META`, `RISK_LEVEL_META`) and renders from
 * its `labelKey`.
 */

export function PatientStatusCell({ status }: { status: PatientStatus }) {
  const t = useT();
  const meta = PATIENT_STATUS_META[status];
  return <StatusBadge status={meta.kind} label={t(meta.labelKey)} />;
}

export function PatientRiskCell({ level }: { level: RiskLevel }) {
  const t = useT();
  const meta = RISK_LEVEL_META[level];
  return <StatusBadge status={meta.kind} label={t(meta.labelKey)} />;
}
