import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ReasonDialog, type ReasonDialogProps } from './ReasonDialog';

/**
 * NEW-35. The reason dialog is what a doctor confirms through to reject a
 * request or cancel a booked visit — an act that notifies the patient — and
 * no test had ever rendered it (6.5 % of its lines ran under the suite).
 * What is pinned: nothing is sent without a reason, what is sent is what was
 * chosen and typed, and a write in flight cannot be dismissed or confirmed
 * twice.
 */

const REASONS = ['Doctor unavailable', 'Patient request', 'Other'] as const;

// jsdom has no modal `<dialog>`; the same stand-in the other dialog tests use.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function renderDialog(overrides: Partial<ReasonDialogProps> = {}) {
  const props: ReasonDialogProps = {
    open: true,
    title: 'Cancel APT-1042?',
    consequence: 'Layla Haddad will be notified immediately with the reason.',
    confirmLabel: 'Cancel appointment',
    reasonOptions: REASONS,
    loading: false,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ReasonDialog {...props} />);
  return props;
}

async function chooseReason(reason: string) {
  await userEvent.click(screen.getByRole('combobox', { name: /Reason/ }));
  await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: reason }));
}

describe('ReasonDialog', () => {
  it('states the consequence and requires a reason', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Cancel APT-1042?' });
    expect(dialog).toHaveAccessibleDescription(
      'Layla Haddad will be notified immediately with the reason.',
    );
    expect(within(dialog).getByRole('combobox', { name: /Reason/ })).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  it('withholds the confirm until a reason is chosen', async () => {
    const { onConfirm } = renderDialog();

    const confirm = screen.getByRole('button', { name: 'Cancel appointment' });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await chooseReason('Doctor unavailable');
    expect(confirm).toBeEnabled();
  });

  it('sends the chosen reason and the typed details, once', async () => {
    const { onConfirm } = renderDialog();

    await chooseReason('Patient request');
    await userEvent.type(
      screen.getByRole('textbox', { name: /Additional details/ }),
      'Travelling that week',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Patient request', 'Travelling that week');
  });

  it('sends empty details when none are typed — the details are optional', async () => {
    const { onConfirm } = renderDialog();

    await chooseReason('Other');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));

    expect(onConfirm).toHaveBeenCalledWith('Other', '');
  });

  it('"Keep appointment" closes without sending anything', async () => {
    const { onConfirm, onClose } = renderDialog();

    await chooseReason('Other');
    await userEvent.click(screen.getByRole('button', { name: 'Keep appointment' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot be kept or confirmed again while the write is in flight', async () => {
    const { onClose } = renderDialog({ loading: true });

    expect(screen.getByRole('button', { name: 'Keep appointment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cancel appointment/ })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
