import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui';

import { MedoraAiLogo } from './MedoraAiLogo';

describe('MedoraAiLogo', () => {
  it('renders the supplied artwork, square and unstretched', () => {
    const { container } = render(<MedoraAiLogo className="h-5 w-5" />);
    const svg = container.querySelector('svg');
    const image = svg?.querySelector('image');

    expect(svg).toHaveAttribute('data-brand', 'medora-ai');
    expect(svg).toHaveAttribute('viewBox', '0 0 256 256');
    expect(svg).toHaveClass('h-5', 'w-5');
    expect(image?.getAttribute('href')).toMatch(/medora-ai-logo/);
    expect(image).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  });

  it('is decorative unless it is given a name', () => {
    const { container, rerender, getByRole } = render(<MedoraAiLogo />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    rerender(<MedoraAiLogo aria-label="Medora AI" />);
    expect(getByRole('img', { name: 'Medora AI' })).toBeInTheDocument();
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
