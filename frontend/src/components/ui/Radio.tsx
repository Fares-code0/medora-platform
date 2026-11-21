import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/utils/cn';

import { useFieldA11y } from './internal/Field';

/**
 * Radio + RadioGroup — DS §8.6.
 * Grouped in fieldset/legend; vertical stack with 12px gap (horizontal
 * allowed for ≤3 short options). Arrow-key movement inside the group is
 * native radio behavior. Use radios for 2–5 options; Select above 5.
 */

interface RadioGroupContextValue {
  readonly name: string;
  readonly value: string | null;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  /** Rendered as the group's legend. */
  label: string;
  name: string;
  value: string | null;
  onChange: (value: string) => void;
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  error?: string | undefined;
  helperText?: string | undefined;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function RadioGroup({
  label,
  name,
  value,
  onChange,
  orientation = 'vertical',
  disabled = false,
  error,
  helperText,
  required = false,
  className,
  children,
}: RadioGroupProps) {
  const { inputId, helperId, errorId } = useFieldA11y();

  return (
    /*
     * `radiogroup`, not the fieldset's implicit `group`: ARIA allows
     * `aria-required` and `aria-invalid` on a radiogroup and not on a group,
     * so as a bare fieldset a required group carried an attribute assistive
     * technology may ignore (axe `aria-allowed-attr`, critical, on the
     * prescribing flow's patient step). HTML-ARIA permits the role on a
     * fieldset, and the legend still names it.
     */
    <fieldset
      role="radiogroup"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : helperText ? helperId : undefined}
      aria-required={required || undefined}
      className={cn('flex flex-col', className)}
      id={inputId}
    >
      <legend className="mb-1.5 text-body-sm font-medium text-text-secondary">
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-0.5 text-error">
            *
          </span>
        ) : null}
      </legend>
      <div
        className={cn(
          'flex',
          orientation === 'vertical' ? 'flex-col gap-3' : 'flex-row flex-wrap gap-6',
        )}
      >
        <RadioGroupContext.Provider value={{ name, value, onChange, disabled }}>
          {children}
        </RadioGroupContext.Provider>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-caption text-error">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="mt-1.5 text-caption text-text-secondary">
          {helperText}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface RadioProps {
  value: string;
  label: string;
  description?: string | undefined;
  disabled?: boolean;
  className?: string;
}

export function Radio({ value, label, description, disabled = false, className }: RadioProps) {
  const group = useContext(RadioGroupContext);
  if (!group) throw new Error('Radio must be used within a RadioGroup');
  const isDisabled = disabled || group.disabled;
  const { inputId } = useFieldA11y();

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex items-start gap-2 touch:items-center',
        isDisabled && 'cursor-not-allowed',
        className,
      )}
    >
      {/* 12px all round on a coarse pointer: a 44px target (DEC-008). */}
      <span className="touch-target relative mt-0.5 inline-flex shrink-0 [--touch-x:12px] [--touch-y:12px] touch:mt-[12px]">
        <input
          id={inputId}
          type="radio"
          name={group.name}
          value={value}
          checked={group.value === value}
          disabled={isDisabled}
          onChange={() => group.onChange(value)}
          className={cn(
            'peer h-5 w-5 cursor-pointer appearance-none rounded-pill border-2 border-border-strong bg-surface',
            'transition-colors duration-base ease-out checked:border-primary-fill',
            'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken',
          )}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto h-2.5 w-2.5 scale-0 rounded-pill bg-primary-fill transition-transform duration-fast ease-out peer-checked:scale-100 peer-disabled:bg-text-disabled"
        />
      </span>
      <span className="flex flex-col">
        <span
          className={cn(
            'text-body-sm font-medium',
            isDisabled ? 'text-text-disabled' : 'text-text-primary',
          )}
        >
          {label}
        </span>
        {description ? (
          <span className="text-caption text-text-secondary">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
