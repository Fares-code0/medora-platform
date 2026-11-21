import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { FlowStepper, type FlowStep } from './FlowStepper';

/**
 * A multi-step flow's step list. Position and state reach a reader as text
 * ("Step 2 of 4", done, locked), never by colour alone; the current step is
 * `aria-current="step"`, and an unreachable one cannot be selected.
 */
type StepId = 'patient' | 'medication' | 'safety' | 'review';

const STEPS: readonly FlowStep<StepId>[] = [
  { id: 'patient', label: 'Patient', caption: 'Who it is for' },
  { id: 'medication', label: 'Medication', caption: 'Drug, dose, frequency' },
  { id: 'safety', label: 'Safety check', caption: 'Interactions and allergies' },
  { id: 'review', label: 'Review', caption: 'Sign and issue' },
];

const ORDER = STEPS.map((step) => step.id);

function Flow({ start, furthest }: { start: StepId; furthest: StepId }) {
  const [current, setCurrent] = useState<StepId>(start);
  const reach = ORDER.indexOf(furthest);
  return (
    <FlowStepper
      steps={STEPS}
      current={current}
      furthestReached={furthest}
      isStepValid={(step) => ORDER.indexOf(step) < reach}
      isStepReachable={(step) => ORDER.indexOf(step) <= reach}
      onSelect={setCurrent}
      ariaLabel="Prescription steps"
    />
  );
}

const meta = {
  title: 'Patterns/FlowStepper',
  component: FlowStepper,
  args: {
    steps: STEPS,
    current: 'patient',
    furthestReached: 'patient',
    isStepValid: () => false,
    isStepReachable: (step: string) => step === 'patient',
    onSelect: () => {},
    ariaLabel: 'Prescription steps',
  },
} satisfies Meta<typeof FlowStepper<StepId>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstStep: Story = { render: () => <Flow start="patient" furthest="patient" /> };

export const MidFlow: Story = { render: () => <Flow start="safety" furthest="safety" /> };

export const RevisitingEarlierStep: Story = {
  render: () => <Flow start="medication" furthest="review" />,
};
