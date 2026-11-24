import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OtpInput } from './OtpInput';

describe('OtpInput on a coarse pointer', () => {
  it('types at 16px on touch so iOS does not zoom, and keeps its size otherwise', () => {
    render(<OtpInput value="" onChange={() => undefined} length={6} />);
    const cells = screen.getAllByRole('textbox');
    expect(cells).toHaveLength(6);
    for (const cell of cells) expect(cell).toHaveClass('text-h4', 'touch:text-h3');
  });
});
