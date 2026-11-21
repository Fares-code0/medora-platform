import { PenLine, Save } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Fact, FactGrid } from '@/components/patterns';
import { Button, Card } from '@/components/ui';

import type { CompleteDraft } from '../../model/authoring';
import { SIGN_BLOCKED_META, type SignabilityResult } from '../../model/safety-check';

/**
 * Step 4 — Review & sign.
 *
 * The sign control is rendered from `signability.signable`, and it is
 * **absent** rather than disabled when that is null. A disabled button is a
 * control that exists; someone refactoring the disabled expression, or a
 * test driving `click` past `pointer-events`, re-enables it. Here there is
 * no button to re-enable, and even if one were added it would have nothing
 * to pass: `onSign` takes a `SignablePrescription`, whose only producer is
 * `assessSignability`.
 */

export interface ReviewStepProps {
  draft: CompleteDraft;
  signability: SignabilityResult;
  onSign: (signable: NonNullable<SignabilityResult['signable']>) => void;
  onSaveDraft: () => void;
  signing: boolean;
  savingDraft: boolean;
  /** Whether signing reaches the prescribing service (`capabilities.transmits`). */
  transmits: boolean;
}

export function ReviewStep({
  draft,
  signability,
  onSign,
  onSaveDraft,
  signing,
  savingDraft,
  transmits,
}: ReviewStepProps) {
  const { signable } = signability;

  return (
    <Stack gap={4}>
      <Card title="Prescription summary" headingAs="h3" padding="compact">
        <FactGrid columns={2}>
          <Fact label="Patient">
            {draft.patient.name} · MRN {draft.patient.mrn}
          </Fact>
          <Fact label="Medication">
            {draft.spec.name} ({draft.spec.genericName})
          </Fact>
          <Fact label="Dose">{draft.strength}</Fact>
          <Fact label="Frequency">{draft.frequency}</Fact>
          <Fact label="Route">{draft.spec.route}</Fact>
          <Fact label="Duration">
            <span dir="ltr">{draft.durationDays} days</span>
          </Fact>
          <Fact label="Quantity">{draft.quantity}</Fact>
          <Fact label="Refills">{draft.refillsAllowed}</Fact>
        </FactGrid>
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
            Instructions
          </p>
          <p className="mt-0.5 text-body-sm text-text-primary">{draft.instructions}</p>
        </div>
      </Card>

      {signable === null ? (
        <Alert variant="warning" title="This prescription cannot be signed yet">
          <p>{SIGN_BLOCKED_META[signability.blockedBy]}</p>
          <p className="mt-1">
            The signing control appears only once the safety screen has completed and every warning
            it raised has been acknowledged.
          </p>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {signable === null ? null : (
          <Button leadingIcon={PenLine} loading={signing} onClick={() => onSign(signable)}>
            Sign &amp; issue
          </Button>
        )}
        <Button variant="secondary" leadingIcon={Save} loading={savingDraft} onClick={onSaveDraft}>
          Save as draft
        </Button>
      </div>

      {/* No fake success state: what signing does is said before the doctor
          signs, not only after — and it is said from the adapter in use. */}
      <p className="text-caption text-text-tertiary">
        {transmits
          ? 'Signing sends this prescription to the prescribing service, which re-runs the safety screen before issuing it and refuses it if anything has changed.'
          : 'Signing records the prescription in this session only. No pharmacy system is connected to this build, so nothing is transmitted to a dispenser.'}
      </p>
    </Stack>
  );
}
