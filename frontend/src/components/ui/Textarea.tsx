import { forwardRef, useState } from 'react';
import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

import { FieldWrapper, useFieldA11y } from './internal/Field';
import { fieldInputClasses } from './internal/styles';

/**
 * Textarea — DS §8.3.
 * Inherits input styling; min-height 96px (3 rows), vertical resize only.
 * Optional character counter (caption, bottom-right) that turns error-red
 * when the value exceeds `maxLength` while `enforceMaxLength` is off.
 */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string | undefined;
  helperText?: string | undefined;
  error?: string | undefined;
  /** Render a character counter; requires `maxLength`. */
  showCount?: boolean | undefined;
  /** When false, `maxLength` is advisory (counter can exceed). Default true. */
  enforceMaxLength?: boolean | undefined;
  containerClassName?: string | undefined;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    helperText,
    error,
    showCount = false,
    enforceMaxLength = true,
    containerClassName,
    className,
    id,
    required,
    disabled,
    maxLength,
    rows,
    onChange,
    defaultValue,
    value,
    ...rest
  },
  ref,
) {
  const { inputId, helperId, errorId } = useFieldA11y(id);
  const invalid = Boolean(error);
  const [uncontrolledLength, setUncontrolledLength] = useState(
    typeof defaultValue === 'string' ? defaultValue.length : 0,
  );
  const length = typeof value === 'string' ? value.length : uncontrolledLength;
  const overLimit = maxLength !== undefined && length > maxLength;

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
      <textarea
        ref={ref}
        id={inputId}
        rows={rows ?? 3}
        required={required}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        maxLength={enforceMaxLength ? maxLength : undefined}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        onChange={(event) => {
          setUncontrolledLength(event.target.value.length);
          onChange?.(event);
        }}
        className={fieldInputClasses({ invalid, multiline: true, className })}
        {...rest}
      />
      {showCount && maxLength !== undefined ? (
        <p
          aria-hidden="true"
          className={cn(
            'mt-1 self-end text-caption tabular-nums',
            overLimit ? 'text-error' : 'text-text-tertiary',
          )}
        >
          {length}/{maxLength}
        </p>
      ) : null}
    </FieldWrapper>
  );
});
