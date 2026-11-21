import { FlowStepper } from '@/components/patterns';

import { RECORD_STEPS, type RecordStepId } from '../../model/authoring';

/**
 * The record flow's stepper — now a thin binding over the shared
 * `FlowStepper`, promoted out of here and the pharmacy's copy when ordering
 * a lab became the third consumer (§8.2.1's rule of three). The behaviour
 * differences the two copies had drifted into are settled there.
 */
export interface RecordStepperProps {
  current: RecordStepId;
  furthestReached: RecordStepId;
  isStepValid: (step: RecordStepId) => boolean;
  isStepReachable: (step: RecordStepId) => boolean;
  onSelect: (step: RecordStepId) => void;
}

export function RecordStepper(props: RecordStepperProps) {
  return <FlowStepper steps={RECORD_STEPS} ariaLabel="Record steps" {...props} />;
}
