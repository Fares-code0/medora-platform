import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Switch } from './Switch';

/**
 * The knob follows the track it sits on (ADR-0005). On the checked track it
 * takes the fill's own ink — a white knob measured 2.60:1 on the dark
 * theme's blue 400, short of WCAG 1.4.11's 3:1. The token pairs themselves
 * are asserted in `styles/contrast.test.ts`; this pins which token each
 * state reaches for.
 */
const knob = () => screen.getByRole('switch').firstElementChild as HTMLElement;

describe('Switch knob', () => {
  it('takes the fill ink on the checked track', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Notifications" />);
    expect(screen.getByRole('switch')).toHaveClass('bg-primary-fill');
    expect(knob()).toHaveClass('bg-primary-fill-text');
    expect(knob()).not.toHaveClass('bg-control-knob');
  });

  it('stays the light control knob on the unchecked track', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} aria-label="Notifications" />);
    expect(screen.getByRole('switch')).toHaveClass('bg-border-strong');
    expect(knob()).toHaveClass('bg-control-knob');
  });

  it('keeps the light knob when disabled, where the track is the pale border', () => {
    render(<Switch checked disabled onCheckedChange={() => {}} aria-label="Notifications" />);
    expect(knob()).toHaveClass('bg-control-knob');
    expect(knob()).not.toHaveClass('bg-primary-fill-text');
  });
});
