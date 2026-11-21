import { render, screen, within } from '@testing-library/react';
import { Home } from 'lucide-react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Alert } from '@/components/feedback';

import { Checkbox } from './Checkbox';
import { Chip } from './Chip';
import {
  FIELD_ACTION_CLASSES,
  buttonClasses,
  fieldInputClasses,
  iconButtonClasses,
  type ButtonSize,
} from './internal/styles';
import { Modal } from './Modal';
import { Radio, RadioGroup } from './Radio';
import { Sidebar, SidebarItem } from './Sidebar';
import { Switch } from './Switch';

/**
 * Touch targets on the primitives (DEC-008). jsdom evaluates no media
 * queries, so what is checked here is the arithmetic each control states:
 * its own size plus twice its gutter reaches 44px. That the gutters then
 * neither overlap nor intercept a neighbour in real layouts is measured in
 * a browser at 375px and 1024px with touch emulation (FRONTEND_CHECKLIST
 * §14.1 DEC-008); `styles/touch-targets.test.ts` holds the CSS itself.
 */

const TARGET = 44;

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

/** `[--touch-y:8px]` → 8; 0 when the class is absent. */
function gutter(className: string, axis: 'x' | 'y'): number {
  const match = new RegExp(`\\[--touch-${axis}:(\\d+)px\\]`).exec(className);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

/** Tailwind's `h-7` → 28px. */
function spacing(className: string, prefix: 'h' | 'w'): number {
  const match = new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`).exec(className);
  if (match?.[1] === undefined) throw new Error(`no ${prefix}-N in "${className}"`);
  return Number(match[1]) * 4;
}

describe('shared style builders', () => {
  const sizes: readonly ButtonSize[] = ['sm', 'md', 'lg'];

  it.each(sizes)('a %s text button reaches 44px tall, and at least 44px wide', (size) => {
    const classes = buttonClasses('primary', size, false);
    expect(classes).toContain('touch-target');
    expect(spacing(classes, 'h') + 2 * gutter(classes, 'y')).toBe(TARGET);
    expect(classes).toContain('touch:min-w-[44px]');
  });

  it.each(sizes)('a %s icon button reaches 44px both ways and never shrinks', (size) => {
    const classes = iconButtonClasses('neutral', size);
    expect(spacing(classes, 'h') + 2 * gutter(classes, 'y')).toBe(TARGET);
    expect(spacing(classes, 'w') + 2 * gutter(classes, 'x')).toBe(TARGET);
    expect(classes).toContain('shrink-0');
  });

  it('makes a single-line field 44px tall on touch, and leaves a textarea alone', () => {
    expect(fieldInputClasses({})).toContain('touch:min-h-[44px]');
    expect(fieldInputClasses({ size: 'lg' })).toContain('touch:min-h-[44px]');
    expect(fieldInputClasses({ multiline: true })).not.toContain('touch:min-h-[44px]');
    expect(fieldInputClasses({ trailing: true })).toContain('touch:pe-11');
  });

  it('makes an in-field action the field’s last 44px square on touch', () => {
    expect(FIELD_ACTION_CLASSES).toContain('touch:h-11');
    expect(FIELD_ACTION_CLASSES).toContain('touch:w-11');
    expect(FIELD_ACTION_CLASSES).toContain('touch:end-0');
  });

  it('keeps an in-field action at WCAG 2.5.8’s 24px on a fine pointer, inside the field’s padding', () => {
    // It sits on the field, so 2.5.8's spacing exception cannot excuse a
    // smaller box: the 24px circle would always land on the field itself.
    expect(FIELD_ACTION_CLASSES).toMatch(/(^|\s)h-6(\s|$)/);
    expect(FIELD_ACTION_CLASSES).toMatch(/(^|\s)w-6(\s|$)/);
    // 10px inset + 24px box = 34px, inside the trailing field's 40px pe-10.
    expect(FIELD_ACTION_CLASSES).toMatch(/(^|\s)end-2\.5(\s|$)/);
    expect(fieldInputClasses({ trailing: true })).toMatch(/(^|\s)pe-10(\s|$)/);
  });
});

describe('primitives with their own geometry', () => {
  it('Switch: a 24px track reserves 10px above and below', () => {
    render(<Switch checked={false} onCheckedChange={vi.fn()} label="Monday" />);
    const control = screen.getByRole('switch', { name: 'Monday' });
    expect(control).toHaveClass('touch-target');
    expect(24 + 2 * gutter(control.className, 'y')).toBe(TARGET);
  });

  it('Checkbox: an 18px box reserves 13px all round', () => {
    render(<Checkbox label="Remember me" />);
    const box = screen.getByRole('checkbox', { name: 'Remember me' }).parentElement;
    if (box === null) throw new Error('no box');
    expect(box).toHaveClass('touch-target');
    expect(18 + 2 * gutter(box.className, 'y')).toBe(TARGET);
    expect(18 + 2 * gutter(box.className, 'x')).toBe(TARGET);
  });

  it('Radio: a 20px circle reserves 12px all round', () => {
    render(
      <RadioGroup label="Kind" name="kind" value="a" onChange={vi.fn()}>
        <Radio value="a" label="A" />
      </RadioGroup>,
    );
    const circle = screen.getByRole('radio', { name: 'A' }).parentElement;
    if (circle === null) throw new Error('no circle');
    expect(20 + 2 * gutter(circle.className, 'y')).toBe(TARGET);
    expect(20 + 2 * gutter(circle.className, 'x')).toBe(TARGET);
  });

  it('Chip: the 16px remove control reserves 14px all round', () => {
    render(<Chip label="Cardiology" onRemove={vi.fn()} />);
    const remove = screen.getByRole('button', { name: 'Remove Cardiology' });
    expect(16 + 2 * gutter(remove.className, 'y')).toBe(TARGET);
    expect(16 + 2 * gutter(remove.className, 'x')).toBe(TARGET);
  });

  it('Alert: the 20px dismiss reserves 12px all round', () => {
    render(
      <Alert title="Saved" onDismiss={vi.fn()}>
        Done.
      </Alert>,
    );
    const dismiss = screen.getByRole('button', { name: 'Dismiss message' });
    expect(20 + 2 * gutter(dismiss.className, 'y')).toBe(TARGET);
    expect(20 + 2 * gutter(dismiss.className, 'x')).toBe(TARGET);
  });

  it('Modal: the 28px close button reserves 8px all round', () => {
    render(
      <Modal open onClose={vi.fn()} title="Write a note">
        Body
      </Modal>,
    );
    const close = within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dialog' });
    expect(28 + 2 * gutter(close.className, 'y')).toBe(TARGET);
    expect(28 + 2 * gutter(close.className, 'x')).toBe(TARGET);
  });
});

describe('collapsed sidebar', () => {
  it('names an icon-only link, which the tooltip alone did not', () => {
    render(
      <Sidebar collapsed>
        <SidebarItem icon={Home} label="Overview" href="/doctor/overview" />
      </Sidebar>,
    );
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });

  it('grows each stacked row to 44px on touch instead of extending over the next', () => {
    render(
      <Sidebar>
        <SidebarItem icon={Home} label="Overview" href="/doctor/overview" />
      </Sidebar>,
    );
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveClass('touch:h-11');
  });
});
