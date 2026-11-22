import { cn } from '@/utils/cn';

/**
 * Shared style builders — DS §8.1 (buttons) and §8.2 (inputs).
 * Button, IconButton, and LinkButton consume `buttonClasses`; every text
 * field consumes `fieldInputClasses`, so variants and interaction states
 * are defined exactly once and always resolve to design tokens.
 */

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructive-secondary' | 'ai';

export type ButtonSize = 'sm' | 'md' | 'lg';

export type FieldSize = 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded-surface ' +
  'font-medium transition-[background-color,border-color,color,transform] duration-base ease-out ' +
  'active:scale-[0.98] ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken ' +
  'disabled:text-text-disabled disabled:shadow-none disabled:active:scale-100 ' +
  'aria-disabled:cursor-not-allowed';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-fill text-primary-fill-text hover:bg-primary-fill-hover active:bg-primary-pressed',
  secondary:
    'border border-border-strong bg-surface text-primary hover:bg-surface-sunken active:bg-border',
  ghost:
    'bg-transparent text-primary hover:bg-surface-sunken active:bg-border disabled:bg-transparent',
  destructive: 'bg-error text-text-inverse hover:bg-error-hover active:bg-error-hover',
  'destructive-secondary':
    'border border-error bg-surface text-error hover:bg-error-subtle active:bg-error-subtle',
  ai: 'bg-accent text-text-inverse hover:brightness-90 active:brightness-90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-body-sm',
  md: 'h-8 gap-2 px-3 text-body-sm',
  lg: 'h-9 gap-2 px-3.5 text-body',
};

/**
 * The touch gutter per size — (44px − the control's height) / 2 — that
 * `.touch-target` reserves on a coarse pointer (DEC-008, globals.css). A
 * text button is wide enough already, so it reserves height only; an icon
 * button is square and reserves both.
 */
const TOUCH_GUTTER_Y: Record<ButtonSize, string> = {
  sm: 'touch-target [--touch-y:8px]',
  md: 'touch-target [--touch-y:6px]',
  lg: 'touch-target [--touch-y:4px]',
};

const TOUCH_GUTTER_XY: Record<ButtonSize, string> = {
  sm: 'touch-target [--touch-y:8px] [--touch-x:8px]',
  md: 'touch-target [--touch-y:6px] [--touch-x:6px]',
  lg: 'touch-target [--touch-y:4px] [--touch-x:4px]',
};

/** Icon dimension per button size — compact scale (14 / 16 / 18). */
export const BUTTON_ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-[18px] w-[18px]',
};

export function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean,
  className?: string,
): string {
  return cn(
    BUTTON_BASE,
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    TOUCH_GUTTER_Y[size],
    // A text button narrower than 44px (an icon with a caret, "OK") widens
    // to it on a coarse pointer rather than reserving width it cannot know.
    'touch:min-w-[44px]',
    fullWidth && 'w-full',
    className,
  );
}

/** IconButton adds a token-neutral variant for toolbar/table actions. */
export type IconButtonVariant = ButtonVariant | 'neutral';

const ICON_BUTTON_NEUTRAL =
  'bg-transparent text-text-secondary hover:bg-surface-sunken hover:text-text-primary ' +
  'active:bg-border disabled:bg-transparent';

const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-9 w-9',
};

export function iconButtonClasses(
  variant: IconButtonVariant,
  size: ButtonSize,
  className?: string,
): string {
  return cn(
    BUTTON_BASE,
    variant === 'neutral' ? ICON_BUTTON_NEUTRAL : BUTTON_VARIANTS[variant],
    ICON_BUTTON_SIZES[size],
    TOUCH_GUTTER_XY[size],
    // Square by definition: a flex row at 375px squeezed these to 22px wide.
    'shrink-0 p-0',
    className,
  );
}

/**
 * A button laid over the end of a text field — show password, clear search.
 * It sits on the field on purpose, so `.touch-target` (which reserves
 * layout space) cannot apply; instead, on a coarse pointer it becomes the
 * field's last 44 x 44 px, the field being 44px tall there and padded so
 * its text stops short of it (DEC-008).
 *
 * On a fine pointer it is 24 x 24 px, WCAG 2.2's 2.5.8 minimum. It used to
 * be its 20 px icon, and 2.5.8's spacing exception cannot excuse it: the
 * 24 px circle around it lands on another target — the field it sits in
 * (Lighthouse `target-size` on `/login`, 2026-10-22). The inset moved from
 * 12 to 10 px so the icon itself has not moved; `pe-10` still clears it.
 */
export const FIELD_ACTION_CLASSES =
  'absolute end-2.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center ' +
  'rounded-control text-text-tertiary transition-colors duration-fast hover:text-text-primary ' +
  'touch:end-0 touch:h-11 touch:w-11';

/** Text-field classes — DS §8.2, compact heights (32px md / 36px lg). */
export function fieldInputClasses(options: {
  size?: FieldSize | undefined;
  invalid?: boolean | undefined;
  leading?: boolean | undefined;
  trailing?: boolean | undefined;
  multiline?: boolean | undefined;
  className?: string | undefined;
}): string {
  const {
    size = 'md',
    invalid = false,
    leading = false,
    trailing = false,
    multiline = false,
  } = options;
  return cn(
    'w-full min-w-0 max-w-full rounded-surface border bg-surface text-body text-text-primary',
    // iOS date/time inputs have an intrinsic min width and a centred value.
    '[&::-webkit-date-and-time-value]:text-start',
    /*
     * The placeholder has its own colour role, --color-text-placeholder.
     *
     * It used to take --color-text-disabled, which is the same value as
     * --color-border-strong: a colour tokens.css holds at 3:1 because
     * WCAG 1.4.11 asks that of a control's *boundary*. Text wants 4.5:1, and
     * every input, textarea and select in the app measured 3.23:1 in light
     * and 3.84:1 in dark.
     *
     * It is not exempt. WCAG 1.4.3 excuses text that is part of an INACTIVE
     * component — the disabled: rule below, which keeps the disabled role and
     * is right to. A placeholder in a control the user can type into is not
     * that.
     *
     * Its own role rather than the tertiary one, because a placeholder as
     * loud as metadata stops looking like an empty field. See tokens.css.
     */
    'placeholder:text-text-placeholder transition-colors duration-base ease-out',
    'focus:outline-none focus:shadow-focus',
    'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-disabled',
    'read-only:bg-background',
    multiline ? 'min-h-20 resize-y py-2' : size === 'lg' ? 'h-9' : 'h-8',
    // A field is its own target, and an <input> takes no pseudo-element, so
    // on a coarse pointer it is simply 44px tall (DEC-008).
    !multiline && 'touch:min-h-[44px]',
    invalid
      ? 'border-error focus:border-error'
      : 'border-border-strong hover:border-text-disabled focus:border-primary',
    leading ? 'ps-10' : 'ps-3',
    trailing ? 'pe-10 touch:pe-11' : 'pe-3',
    options.className,
  );
}
