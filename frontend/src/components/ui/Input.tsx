import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

import { AlertCircle, type LucideIcon } from 'lucide-react';

import { FieldWrapper, useFieldA11y } from './internal/Field';
import { fieldInputClasses, type FieldSize } from './internal/styles';

/**
 * Input (text field) — DS §8.2.
 * Every input has a visible label — placeholders are never labels. Error
 * messages state how to fix, replace the helper text, and render with
 * role="alert" plus the alert-circle icon inside the field.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string | undefined;
  helperText?: string | undefined;
  error?: string | undefined;
  /** `lg` (48px) is for patient-facing forms; default `md` is 40px. */
  size?: FieldSize | undefined;
  /** Decorative icons (20px); interactive trailing content goes in `trailingElement`. */
  leadingIcon?: LucideIcon | undefined;
  trailingIcon?: LucideIcon | undefined;
  /** Interactive trailing slot (e.g. a visibility toggle); replaces `trailingIcon`. */
  trailingElement?: ReactNode | undefined;
  containerClassName?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    size = 'md',
    leadingIcon: LeadingIcon,
    trailingIcon: TrailingIcon,
    trailingElement,
    containerClassName,
    className,
    id,
    required,
    disabled,
    ...rest
  },
  ref,
) {
  const { inputId, helperId, errorId } = useFieldA11y(id);
  const invalid = Boolean(error);
  const hasTrailing = Boolean(trailingElement) || Boolean(TrailingIcon) || invalid;

  return (
    <FieldWrapper
      inputId={inputId}
      helperId={helperId}
      errorId={errorId}
      label={label}
      required={required}
      helperText={helperText}
      error={error}
      disabled={disabled}
      className={containerClassName}
    >
      <div className="relative">
        {LeadingIcon ? (
          <LeadingIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-tertiary"
            strokeWidth={1.75}
          />
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={fieldInputClasses({
            size,
            invalid,
            leading: Boolean(LeadingIcon),
            trailing: hasTrailing,
            className,
          })}
          {...rest}
        />
        {trailingElement ??
          (invalid ? (
            <AlertCircle
              aria-hidden="true"
              className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-error"
              strokeWidth={1.75}
            />
          ) : TrailingIcon ? (
            <TrailingIcon
              aria-hidden="true"
              className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-tertiary"
              strokeWidth={1.75}
            />
          ) : null)}
      </div>
    </FieldWrapper>
  );
});
