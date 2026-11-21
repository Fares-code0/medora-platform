import { forwardRef, useEffect, useRef } from 'react';
import type { InputHTMLAttributes } from 'react';

import { Check, Minus } from 'lucide-react';

import { cn } from '@/utils/cn';

import { useFieldA11y } from './internal/Field';

/**
 * Checkbox — DS §8.5.
 * 18×18 box, radius xs, 2px border; checked/indeterminate fill primary-fill,
 * tick in primary-fill-text (ADR-0005).
 * The label is clickable; the focus ring lands on the box only; the touch
 * target extends to 44px via label padding on touch layouts.
 */
export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> {
  label?: string | undefined;
  description?: string | undefined;
  /** Mixed state for select-all headers; communicated via aria-checked. */
  indeterminate?: boolean | undefined;
  error?: string | undefined;
  containerClassName?: string | undefined;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    label,
    description,
    indeterminate = false,
    error,
    containerClassName,
    className,
    id,
    disabled,
    ...rest
  },
  ref,
) {
  const { inputId, errorId } = useFieldA11y(id);
  const innerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className={cn('flex flex-col', containerClassName)}>
      <label
        htmlFor={inputId}
        className={cn(
          'inline-flex items-start gap-2 touch:items-center',
          disabled && 'cursor-not-allowed',
        )}
      >
        {/*
          The visual box stays 18px, but the TARGET is 24x24 (WCAG 2.5.8) via
          a transparent overlay. It hangs on this span rather than the input
          because `::before` does not render on replaced elements, and the
          span is inside the label, so a click on the overlay still bubbles
          to the label and toggles the control. Anchored here rather than on
          the label itself so a checkbox WITH visible text does not centre a
          24px target on the whole caption.

          This is not cosmetic: in a dense table the checkbox sits inside a
          row that navigates on click, so a near-miss does not merely fail to
          select — it opens the wrong patient's record.
        */}
        {/*
          On a coarse pointer the box reserves 13px all round, 44px in all
          (DEC-008, `.touch-target`); `touch:mt-[13px]` restores the top
          gutter the `mt-0.5` alignment nudge would otherwise take.
        */}
        <span className="touch-target relative mt-0.5 inline-flex shrink-0 [--touch-x:13px] [--touch-y:13px] touch:mt-[13px] before:absolute before:start-1/2 before:top-1/2 before:h-6 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] before:rtl:translate-x-1/2">
          <input
            ref={(node) => {
              innerRef.current = node;
              if (typeof ref === 'function') ref(node);
              else if (ref) ref.current = node;
            }}
            id={inputId}
            type="checkbox"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              'peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-control border-2 border-border-strong bg-surface',
              'transition-colors duration-base ease-out',
              'checked:border-primary-fill checked:bg-primary-fill indeterminate:border-primary-fill indeterminate:bg-primary-fill',
              'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken',
              error && 'border-error',
              className,
            )}
            {...rest}
          />
          <Check
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-primary-fill-text opacity-0 transition-opacity duration-fast peer-checked:opacity-100 peer-indeterminate:opacity-0"
          />
          <Minus
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-primary-fill-text opacity-0 transition-opacity duration-fast peer-indeterminate:opacity-100"
          />
        </span>
        {label ? (
          <span className="flex flex-col">
            <span
              className={cn(
                'text-body-sm font-medium',
                disabled ? 'text-text-disabled' : 'text-text-primary',
              )}
            >
              {label}
            </span>
            {description ? (
              <span className="text-caption text-text-secondary">{description}</span>
            ) : null}
          </span>
        ) : null}
      </label>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-caption text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
});
