import { Check, Lock } from 'lucide-react';

import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * The multi-step authoring stepper (DS §8.24).
 *
 * **Promoted by the rule of three (§8.2.1).** The pharmacy wrote it for
 * prescriptions, medical records copied it, and both left a note saying the
 * third consumer should extract it — "two is where you find out which parts
 * are actually shared". Ordering a lab is the third.
 *
 * The two copies had already drifted, which is the argument for extracting
 * made concrete: they disagreed about whether the furthest step you have
 * *reached* counts as done, and they disagreed about whether an unreachable
 * step is `disabled` or only `aria-disabled`. Both are settled here, once.
 *
 * It is an ordered list of real buttons, not a decorative rail: the flow is
 * navigable by keyboard alone, a screen reader is told the position ("Step 2
 * of 4") and the state, and state is never carried by colour alone
 * (ADR-0001) — done steps take a check glyph, unreachable ones a padlock,
 * and the current one is `aria-current="step"`.
 */

export interface FlowStep<TId extends string> {
  readonly id: TId;
  readonly label: string;
  readonly caption: string;
}

export interface FlowStepperProps<TId extends string> {
  readonly steps: readonly FlowStep<TId>[];
  readonly current: TId;
  /** The furthest step reached, so completed markers are honest. */
  readonly furthestReached: TId;
  /** Steps whose own fields validate; drives the "done" glyph. */
  readonly isStepValid: (step: TId) => boolean;
  readonly isStepReachable: (step: TId) => boolean;
  readonly onSelect: (step: TId) => void;
  /** Names the flow, e.g. "Prescription steps". */
  readonly ariaLabel: string;
}

export function FlowStepper<TId extends string>({
  steps,
  current,
  furthestReached,
  isStepValid,
  isStepReachable,
  onSelect,
  ariaLabel,
}: FlowStepperProps<TId>) {
  const t = useT();
  const indexOf = (id: TId) => steps.findIndex((step) => step.id === id);

  return (
    <nav aria-label={ariaLabel}>
      <ol className="flex flex-col gap-1 sm:flex-row sm:items-stretch sm:gap-2">
        {steps.map((step, index) => {
          const isCurrent = step.id === current;
          const reachable = isStepReachable(step.id);
          /*
           * Strictly before the furthest step, not up to it. The two copies
           * disagreed here and the stricter reading is the honest one:
           * reaching a step is not completing it. The clearest case is a
           * review step — its fields can validate while the thing it exists
           * to do (sign, submit) has not happened, and a check glyph there
           * would say otherwise.
           */
          const done = !isCurrent && index < indexOf(furthestReached) && isStepValid(step.id);

          return (
            <li key={step.id} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => {
                  onSelect(step.id);
                }}
                aria-current={isCurrent ? 'step' : undefined}
                aria-disabled={!reachable}
                disabled={!reachable}
                className={cn(
                  'flex w-full items-start gap-3 rounded-surface border p-3 text-start',
                  'transition-colors duration-fast ease-out',
                  'disabled:cursor-not-allowed',
                  isCurrent
                    ? 'border-primary bg-primary-subtle'
                    : reachable
                      ? 'border-border bg-surface hover:bg-surface-sunken'
                      : 'border-border bg-surface-sunken',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-caption font-semibold',
                    isCurrent
                      ? 'bg-primary text-text-inverse'
                      : done
                        ? 'bg-success text-text-inverse'
                        : 'bg-surface-sunken text-text-tertiary ring-1 ring-border',
                  )}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  ) : reachable ? (
                    index + 1
                  ) : (
                    <Lock className="h-3 w-3" strokeWidth={2} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-medium text-text-primary">
                    {step.label}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {step.caption}
                  </span>
                  {/*
                   * Position and state as VISIBLE text, not sr-only. The two
                   * copies disagreed here too — pharmacy showed it, records
                   * hid it — and showing it is what ADR-0001's "never state
                   * by colour alone" actually asks for: a sighted user
                   * reading a marker's colour is exactly who the rule is
                   * about. Secondary, not tertiary — the original pharmacy
                   * copy had it that way and was right: state announced in
                   * the faintest tint is state a reader skips, which is the
                   * failure the rule exists to prevent. The caption above is
                   * kept because it says what the step is *for*, which the
                   * position does not.
                   */}
                  {/*
                    F-19: "Step 2 of 4" is one message with two placeholders,
                    not a sentence assembled from fragments. Turkish suffixes
                    and Arabic word order both move the pieces, so a
                    concatenation that reads correctly in English cannot be
                    made to read correctly elsewhere.
                  */}
                  <span className="block truncate text-caption text-text-secondary">
                    {t('flow.stepOf', { step: index + 1, total: steps.length })}
                    {done
                      ? ` · ${t('flow.complete')}`
                      : isCurrent
                        ? ` · ${t('flow.current')}`
                        : reachable
                          ? ''
                          : ` · ${t('flow.locked')}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
