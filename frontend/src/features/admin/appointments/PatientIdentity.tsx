import type { PhiFieldKind } from '@/utils/phi-mask';

import { MaskedIdentifier } from '../phi';

/**
 * A patient identifier on an oversight surface (FE-10.10).
 *
 * The demo store holds the clear value and the ADM-10 gate decides whether
 * to show it. The live API never sends it — the oversight row carries the
 * patient's handle only — so there is no value to gate, and a masked string
 * would pretend there was. That case says plainly that the server withholds
 * it.
 */
export function PatientIdentity({
  subjectId,
  subjectLabel,
  kind,
  value,
}: {
  subjectId: string;
  subjectLabel: string;
  kind: PhiFieldKind;
  value: string | null;
}) {
  if (value === null) {
    return (
      <span className="text-text-secondary">
        Withheld
        <span className="sr-only"> — the server does not send patient identifiers here</span>
      </span>
    );
  }
  return (
    <MaskedIdentifier subjectId={subjectId} subjectLabel={subjectLabel} kind={kind} value={value} />
  );
}
