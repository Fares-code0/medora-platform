import { useRef, type KeyboardEvent } from 'react';

import { Moon, Sun, type LucideIcon } from 'lucide-react';

import { useTheme } from '@/app/providers/ThemeProvider';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * ThemeSwitch — the light/dark pill: sun on one side, moon on the other, an
 * indicator behind the theme on screen. No visible label; the group is named
 * "Theme" for assistive technology, and each half names its theme and says
 * whether it is the one shown (`radio` + `aria-checked`), so a screen reader
 * hears "Dark theme, selected" rather than an action whose label and effect
 * disagree (NEW-36, which this carries over from the avatar menu).
 *
 * Checked follows the *resolved* theme, so a stored `system` preference shows
 * what the OS is painting; choosing a half stores that theme explicitly.
 * Arrow keys move between the halves and choose, as a radio group does;
 * only the checked half is in the tab order.
 *
 * `vertical` stacks the halves for the collapsed 64px sidebar rail, where two
 * side by side do not fit.
 */
export interface ThemeSwitchProps {
  orientation?: 'horizontal' | 'vertical' | undefined;
  /**
   * Show each half's name as a native hover tooltip. Off on the collapsed
   * sidebar rail, which shows no hover labels; the names stay as each
   * button's accessible label either way.
   */
  hoverLabels?: boolean | undefined;
  className?: string | undefined;
}

type Choice = 'light' | 'dark';

const OPTIONS: readonly { id: Choice; icon: LucideIcon; labelKey: 'shell.themeLight' | 'shell.themeDark'; active: string }[] = [
  { id: 'light', icon: Sun, labelKey: 'shell.themeLight', active: 'text-warning' },
  { id: 'dark', icon: Moon, labelKey: 'shell.themeDark', active: 'text-primary' },
];

export function ThemeSwitch({
  orientation = 'horizontal',
  hoverLabels = true,
  className,
}: ThemeSwitchProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const position = resolvedTheme === 'dark' ? 1 : 0;
  const vertical = orientation === 'vertical';

  const choose = (index: number) => {
    const option = OPTIONS[index];
    if (!option) return;
    if (option.id !== resolvedTheme) setTheme(option.id);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = ['ArrowRight', 'ArrowDown'].includes(event.key);
    const previous = ['ArrowLeft', 'ArrowUp'].includes(event.key);
    if (!next && !previous) return;
    event.preventDefault();
    choose(next ? Math.min(position + 1, OPTIONS.length - 1) : Math.max(position - 1, 0));
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('shell.theme')}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-flex shrink-0 rounded-pill border border-border bg-surface-sunken p-0.5',
        vertical ? 'flex-col' : 'flex-row',
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-segment-indicator
        data-position={String(position)}
        className={cn(
          'pointer-events-none absolute h-7 w-7 rounded-pill bg-surface ring-1 ring-border',
          'transition-[inset-inline-start,top] duration-base ease-out',
          // Logical `start`, not a translate: in Arabic and Farsi the row
          // mirrors, and the indicator has to mirror with it.
          vertical
            ? cn('start-0.5', position === 1 ? 'top-[1.875rem]' : 'top-0.5')
            : cn('top-0.5', position === 1 ? 'start-[1.875rem]' : 'start-0.5'),
        )}
      />
      {OPTIONS.map((option, index) => {
        const Icon = option.icon;
        const checked = index === position;
        const label = t(option.labelKey);
        return (
          <button
            key={option.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={hoverLabels ? label : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => choose(index)}
            className={cn(
              'relative z-[1] inline-flex h-7 w-7 items-center justify-center rounded-pill',
              'transition-colors duration-fast ease-out',
              checked ? option.active : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
