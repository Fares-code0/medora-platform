import { useId } from 'react';
import type { ReactNode } from 'react';

import { AlertCircle } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Shared field chrome — DS §8.2 anatomy.
 * Label (14px/500, 6px above) · control · helper text or error (12px, 6px
 * below; error replaces helper and announces via role="alert").
 * Input, PasswordInput, SearchInput, Textarea, and Select all render
 * through this wrapper so field anatomy exists exactly once.
 */

export function useFieldA11y(idProp?: string) {
  const autoId = useId();
  const inputId = idProp ?? autoId;
  return {
    inputId,
    helperId: `${inputId}-helper`,
    errorId: `${inputId}-error`,
  } as const;
}

export interface FieldWrapperProps {
  inputId: string;
  helperId: string;
  errorId: string;
  label?: string | undefined;
  required?: boolean | undefined;
  helperText?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function FieldWrapper({
  inputId,
  helperId,
  errorId,
  label,
  required,
  helperText,
  error,
  disabled,
  className,
  children,
}: FieldWrapperProps) {
  return (
    <div className={cn('flex w-full flex-col', className)}>
      {label ? (
        <label
          htmlFor={inputId}
          className={cn(
            'mb-1.5 text-body-sm font-medium',
            disabled ? 'text-text-disabled' : 'text-text-secondary',
          )}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className="ms-0.5 text-error">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 flex items-start gap-1 text-caption text-error"
        >
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="mt-1.5 text-caption text-text-secondary">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
