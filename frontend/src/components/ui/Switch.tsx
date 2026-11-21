import { forwardRef } from 'react';

import { cn } from '@/utils/cn';

import { useFieldA11y } from './internal/Field';

/**
 * Switch — DS §8.7.
 * 44×24 track, 20px thumb, 150ms slide. Switches apply immediately (no
 * submit) — use a Checkbox when a save action follows. Never used for
 * destructive or clinical-impact settings without confirmation.
 */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Settings-row layout: label left, switch right. */
  label?: string | undefined;
  description?: string | undefined;
  disabled?: boolean;
  id?: string | undefined;
  className?: string;
  'aria-label'?: string | undefined;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onCheckedChange,
    label,
    description,
    disabled = false,
    id,
    className,
    'aria-label': ariaLabel,
  },
  ref,
) {
  const { inputId } = useFieldA11y(id);

  const control = (
    <button
      ref={ref}
      id={inputId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill p-0.5',
        // 24px tall: 10px above and below make the 44px touch target (DEC-008).
        'touch-target [--touch-y:10px]',
        'transition-colors duration-base ease-out',
        checked ? 'bg-primary-fill' : 'bg-border-strong',
        'disabled:cursor-not-allowed disabled:bg-border',
        !label && className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          /*
           * The knob takes the ink of whatever it sits on, so it clears
           * WCAG 1.4.11's 3:1 against its own track on fill alone:
           *
           *   on the checked track   --color-primary-fill-text — the same
           *                          ink as the label on a primary button,
           *                          because it sits on the same fill.
           *                          Light 4.66:1 (white on blue 600), dark
           *                          7.05:1 (ink 900 on blue 400). A white
           *                          knob there measured 2.60:1 in dark.
           *   unchecked / disabled   --color-control-knob, light in both
           *                          themes: 3.48:1 (light) and 3.86:1
           *                          (dark) on the unchecked track. On the
           *                          disabled track a dark knob would have
           *                          measured 1.35:1, so a disabled checked
           *                          switch keeps the light knob too.
           *
           * Not --color-text-inverse: that token belongs to every other
           * filled tone, and a knob must follow the track it is on.
           * `contrast.test.ts` asserts both pairs in both themes.
           *
           * The hairline (--color-border) stays as a second edge. A ring,
           * not a border — a border would eat 2px of a 20px knob and read as
           * a bullseye.
           */
          'block h-5 w-5 rounded-pill ring-1 ring-border transition-transform duration-base ease-out',
          checked && !disabled ? 'bg-primary-fill-text' : 'bg-control-knob',
          // `translate-x` is physical and does not mirror: in RTL the knob has
          // to travel the other way or a switch turns "on" by sliding out of
          // its own track. This is one of the few things logical CSS cannot
          // express, so it takes an explicit `rtl:` variant.
          checked && 'translate-x-5 rtl:-translate-x-5',
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <label htmlFor={inputId} className={cn('flex flex-col', disabled && 'cursor-not-allowed')}>
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
      </label>
      {control}
    </div>
  );
});
