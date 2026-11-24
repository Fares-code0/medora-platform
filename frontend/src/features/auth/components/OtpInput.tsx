import { useEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';

import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * OTP input — `length` single-character cells behaving as one field.
 * Supports autofocus, full-code paste distribution, arrow navigation, and
 * backspace-to-previous. Value is controlled as a plain string; digits only.
 */
export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last cell is filled (full code entered). */
  onComplete?: ((value: string) => void) | undefined;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string | undefined;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  invalid = false,
  autoFocus = true,
  'aria-label': ariaLabel,
}: OtpInputProps) {
  const t = useT();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const digits = value.split('').slice(0, length);
  while (digits.length < length) digits.push('');

  const commit = (next: string) => {
    const cleaned = next.replace(/\D/g, '').slice(0, length);
    onChange(cleaned);
    if (cleaned.length === length) onComplete?.(cleaned);
  };

  const focusCell = (index: number) => {
    const clamped = Math.max(0, Math.min(length - 1, index));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  };

  const handleChange = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    if (!digit) return;
    const arr = digits.slice();
    arr[index] = digit;
    commit(arr.join(''));
    if (index < length - 1) focusCell(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const arr = digits.slice();
      if (arr[index]) {
        arr[index] = '';
        commit(arr.join(''));
      } else if (index > 0) {
        arr[index - 1] = '';
        commit(arr.join(''));
        focusCell(index - 1);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusCell(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusCell(index + 1);
    }
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    const arr = digits.slice();
    for (let i = 0; i < pasted.length && index + i < length; i += 1) {
      arr[index + i] = pasted[i] ?? '';
    }
    const joined = arr.join('');
    commit(joined);
    focusCell(Math.min(index + pasted.length, length - 1));
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t('otp.codeLabel')}
      className="flex justify-between gap-2 sm:gap-3"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={t('otp.digitOf', { index: index + 1, total: length })}
          aria-invalid={invalid || undefined}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={(event) => event.target.select()}
          className={cn(
            'h-12 w-full min-w-0 rounded-surface border bg-surface text-center text-h4 font-semibold text-text-primary',
            'transition-colors duration-base ease-out focus:outline-none focus:shadow-focus',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-disabled',
            invalid
              ? 'border-error focus:border-error'
              : 'border-border-strong hover:border-text-disabled focus:border-primary',
          )}
        />
      ))}
    </div>
  );
}
