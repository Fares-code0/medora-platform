import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageComposer } from './MessageComposer';

describe('MessageComposer on a coarse pointer', () => {
  it('types at 16px on touch so iOS does not zoom, and 13px otherwise', () => {
    render(
      <MessageComposer
        draft=""
        sending={false}
        onSend={() => undefined}
        onDraftChange={() => undefined}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveClass(
      'text-body',
      'touch:text-h3',
    );
  });
});
