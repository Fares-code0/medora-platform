import { Eye, EyeOff, Lock } from 'lucide-react';

import { Tooltip } from '@/components/ui';
import { cn } from '@/utils/cn';
import { maskPhi, PHI_FIELD_LABEL, type PhiFieldKind } from '@/utils/phi-mask';

import { formatExpiry } from './phi-access';
import { usePhiAccess } from './phi-context';

/**
 * A patient identifier in the admin area (ADM-10 · UX §1.5.6).
 *
 * Masked is the default and the *only* state this component can reach on
 * its own: unmasking requires a live grant from `PhiAccessProvider`, which
 * requires the capability, a justification, and a successful audit write.
 * Passing the clear value in is therefore safe — it is never rendered
 * without all three.
 *
 * `subjectId` groups the fields of one record: justify once for a queue
 * entry and its name, MRN and phone all unmask together, rather than
 * demanding a separate reason per field for the same decision.
 */
export interface MaskedIdentifierProps {
  subjectId: string;
  /** Non-identifying label for the prompt and the log, e.g. "Queue ticket A-104". */
  subjectLabel: string;
  kind: PhiFieldKind;
  value: string;
  className?: string;
}

export function MaskedIdentifier({
  subjectId,
  subjectLabel,
  kind,
  value,
  className,
}: MaskedIdentifierProps) {
  const { canReveal, isRevealed, grantOf, requestReveal, hide } = usePhiAccess();
  const revealed = isRevealed(subjectId);
  const grant = grantOf(subjectId);
  const fieldLabel = PHI_FIELD_LABEL[kind];

  const text = revealed ? value : maskPhi(kind, value);

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {/* The masked string is decorative noise to a screen reader, so the
          state is carried in text rather than left to the bullets. */}
      <span className={cn(!revealed && 'tabular-nums tracking-wide')}>
        {text}
        <span className="sr-only">
          {revealed ? ` — ${fieldLabel}, revealed` : ` — ${fieldLabel}, masked`}
        </span>
      </span>

      {!canReveal ? (
        <Tooltip content="Your role cannot reveal patient identifiers.">
          <span className="inline-flex">
            <Lock aria-hidden="true" className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={2} />
            <span className="sr-only">Revealing is not permitted for your role.</span>
          </span>
        </Tooltip>
      ) : revealed ? (
        <Tooltip content={grant ? `Re-masks at ${formatExpiry(grant)}` : 'Re-mask now'}>
          <button
            type="button"
            onClick={() => hide(subjectId)}
            aria-label={`Hide ${fieldLabel.toLowerCase()} for ${subjectLabel}`}
            className="hit-target touch-target inline-flex rounded text-text-tertiary [--touch-x:15px] [--touch-y:15px] transition-colors duration-fast hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <EyeOff aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </Tooltip>
      ) : (
        <Tooltip content="Reveal — requires a justification and is logged">
          <button
            type="button"
            onClick={() => requestReveal(subjectId, subjectLabel)}
            aria-label={`Reveal ${fieldLabel.toLowerCase()} for ${subjectLabel}`}
            className="hit-target touch-target inline-flex rounded text-text-tertiary [--touch-x:15px] [--touch-y:15px] transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <Eye aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </Tooltip>
      )}
    </span>
  );
}
