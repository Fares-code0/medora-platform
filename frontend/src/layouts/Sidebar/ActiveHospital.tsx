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

/**
 * The active hospital on the collapsed rail — WEB-1 (DR-02).
 *
 * The rail has no room for the account card's text, so the hospital is a
 * small building mark pinned to the avatar's top inline-end corner. It is
 * absolutely positioned and so takes no space: the rail does not move when
 * it appears. Assistive technology reads the same label and name as the
 * expanded line. It carries no native `title`: the collapsed rail shows no
 * hover labels anywhere (`AppSidebar.test.tsx`, "no hover labels"), so a
 * sighted user reads the name by expanding the sidebar. It is not a
 * control — no role, no tabindex, no handler — and renders nothing when
 * there is no hospital.
 */
export function ActiveHospitalMark() {
  const t = useT();
  const hospital = useActiveHospital();
  if (hospital === null) return null;

  return (
    <span
      data-active-hospital-mark=""
      className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-pill border border-border bg-surface text-text-tertiary"
    >
      <Building2 className="size-2.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">
        {t('shell.activeHospital')}
        {hospital.name}
      </span>
    </span>
  );
}
