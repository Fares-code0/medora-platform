import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { notConnected } from '@/api/http';

import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('offers Retry for an ordinary failure', () => {
    render(<ErrorState error={new Error('boom')} onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this section");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says a not-connected feature is not connected, and offers no Retry that cannot help', () => {
    render(<ErrorState error={notConnected('messaging')} onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Not connected yet');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
