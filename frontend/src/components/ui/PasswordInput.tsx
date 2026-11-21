import { forwardRef, useState } from 'react';

import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/utils/cn';

import { Input, type InputProps } from './Input';
import { FIELD_ACTION_CLASSES } from './internal/styles';

/**
 * PasswordInput — Input with a visibility toggle (DS §8.2).
 * The toggle is a labelled control announced as pressed/unpressed; the
 * field defaults to `autoComplete="current-password"`.
 */
export type PasswordInputProps = Omit<InputProps, 'type' | 'trailingIcon' | 'trailingElement'>;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ disabled, autoComplete, ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    const Icon = visible ? EyeOff : Eye;

    return (
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        autoComplete={autoComplete ?? 'current-password'}
        trailingElement={
          <button
            type="button"
            disabled={disabled}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            className={cn(FIELD_ACTION_CLASSES, 'disabled:text-text-disabled')}
          >
            <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
          </button>
        }
        {...rest}
      />
    );
  },
);
