import { FlowStepper } from '@/components/patterns';

import { AUTHORING_STEPS, type AuthoringStepId } from '../../model/authoring';

/**
 * The prescription flow's stepper — now a thin binding over the shared
 * `FlowStepper`. This file wrote the original; medical records copied it,
 * and ordering a lab was the third consumer that triggered §8.2.1's rule of
 * three. Two behaviours that had drifted between the copies (whether the
 * furthest *reached* step shows as done, and whether an unreachable step is
 * `disabled` or merely `aria-disabled`) are settled in the shared component.
 */
export interface AuthoringStepperProps {
  current: AuthoringStepId;
  /** The furthest step reached, so completed markers are honest. */
  furthestReached: AuthoringStepId;
  /** Steps whose own fields validate; drives the "done" glyph. */
  isStepValid: (step: AuthoringStepId) => boolean;
  isStepReachable: (step: AuthoringStepId) => boolean;
  onSelect: (step: AuthoringStepId) => void;
}

export function AuthoringStepper(props: AuthoringStepperProps) {
  return <FlowStepper steps={AUTHORING_STEPS} ariaLabel="Prescription steps" {...props} />;
}
