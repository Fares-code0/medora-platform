import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge, type BadgeVariant } from './Badge';

/**
 * A filled badge paints its tint over an opaque surface, not over whatever
 * is behind it. Dark-mode `*-subtle` tokens are 16% alpha, so on a selected
 * table row (itself 16% primary) the two tints compounded and every tone's
 * text fell to 3.8–4.6:1 against WCAG 1.4.3's 4.5 — found by axe on the
 * DataTable stories. Light-mode subtles are opaque, so light is unchanged.
 */
const TINTED: readonly Exclude<BadgeVariant, 'neutral'>[] = [
  'success',
  'warning',
  'error',
  'info',
  'ai',
];

describe('Badge — filled tint over an opaque base', () => {
  it.each(TINTED)('%s: surface base, tint as an image, never a translucent colour', (variant) => {
    render(<Badge variant={variant}>Label</Badge>);
    const badge = screen.getByText('Label');
    // The AI badge paints its own roles (ADR-0005); the status tones their tint.
    const tint = variant === 'ai' ? 'ai-badge' : `${variant}-subtle`;
    const ink = variant === 'ai' ? 'ai-badge-text' : variant;

    expect(badge).toHaveClass('bg-surface');
    expect(badge).toHaveClass(`bg-[image:linear-gradient(var(--color-${tint}),var(--color-${tint}))]`);
    expect(badge).not.toHaveClass(`bg-${tint}`);
    expect(badge).toHaveClass(`text-${ink}`);
  });

  it('neutral already sits on an opaque token and keeps it', () => {
    render(<Badge>Label</Badge>);
    expect(screen.getByText('Label')).toHaveClass('bg-surface-sunken');
  });

  it('outline badges paint no fill at all', () => {
    render(
      <Badge variant="success" emphasis="outline">
        Label
      </Badge>,
    );
    expect(screen.getByText('Label').className).not.toMatch(/\bbg-/);
  });
});
