import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Modal } from './Modal';

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function setup(onClose = vi.fn()) {
  render(
    <Modal open onClose={onClose} title="Edit" footer={<button type="button">Save</button>}>
      <p>Body content</p>
    </Modal>,
  );
  return onClose;
}

describe('Modal mobile layout', () => {
  it('scrolls the body inside a flex-column panel', () => {
    setup();
    const body = screen.getByText('Body content').parentElement;
    expect(body).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto', 'overscroll-contain');
    expect(body?.parentElement).toHaveClass('flex', 'flex-col');
  });

  it('stacks footer actions below sm and rows at sm+', () => {
    setup();
    const footer = screen.getByText('Save').parentElement;
    expect(footer).toHaveClass('flex-col-reverse', 'sm:flex-row', 'shrink-0');
  });

  it('still dismisses with the close button', async () => {
    const onClose = setup();
    await userEvent.click(screen.getByRole('button', { name: /close/i, hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
