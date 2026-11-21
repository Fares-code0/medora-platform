import { useEffect, useRef, useState } from 'react';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { Button, IconButton, Input } from '@/components/ui';

import {
  canAddPlanStep,
  withPlanStepAdded,
  withPlanStepMoved,
  withPlanStepRemoved,
  withPlanStepText,
  type PlanStepDraft,
} from '../model/record-edit';
import { RECORD_PLAN_STEP_MAX, RECORD_PLAN_STEPS_MAX } from '../model/record-service';

/**
 * The treatment plan as an ordered list of steps (API §6.4's
 * `treatmentPlan`): add, reword, reorder and remove. The order is the plan's
 * order — the server stores each step's position — so moving a step is an
 * edit like any other.
 *
 * Focus follows the step a control acted on: a new step's field takes focus,
 * a moved step keeps it on the same control, and removing a step hands focus
 * to "Add step" rather than dropping it on the page.
 */
export function TreatmentPlanEditor({
  steps,
  issues,
  onChange,
}: {
  steps: readonly PlanStepDraft[];
  /** Per step id. */
  issues: Readonly<Record<string, string>>;
  onChange: (steps: readonly PlanStepDraft[]) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  useEffect(() => {
    if (focusTarget === null) return;
    setFocusTarget(null);
    if (focusTarget === 'add') {
      addButton.current?.focus();
      return;
    }
    list.current?.querySelector<HTMLElement>(`[data-focus-key="${focusTarget}"]`)?.focus();
  }, [focusTarget]);

  const add = () => {
    const next = withPlanStepAdded(steps);
    onChange(next);
    const added = next.at(-1);
    if (next !== steps && added !== undefined) setFocusTarget(`${added.id}:text`);
  };

  const full = !canAddPlanStep(steps);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body-sm font-medium text-text-primary">Treatment plan</legend>
      {steps.length === 0 ? (
        <p className="text-body-sm text-text-secondary">No treatment plan on this record.</p>
      ) : (
        <ol ref={list} className="flex flex-col gap-2">
          {steps.map((step, index) => {
            const number = String(index + 1);
            return (
              <li key={step.id} className="flex items-start gap-2">
                <Input
                  label={`Step ${number}`}
                  containerClassName="min-w-0 flex-1"
                  data-focus-key={`${step.id}:text`}
                  maxLength={RECORD_PLAN_STEP_MAX}
                  value={step.text}
                  onChange={(event) =>
                    onChange(withPlanStepText(steps, step.id, event.target.value))
                  }
                  error={issues[step.id]}
                />
                {/* Aligned with the field, below its label. */}
                <span className="mt-6 flex shrink-0 items-center gap-1">
                  <IconButton
                    icon={ArrowUp}
                    size="sm"
                    aria-label={`Move step ${number} up`}
                    data-focus-key={`${step.id}:up`}
                    disabled={index === 0}
                    onClick={() => {
                      onChange(withPlanStepMoved(steps, step.id, 'up'));
                      setFocusTarget(index - 1 === 0 ? `${step.id}:down` : `${step.id}:up`);
                    }}
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="sm"
                    aria-label={`Move step ${number} down`}
                    data-focus-key={`${step.id}:down`}
                    disabled={index === steps.length - 1}
                    onClick={() => {
                      onChange(withPlanStepMoved(steps, step.id, 'down'));
                      setFocusTarget(
                        index + 1 === steps.length - 1 ? `${step.id}:up` : `${step.id}:down`,
                      );
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    aria-label={`Remove step ${number}`}
                    onClick={() => {
                      onChange(withPlanStepRemoved(steps, step.id));
                      setFocusTarget('add');
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={addButton}
          type="button"
          variant="secondary"
          size="sm"
          leadingIcon={Plus}
          disabled={full}
          onClick={add}
        >
          Add step
        </Button>
        {full ? (
          <p className="text-caption text-text-tertiary">
            A plan holds at most {RECORD_PLAN_STEPS_MAX} steps.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
