import { Building2 } from 'lucide-react';

import { useT } from '@/i18n';

import { useActiveHospital } from './useActiveHospital';

/**
 * The doctor's active hospital, read-only — WEB-1 (DR-02).
 *
 * The server resolves the hospital from the doctor's employment; this line
 * only shows it. It is not a control, and must never become one (WEB-2,
 * `app/no-hospital-switcher.test.ts`). While loading, with no hospital, or
 * on an error it renders nothing, so the account card does not shift and no
 * placeholder text is shown. The name is `dir="auto"`: hospital names may be
 * Arabic or Latin regardless of the interface language.
 */
export function ActiveHospital() {
  const t = useT();
  const hospital = useActiveHospital();
  if (hospital === null) return null;

  return (
    <p className="flex min-w-0 items-center gap-1 text-caption text-text-tertiary">
      <Building2 className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('shell.activeHospital')}</span>
      <span dir="auto" className="truncate">
        {hospital.name}
      </span>
    </p>
  );
}
