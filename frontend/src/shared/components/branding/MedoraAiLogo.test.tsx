import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui';

import { MedoraAiLogo } from './MedoraAiLogo';

describe('MedoraAiLogo', () => {
  it('renders a theme-aware vector icon, not an image', () => {
    const { container } = render(<MedoraAiLogo className="h-5 w-5" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('data-brand', 'medora-ai');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveClass('h-5', 'w-5', 'shrink-0');
    // No raster is loaded: nothing to download, nothing that ignores the theme.
    expect(container.querySelector('image, img')).toBeNull();
  });

  it('takes size and strokeWidth like a lucide icon', () => {
    const { container } = render(<MedoraAiLogo size={16} strokeWidth={1.5} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
    expect(svg).toHaveAttribute('stroke-width', '1.5');
  });

  it('is decorative unless it is given a name', () => {
    const { container, rerender, getByRole } = render(<MedoraAiLogo />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    rerender(<MedoraAiLogo aria-label="Medora AI" />);
    const named = getByRole('img', { name: 'Medora AI' });
    expect(named).toBeInTheDocument();
    expect(named).not.toHaveAttribute('aria-hidden');
  });

  it('fills an icon slot the way a lucide icon does', () => {
    const { getByRole } = render(
      <Button variant="ai" leadingIcon={MedoraAiLogo}>
        Medora AI
      </Button>,
    );
    const button = getByRole('button', { name: 'Medora AI' });
    expect(button.querySelector('svg[data-brand="medora-ai"]')).toBeInTheDocument();
    expect(button.querySelector('svg[data-brand="medora-ai"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
