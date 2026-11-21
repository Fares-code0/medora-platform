import { TriangleAlert } from 'lucide-react';

import { Avatar } from '@/components/ui';
import type { Patient } from '@/features/shared-domain/patient-identity';

/**
 * Avatar + name cell shared by the table and the mobile cards. The
 * severe-allergy indicator sits beside the name (UX 2.2) and is never
 * color-only — the icon carries screen-reader text.
 */
export function PatientNameCell({ patient }: { patient: Patient }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={patient.name} size="sm" decorative />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">{patient.name}</span>
        {patient.hasSevereAllergy ? (
          <span className="shrink-0 text-error">
            <TriangleAlert aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            <span className="sr-only">Severe allergies on record</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}
