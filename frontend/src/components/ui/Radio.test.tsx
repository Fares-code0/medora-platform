import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Radio, RadioGroup } from './Radio';

/**
 * RadioGroup's ARIA. A required or invalid group states it on a role that
 * allows those attributes: `radiogroup`. As a bare fieldset (role `group`)
 * it carried `aria-required`, which ARIA does not permit there (axe
 * `aria-allowed-attr`, critical).
 */

function renderGroup(props: { required?: boolean; error?: string } = {}) {
  const onChange = vi.fn();
  render(
    <RadioGroup label="Severity" name="severity" value={null} onChange={onChange} {...props}>
      <Radio value="warning" label="Warning" />
      <Radio value="critical" label="Critical" />
    </RadioGroup>,
  );
  return onChange;
}

describe('RadioGroup', () => {
  it('is a radiogroup named by its legend', () => {
    renderGroup();
    expect(screen.getByRole('radiogroup', { name: 'Severity' })).toBeInTheDocument();
  });

  it('states required and invalid on the radiogroup, where ARIA allows them', () => {
    renderGroup({ required: true, error: 'Choose a severity' });
    const group = screen.getByRole('radiogroup', { name: /Severity/ });
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('Choose a severity');
  });

  it('carries neither attribute when not required and valid', () => {
    renderGroup();
    const group = screen.getByRole('radiogroup', { name: 'Severity' });
    expect(group).not.toHaveAttribute('aria-required');
    expect(group).not.toHaveAttribute('aria-invalid');
  });

  it('reports the chosen value', async () => {
    const onChange = renderGroup();
    await userEvent.click(screen.getByRole('radio', { name: 'Critical' }));
    expect(onChange).toHaveBeenCalledWith('critical');
  });
});
