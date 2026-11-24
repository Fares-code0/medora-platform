import { render } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Drawer } from '../Drawer';
import { Modal } from '../Modal';

import { lockBodyScroll } from './scroll-lock';

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  document.body.style.overflow = 'auto';
});

function Stack({ drawer, modal }: { drawer: boolean; modal: boolean }) {
  return (
    <>
      <Drawer open={drawer} onClose={() => undefined} title="Details">
        <p>Drawer body</p>
      </Drawer>
      <Modal open={modal} onClose={() => undefined} title="Confirm">
        <p>Modal body</p>
      </Modal>
    </>
  );
}

describe('body scroll lock', () => {
  it('restores the original overflow when a drawer and a stacked modal close in one commit', () => {
    const { rerender } = render(<Stack drawer modal={false} />);
    rerender(<Stack drawer modal />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Stack drawer={false} modal={false} />);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('keeps the lock while either dialog is open, whatever the closing order', () => {
    const { rerender } = render(<Stack drawer modal={false} />);
    rerender(<Stack drawer modal />);

    rerender(<Stack drawer={false} modal />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Stack drawer={false} modal={false} />);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('ignores a repeated release', () => {
    const first = lockBodyScroll();
    const second = lockBodyScroll();
    first();
    first();
    expect(document.body.style.overflow).toBe('hidden');
    second();
    expect(document.body.style.overflow).toBe('auto');
  });
});
